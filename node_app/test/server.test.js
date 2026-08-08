import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { esperarSalud } from "./helpers/servidor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18234;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";

let child;
let tmpDir;

const waitForHealth = () => esperarSalud(BASE, child);

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
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
});

after(() => {
  child?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// El Excel viaja como base64 y se construye en un worker aparte. Un Buffer
// que cruza el limite del worker llega como Uint8Array, y si no se re-envuelve
// `.toString("base64")` devuelve "80,75,3,4,..." en vez de base64: una cadena
// MAS larga que la real, que pasaria cualquier chequeo de longitud. Por eso se
// verifica que decodifique a un .xlsx de verdad (firma ZIP "PK").
const assertXlsxBase64 = (base64, label) => {
  assert.ok(base64 && base64.length > 1000, `${label}: base64 presente`);
  assert.match(base64, /^[A-Za-z0-9+/=]+$/, `${label}: es base64 valido`);
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", `${label}: firma de archivo xlsx`);
};

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

test("logout revoca solo la sesion presentada", async () => {
  const first = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const second = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const logout = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${first.body.token}` },
  });
  assert.equal(logout.status, 200);
  const revoked = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${first.body.token}` },
  });
  const stillActive = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${second.body.token}` },
  });
  assert.equal(revoked.status, 401);
  assert.equal(stillActive.status, 200);
});

test("lista sesiones y revoca todas salvo la sesion actual", async () => {
  const first = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const current = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const listed = await fetch(`${BASE}/auth/sessions`, {
    headers: { Authorization: `Bearer ${current.body.token}` },
  });
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.ok(listedBody.sessions.some((session) => session.current));
  assert.ok(listedBody.sessions.some((session) => !session.current && !session.revokedAt));

  const revoke = await fetch(`${BASE}/auth/sessions/revoke-others`, {
    method: "POST",
    headers: { Authorization: `Bearer ${current.body.token}` },
  });
  assert.equal(revoke.status, 200);
  assert.ok((await revoke.json()).revoked >= 1);

  const oldSession = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${first.body.token}` },
  });
  const currentSession = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${current.body.token}` },
  });
  assert.equal(oldSession.status, 401);
  assert.equal(currentSession.status, 200);
});

test("empareja y revoca una instalacion sin exponer el secreto en la URL", async () => {
  const pairingResponse = await fetch(`${BASE}/auth/device-pairings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "evil.example",
      "X-Forwarded-Proto": "https",
    },
    body: JSON.stringify({ deviceName: "Chrome de prueba" }),
  });
  assert.equal(pairingResponse.status, 201);
  const pairing = await pairingResponse.json();
  assert.ok(pairing.pairingId);
  assert.ok(pairing.deviceSecret);
  assert.match(pairing.userCode, /^[A-Z2-9]{8}$/);
  assert.equal(pairing.verificationUrl, `http://localhost:${PORT}/cuenta`,
    "Host y X-Forwarded-Proto no contaminan enlaces emitidos por la API");

  const legacyPending = await fetch(
    `${BASE}/auth/device-pairings/${pairing.pairingId}?secret=${encodeURIComponent(pairing.deviceSecret)}`,
  );
  assert.equal(legacyPending.status, 200);
  assert.equal(legacyPending.headers.get("deprecation"), "true");
  assert.equal(legacyPending.headers.get("sunset"), "Mon, 07 Sep 2026 00:00:00 GMT");

  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const approval = await fetch(`${BASE}/auth/device-pairings/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin.body.token}`,
    },
    body: JSON.stringify({ userCode: pairing.userCode }),
  });
  assert.equal(approval.status, 200);

  const credentialResponse = await fetch(
    `${BASE}/auth/device-pairings/${pairing.pairingId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSecret: pairing.deviceSecret }),
    },
  );
  assert.equal(credentialResponse.status, 200);
  assert.equal(credentialResponse.headers.get("cache-control"), "no-store");
  const credential = await credentialResponse.json();
  assert.match(credential.apiKey, /^ttab_[a-f0-9]{48}$/);

  const devicesResponse = await fetch(`${BASE}/auth/devices`, {
    headers: { Authorization: `Bearer ${admin.body.token}` },
  });
  const devices = (await devicesResponse.json()).devices;
  const device = devices.find((item) => item.name === "Chrome de prueba");
  assert.ok(device);

  const beforeRevoke = await fetch(`${BASE}/api/tesistab/config`, {
    headers: { "X-API-Key": credential.apiKey },
  });
  assert.equal(beforeRevoke.status, 200);
  const revoke = await fetch(`${BASE}/auth/devices/${device.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${admin.body.token}` },
  });
  assert.equal(revoke.status, 200);
  const afterRevoke = await fetch(`${BASE}/api/tesistab/config`, {
    headers: { "X-API-Key": credential.apiKey },
  });
  assert.equal(afterRevoke.status, 401);

  const replay = await fetch(`${BASE}/auth/device-pairings/${pairing.pairingId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceSecret: pairing.deviceSecret }),
  });
  assert.equal(replay.status, 410);
});

