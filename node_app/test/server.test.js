import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18234;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";

let child;
let tmpDir;

const waitForHealth = async () => {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* aun no levanta */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("La API no levanto a tiempo.");
};

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-test-"));
  child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      LOGIN_MAX_ATTEMPTS: "3",
      LOGIN_WINDOW_SECONDS: "60",
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(() => {
  child?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const login = async (email, password) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
};

test("login del admin inicial y /auth/me", async () => {
  const { status, body } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(status, 200);
  assert.ok(body.token);
  const me = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${body.token}` } });
  assert.equal(me.status, 200);
  const mePayload = await me.json();
  assert.equal(mePayload.user.role, "admin");
});

test("rutas protegidas exigen token", async () => {
  for (const route of ["/auth/me", "/auth/users", "/template-info"]) {
    const res = await fetch(`${BASE}${route}`);
    assert.equal(res.status, 401, route);
  }
  const gen = await fetch(`${BASE}/generate`, { method: "POST" });
  assert.equal(gen.status, 401);
});

test("un usuario con rol 'user' y suscripcion vigente puede generar", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const created = await fetch(`${BASE}/auth/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body: JSON.stringify({ email: "user@test.local", password: "OtraClave123!", role: "user", subscriptionDays: 30 }),
  });
  assert.equal(created.status, 201);

  const user = await login("user@test.local", "OtraClave123!");
  assert.equal(user.status, 200);

  const info = await fetch(`${BASE}/template-info`, { headers: { Authorization: `Bearer ${user.body.token}` } });
  assert.equal(info.status, 200);
  const limits = await info.json();
  assert.equal(limits.maxMuestra, 2000);
  assert.equal(limits.maxItemsV1, 60);

  const config = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "Tabulacion.json"), "utf-8"));
  const gen = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.body.token}` },
    body: JSON.stringify({ config: { ...config, muestra: "30" }, responseMode: "inline" }),
  });
  assert.equal(gen.status, 200);
  const payload = await gen.json();
  assert.equal(typeof payload.correlation, "number");
  assert.ok(payload.excelBase64.length > 1000);
});

test("la gestion de usuarios sigue siendo solo para admins", async () => {
  const user = await login("user@test.local", "OtraClave123!");
  const res = await fetch(`${BASE}/auth/users`, { headers: { Authorization: `Bearer ${user.body.token}` } });
  assert.equal(res.status, 403);
});

test("config que excede los limites devuelve 500 con mensaje claro", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const config = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "Tabulacion.json"), "utf-8"));
  const gen = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body: JSON.stringify({ config: { ...config, muestra: "99999" }, responseMode: "inline" }),
  });
  assert.equal(gen.status, 500);
  const payload = await gen.json();
  assert.match(payload.error, /muestra maxima soportada/);

  const genItems = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body: JSON.stringify({
      config: { ...config, items_por_dim_v1: ["30", "30", "30"] },
      responseMode: "inline",
    }),
  });
  assert.equal(genItems.status, 500);
  const itemsPayload = await genItems.json();
  assert.match(itemsPayload.error, /maximo 60 items/);
});

test("rate limiting: bloquea tras varios intentos fallidos", async () => {
  const email = "fuerza-bruta@test.local";
  for (let i = 0; i < 3; i += 1) {
    const { status } = await login(email, "incorrecta");
    assert.equal(status, 401);
  }
  const blocked = await login(email, "incorrecta");
  assert.equal(blocked.status, 429);
});
