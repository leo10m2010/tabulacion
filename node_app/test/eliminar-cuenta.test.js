// Eliminacion de la propia cuenta.
//
// No es una cortesia: la politica de datos de usuario de Google la exige a las
// aplicaciones que usan su inicio de sesion, y el derecho de supresion del
// RGPD apunta a lo mismo.
//
// Lo que se verifica aqui, ademas de que funcione: que no se pueda usar para
// conseguir usos gratuitos infinitos (borrar cuenta -> registrarse otra vez).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18281;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";

let child;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-del-"));
  child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PORT: String(PORT),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      REGISTER_MAX_PER_IP: "50",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch { /* aun no levanta */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("La API no levanto a tiempo.");
});

after(() => {
  child?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const registrar = (email) => fetch(`${BASE}/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "ClaveDePrueba123!" }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const eliminar = (token, confirmEmail) => fetch(`${BASE}/auth/me`, {
  method: "DELETE",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ confirmEmail }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const login = (email, password) => fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
}).then((r) => r.status);

test("un usuario elimina su cuenta y deja de poder entrar", async () => {
  const email = "seborra@test.local";
  const alta = await registrar(email);
  assert.equal(alta.status, 201);

  const borrado = await eliminar(alta.body.token, email);
  assert.equal(borrado.status, 200);

  // La sesion que tenia deja de valer y las credenciales tampoco entran.
  const me = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${alta.body.token}` } });
  assert.equal(me.status, 401, "el token del usuario borrado ya no vale");
  assert.equal(await login(email, "ClaveDePrueba123!"), 401, "sus credenciales tampoco");
});

test("hay que escribir el propio correo para confirmar", async () => {
  const email = "confirma@test.local";
  const alta = await registrar(email);

  const malo = await eliminar(alta.body.token, "otro@test.local");
  assert.equal(malo.status, 400, "un correo que no es el suyo no confirma nada");

  const vacio = await eliminar(alta.body.token, "");
  assert.equal(vacio.status, 400);

  // Sigue existiendo.
  const me = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${alta.body.token}` } });
  assert.equal(me.status, 200, "no se borro nada");
});

test("borrar y volver a registrarse NO regala otra tanda de usos", async () => {
  const email = "reincidente@test.local";

  const primera = await registrar(email);
  assert.ok(primera.body.user.uses.tabulacion > 0, "la primera cuenta si recibe cuota");
  await eliminar(primera.body.token, email);

  const segunda = await registrar(email);
  assert.equal(segunda.status, 201, "puede volver a registrarse: no se le excluye del servicio");
  assert.equal(segunda.body.user.uses.tabulacion, 0, "pero sin cuota de cortesia");
  assert.equal(segunda.body.user.uses.humanizador, 0);
});

test("solo se guarda un hash del correo, nunca el correo", async () => {
  const email = "privacidad@test.local";
  const alta = await registrar(email);
  await eliminar(alta.body.token, email);

  const registro = fs.readFileSync(path.join(tmpDir, "deleted-accounts.json"), "utf-8");
  assert.doesNotMatch(registro, /privacidad@test\.local/, "el correo NO queda guardado");
  assert.match(registro, /"emailHash":"[0-9a-f]{64}"/, "solo su hash");
});

test("una cuenta de administrador no puede eliminarse a si misma", async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const { token } = await res.json();

  // Dejaria el sistema sin administrador — y ademas seria mentira: el arranque
  // lo recrearia desde ADMIN_EMAIL.
  const borrado = await eliminar(token, ADMIN_EMAIL);
  assert.equal(borrado.status, 403);
});

test("sin sesion no se puede borrar nada", async () => {
  const res = await fetch(`${BASE}/auth/me`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmEmail: "quien@test.local" }),
  });
  assert.equal(res.status, 401);
});