test("un emparejamiento concurrente entrega exactamente una credencial", async () => {
  const createdResponse = await fetch(`${BASE}/auth/device-pairings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceName: "Chrome concurrente" }),
  });
  assert.equal(createdResponse.status, 201);
  const pairing = await createdResponse.json();
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const approval = await fetch(`${BASE}/auth/device-pairings/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin.body.token}`,
    },
    body: JSON.stringify({ userCode: pairing.userCode }),
  });
  assert.equal(approval.status, 200);

  const deliver = () => fetch(`${BASE}/auth/device-pairings/${pairing.pairingId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceSecret: pairing.deviceSecret }),
  });
  const deliveries = await Promise.all([deliver(), deliver()]);
  assert.deepEqual(deliveries.map((response) => response.status).sort(), [200, 410]);
  const successful = deliveries.find((response) => response.status === 200);
  assert.match((await successful.json()).apiKey, /^ttab_[a-f0-9]{48}$/);
});

test("renovar o revocar una instalacion no invalida las demas", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const pair = async (deviceName) => {
    const created = await fetch(`${BASE}/auth/device-pairings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName }),
    });
    assert.equal(created.status, 201);
    const pairing = await created.json();
    const approved = await fetch(`${BASE}/auth/device-pairings/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.body.token}`,
      },
      body: JSON.stringify({ userCode: pairing.userCode }),
    });
    assert.equal(approved.status, 200);
    const delivered = await fetch(`${BASE}/auth/device-pairings/${pairing.pairingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSecret: pairing.deviceSecret }),
    });
    assert.equal(delivered.status, 200);
    return delivered.json();
  };
  const first = await pair("Chrome principal");
  const second = await pair("Chrome secundario");
  const list = await fetch(`${BASE}/auth/devices`, {
    headers: { Authorization: `Bearer ${admin.body.token}` },
  });
  const devices = (await list.json()).devices;
  const firstDevice = devices.find((device) => device.name === "Chrome principal");
  const secondDevice = devices.find((device) => device.name === "Chrome secundario");
  assert.ok(firstDevice && secondDevice);

  const validate = (apiKey) => fetch(`${BASE}/api/tesistab/config`, {
    headers: { "X-API-Key": apiKey },
  });
  assert.equal((await validate(first.apiKey)).status, 200);
  assert.equal((await validate(second.apiKey)).status, 200);

  const renewedResponse = await fetch(`${BASE}/auth/api-key`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${admin.body.token}`,
      "X-Device-Id": firstDevice.id,
    },
  });
  assert.equal(renewedResponse.status, 200);
  const renewed = await renewedResponse.json();
  assert.equal((await validate(first.apiKey)).status, 401, "la credencial anterior se revoca");
  assert.equal((await validate(renewed.apiKey)).status, 200, "la instalacion renovada valida");
  assert.equal((await validate(second.apiKey)).status, 200, "la segunda instalacion sigue valida");

  const revoke = await fetch(`${BASE}/auth/devices/${firstDevice.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${admin.body.token}` },
  });
  assert.equal(revoke.status, 200);
  assert.equal((await validate(renewed.apiKey)).status, 401);
  assert.equal((await validate(second.apiKey)).status, 200,
    "revocar una instalacion no invalida las credenciales hermanas");
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
  assertXlsxBase64(payload.excelBase64, "tabulacion correlacional");
  assert.equal(payload.tema, "clasico");
  assert.ok(Array.isArray(payload.chartsPreview) && payload.chartsPreview.length > 0);
  assert.equal(payload.correlationControl?.activo, true);
  assert.equal(payload.correlationControl?.metodo, "spearman");
  assert.equal(typeof payload.correlationControl?.obtenido, "number");
});

test("/generate reutiliza el resultado con la misma idempotencyKey", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const raw = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "Tabulacion.json"), "utf-8"));
  const body = JSON.stringify({
    config: { ...raw, muestra: "12", seed: "api-idempotente" },
    responseMode: "links",
    idempotencyKey: "generate-idempotente-001",
  });
  const request = () => fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body,
  });
  const firstResponse = await request();
  const first = await firstResponse.json();
  const secondResponse = await request();
  const second = await secondResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(second.id, first.id);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.seed, first.seed);
});

test("la gestion de usuarios sigue siendo solo para admins", async () => {
  const user = await login("user@test.local", "OtraClave123!");
  const res = await fetch(`${BASE}/auth/users`, { headers: { Authorization: `Bearer ${user.body.token}` } });
  assert.equal(res.status, 403);
});

test("/generate con diseno cuasiexperimental responde analisis y Excel", async () => {
  const user = await login("user@test.local", "OtraClave123!");
  const config = JSON.parse(fs.readFileSync(
    path.join(SCRIPT_DIR, "..", "..", "examples", "Tabulacion_cuasiexperimental.json"),
    "utf-8",
  ));
  const gen = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.body.token}` },
    body: JSON.stringify({ config: { ...config, nExperimental: 12, nControl: 12 }, responseMode: "inline" }),
  });
  assert.equal(gen.status, 200);
  const payload = await gen.json();
  assert.equal(payload.diseno, "cuasiexperimental");
  assert.equal(payload.correlation, null);
  assert.ok(payload.quasiExperimental, "incluye el analisis cuasiexperimental");
  assert.equal(payload.quasiExperimental.comparisons.length, 3);
  assert.ok(payload.quasiExperimental.baseline.hypotheses.nula.startsWith("H₀"));
  assertXlsxBase64(payload.excelBase64, "tabulacion cuasiexperimental");
  assert.equal(payload.baseCsv.split("\n").length, 1 + 24);
  assert.ok(Array.isArray(payload.chartsPreview) && payload.chartsPreview.length === 1);
});

