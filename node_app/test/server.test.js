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
  assert.ok(Array.isArray(limits.temas) && limits.temas.some((t) => t.id === "powerbi"));
  assert.ok(Array.isArray(limits.nivelesCorrelacion) && limits.nivelesCorrelacion.some((n) => n.id === "moderada"));

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
  assert.equal(payload.tema, "clasico");
  assert.ok(Array.isArray(payload.chartsPreview) && payload.chartsPreview.length > 0);
  assert.equal(payload.correlationControl?.activo, true);
  assert.equal(payload.correlationControl?.metodo, "spearman");
  assert.equal(typeof payload.correlationControl?.obtenido, "number");
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

test("prueba de confiabilidad: /cronbach genera el Excel con alfa en el nivel pedido", async () => {
  const sinToken = await fetch(`${BASE}/cronbach`, { method: "POST" });
  assert.equal(sinToken.status, 401);

  const user = await login("user@test.local", "OtraClave123!");
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${user.body.token}` };
  const res = await fetch(`${BASE}/cronbach`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      config: {
        variable: "Clima organizacional",
        encuestados: 30,
        respuesta: 5,
        dimensiones: [
          { nombre: "Comunicación", items: 8 },
          { nombre: "Liderazgo", items: 7 },
        ],
        nivelAlfa: "excelente",
      },
    }),
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.K, 15);
  assert.equal(payload.encuestados, 30);
  assert.equal(payload.etiqueta, "Excelente");
  assert.ok(payload.alpha >= 0.85, `alfa alto (obtenido ${payload.alpha})`);
  assert.ok(payload.excelBase64.length > 1000);
  assert.equal(payload.excelFileName, "Alfa_Cronbach.xlsx");

  // Config invalida: mensaje claro.
  const invalido = await fetch(`${BASE}/cronbach`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ config: { variable: "X", encuestados: 30 } }),
  });
  assert.equal(invalido.status, 500);
  assert.match((await invalido.json()).error, /al menos 2 items/);
});

test("claves de API: generar, validar, vencimiento y revocar", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` };

  // Sin clave al inicio
  let res = await fetch(`${BASE}/auth/api-key`, { headers: auth });
  let body = await res.json();
  assert.equal(body.hasKey, false);

  // Generar: la clave en claro llega una sola vez
  res = await fetch(`${BASE}/auth/api-key`, { method: "POST", headers: auth });
  body = await res.json();
  assert.match(body.apiKey, /^ttab_[0-9a-f]{48}$/);
  const apiKey = body.apiKey;

  // Validacion de servicio: clave valida
  const validate = (key) => fetch(`${BASE}/integrations/validate-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  }).then((r) => r.json());

  let v = await validate(apiKey);
  assert.equal(v.valid, true);
  assert.equal(v.email, ADMIN_EMAIL);

  // Clave desconocida y formato invalido
  v = await validate(`ttab_${"0".repeat(48)}`);
  assert.equal(v.valid, false);
  assert.equal(v.reason, "clave_desconocida");
  v = await validate("no-es-una-clave");
  assert.equal(v.valid, false);

  // Usuario con suscripcion vencida: desacoplado — la clave de Forms sigue
  // valida (va por usos), el login funciona, pero /generate exige dias.
  const created = await fetch(`${BASE}/auth/users`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ email: "vencido@test.local", password: "ClaveVencida1!", subscriptionDays: 30 }),
  });
  const createdBody = await created.json();
  const expiredLogin = await login("vencido@test.local", "ClaveVencida1!");
  const expiredKeyRes = await fetch(`${BASE}/auth/api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${expiredLogin.body.token}` },
  });
  const expiredKey = (await expiredKeyRes.json()).apiKey;
  await fetch(`${BASE}/auth/users/${createdBody.user.id}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ subscriptionEndsAt: "2020-01-01T00:00:00.000Z" }),
  });
  v = await validate(expiredKey);
  assert.equal(v.valid, true);
  assert.equal(v.usesLeft, 0);
  const expiredLogin2 = await login("vencido@test.local", "ClaveVencida1!");
  assert.equal(expiredLogin2.status, 200);
  const genExpired = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${expiredLogin2.body.token}` },
    body: JSON.stringify({ config: { muestra: "10", item: "4", variable: "1" }, responseMode: "inline" }),
  });
  assert.equal(genExpired.status, 403);
  assert.match((await genExpired.json()).error, /Suscripcion vencida/);

  // Revocar
  res = await fetch(`${BASE}/auth/api-key`, { method: "DELETE", headers: auth });
  assert.equal(res.status, 200);
  v = await validate(apiKey);
  assert.equal(v.valid, false);
});

test("Forms por usos: consume 1 uso por corrida, bloquea sin usos y admin recarga", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` };

  // Usuario nuevo con 2 usos asignados desde la creacion.
  const created = await fetch(`${BASE}/auth/users`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ email: "usos@test.local", password: "ClaveUsos123!", subscriptionDays: 30, formsUses: 2 }),
  });
  const createdBody = await created.json();
  assert.equal(createdBody.user.formsUsesLeft, 2);

  const userLogin = await login("usos@test.local", "ClaveUsos123!");
  const keyRes = await fetch(`${BASE}/auth/api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userLogin.body.token}` },
  });
  const apiKey = (await keyRes.json()).apiKey;

  // La extension ve los usos restantes en /api/tesistab/config.
  const cfgRes = await fetch(`${BASE}/api/tesistab/config`, { headers: { "X-API-Key": apiKey } });
  assert.equal(cfgRes.status, 200);
  assert.equal((await cfgRes.json()).user.usesLeft, 2);

  const submit = () => fetch(`${BASE}/api/tesistab/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      formUrl: "https://docs.google.com/forms/d/e/prueba-usos/formResponse",
      payload: { "entry.1": "hola" },
      count: 1,
    }),
  });

  // 1 uso = 1 corrida: 2 corridas consumen los 2 usos; la tercera se bloquea.
  let res = await submit();
  assert.equal(res.status, 202);
  assert.equal((await res.json()).usesLeft, 1);
  res = await submit();
  assert.equal(res.status, 202);
  assert.equal((await res.json()).usesLeft, 0);
  res = await submit();
  assert.equal(res.status, 403);

  // El admin recarga usos desde el dashboard.
  const patch = await fetch(`${BASE}/auth/users/${createdBody.user.id}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ formsUsesDelta: 5 }),
  });
  assert.equal((await patch.json()).user.formsUsesLeft, 5);

  // El admin puede revocar la clave del usuario: la extension deja de validar.
  const revoke = await fetch(`${BASE}/auth/users/${createdBody.user.id}/api-key`, { method: "DELETE", headers: auth });
  assert.equal(revoke.status, 200);
  const cfgAfter = await fetch(`${BASE}/api/tesistab/config`, { headers: { "X-API-Key": apiKey } });
  assert.equal(cfgAfter.status, 401);

  // Metricas de generacion por usuario en el listado del admin.
  const list = await fetch(`${BASE}/auth/users`, { headers: auth });
  const listBody = await list.json();
  const generador = listBody.users.find((u) => u.email === "user@test.local");
  assert.ok(generador && generador.generationsCount >= 1, "generationsCount registrado");
});