test("config que excede los limites devuelve 400 sin consumir cuota", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const config = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "Tabulacion.json"), "utf-8"));
  const gen = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body: JSON.stringify({ config: { ...config, muestra: "99999" }, responseMode: "inline" }),
  });
  assert.equal(gen.status, 400);
  const payload = await gen.json();
  assert.match(payload.error, /muestra maxima soportada/);
  assert.equal(payload.code, "INVALID_GENERATION_CONFIG");
  assert.equal(payload.field, "config");
  assert.equal(payload.retryable, false);
  assert.ok(payload.requestId);

  const genItems = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body: JSON.stringify({
      config: { ...config, items_por_dim_v1: ["30", "30", "30"] },
      responseMode: "inline",
    }),
  });
  assert.equal(genItems.status, 400);
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
  assertXlsxBase64(payload.excelBase64, "confiabilidad");
  assert.equal(payload.excelFileName, "Alfa_Cronbach.xlsx");

  // Config invalida: mensaje claro.
  const invalido = await fetch(`${BASE}/cronbach`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ config: { variable: "X", encuestados: 30 } }),
  });
  assert.equal(invalido.status, 400);
  const invalidPayload = await invalido.json();
  assert.equal(invalidPayload.code, "INVALID_CRONBACH_CONFIG");
  assert.match(invalidPayload.error, /al menos 2 items/);
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

  // Usuario sin usos: la clave de Forms sigue valida (la cuenta esta activa),
  // el login funciona, pero cada herramienta exige usos disponibles.
  const created = await fetch(`${BASE}/auth/users`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      email: "vencido@test.local",
      password: "ClaveVencida1!",
      uses: { tabulacion: 0, confiabilidad: 0, descriptiva: 0, titulos: 0, matriz: 0, humanizador: 0, forms: 0 },
    }),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  const expiredLogin = await login("vencido@test.local", "ClaveVencida1!");
  const expiredKeyRes = await fetch(`${BASE}/auth/api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${expiredLogin.body.token}` },
  });
  const expiredKey = (await expiredKeyRes.json()).apiKey;
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
  assert.match((await genExpired.json()).error, /No te quedan usos/);
  assert.equal(createdBody.user.uses.tabulacion, 0);

  // Revocar
  res = await fetch(`${BASE}/auth/api-key`, { method: "DELETE", headers: auth });
  assert.equal(res.status, 200);
  v = await validate(apiKey);
  assert.equal(v.valid, false);
});

test("Forms por respuestas: reserva el total, bloquea sin saldo y admin recarga", async () => {
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

  const submit = (count = 1) => fetch(`${BASE}/api/tesistab/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      formUrl: "https://docs.google.com/forms/d/e/prueba-usos/formResponse",
      payload: { "entry.1": "hola" },
      count,
      ownOrAuthorized: true,
    }),
  });

  // Se reservan todas las respuestas del trabajo de forma atomica; otro
  // trabajo no puede gastar el mismo saldo mientras el primero está activo.
  let res = await submit(2);
  assert.equal(res.status, 202);
  assert.equal((await res.json()).responsesLeft, 0);
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
  assert.ok(conUsos.activity.some((e) => e.detail.includes("respuesta(s) de Forms")), "reservas registradas");
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