test("contraseña self-service, historial de actividad y respaldo", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` };

  // Self-service: la contraseña actual incorrecta se rechaza.
  const userLogin = await login("usos@test.local", "ClaveUsos123!");
  const userAuth = { "Content-Type": "application/json", Authorization: `Bearer ${userLogin.body.token}` };
  let res = await fetch(`${BASE}/auth/change-password`, {
    method: "POST",
    headers: userAuth,
    body: JSON.stringify({ currentPassword: "equivocada", newPassword: "NuevaClave123!" }),
  });
  assert.equal(res.status, 401);
  res = await fetch(`${BASE}/auth/change-password`, {
    method: "POST",
    headers: userAuth,
    body: JSON.stringify({ currentPassword: "ClaveUsos123!", newPassword: "NuevaClave123!" }),
  });
  assert.equal(res.status, 200);
  const changed = await res.json();
  assert.ok(changed.token, "el cambio devuelve un token fresco");
  assert.equal((await login("usos@test.local", "ClaveUsos123!")).status, 401);
  assert.equal((await login("usos@test.local", "NuevaClave123!")).status, 200);

  // Las sesiones anteriores quedan invalidadas; el token fresco sigue vivo.
  const meOld = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${userLogin.body.token}` } });
  assert.equal(meOld.status, 401);
  const meNew = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${changed.token}` } });
  assert.equal(meNew.status, 200);

  // Rate limiting del cambio de contraseña (LOGIN_MAX_ATTEMPTS=3 en tests).
  const freshAuth = { "Content-Type": "application/json", Authorization: `Bearer ${changed.token}` };
  for (let i = 0; i < 3; i += 1) {
    const bad = await fetch(`${BASE}/auth/change-password`, {
      method: "POST",
      headers: freshAuth,
      body: JSON.stringify({ currentPassword: "adivinando", newPassword: "LoQueSea123!" }),
    });
    assert.equal(bad.status, 401);
  }
  const blockedChange = await fetch(`${BASE}/auth/change-password`, {
    method: "POST",
    headers: freshAuth,
    body: JSON.stringify({ currentPassword: "adivinando", newPassword: "LoQueSea123!" }),
  });
  assert.equal(blockedChange.status, 429);

  // Historial: las corridas de Forms y recargas del test anterior quedaron registradas.
  const list = await fetch(`${BASE}/auth/users`, { headers: auth });
  const listBody = await list.json();
  const conUsos = listBody.users.find((u) => u.email === "usos@test.local");
  assert.ok(Array.isArray(conUsos.activity) && conUsos.activity.length > 0, "historial presente");
  assert.ok(conUsos.activity.some((e) => e.detail.includes("Corrida de Forms")), "corridas registradas");
  assert.ok(conUsos.activity.some((e) => e.detail.includes("usos de Forms")), "recarga registrada");
  assert.ok(conUsos.activity.some((e) => e.detail.includes("Cambió su contraseña")), "cambio de contraseña registrado");

  // Respaldo: exportar y restaurar el almacen completo.
  const backupRes = await fetch(`${BASE}/auth/users/backup`, { headers: auth });
  assert.equal(backupRes.status, 200);
  const backup = await backupRes.json();
  assert.ok(Array.isArray(backup.users) && backup.users.length >= 2);
  assert.ok(backup.users[0].passwordHash, "el respaldo conserva credenciales");

  const restoreRes = await fetch(`${BASE}/auth/users/restore`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ users: backup.users }),
  });
  assert.equal(restoreRes.status, 200);
  assert.equal((await restoreRes.json()).restored, backup.users.length);
  // Tras restaurar, las cuentas siguen funcionando.
  assert.equal((await login("usos@test.local", "NuevaClave123!")).status, 200);
  assert.equal((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status, 200);

  // El respaldo invalido se rechaza sin tocar el almacen.
  const badRestore = await fetch(`${BASE}/auth/users/restore`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ users: [{ email: "roto@test.local" }] }),
  });
  assert.equal(badRestore.status, 400);
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
