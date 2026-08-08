// Inicio de sesion con Google.
//
// LIMITE DE ESTAS PRUEBAS, dicho claramente: no verifican el camino feliz.
// Para eso haria falta un ID token firmado por Google de verdad, que no se
// puede fabricar en un test (justamente porque si se pudiera, cualquiera
// podria entrar). El alta real se comprueba iniciando sesion con una cuenta
// de Google contra el entorno desplegado.
//
// Lo que SI se verifica aqui es todo lo que protege ese camino: que un token
// invalido no entre, que no se filtre el detalle tecnico del fallo, y que el
// endpoint no exista si Google no esta configurado. Es donde estaria el
// agujero si algo se rompiera.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { esperarSalud } from "./helpers/servidor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ID = "1234567890-pruebadetest.apps.googleusercontent.com";
const TEST_PROFILES = {
  "google-new": { email: "google-new@test.local", email_verified: true, sub: "sub-google-new", name: "Nueva" },
  "google-new-renamed": { email: "google-renamed@test.local", email_verified: true, sub: "sub-google-new", name: "Nueva" },
  "google-collision": { email: "collision@test.local", email_verified: true, sub: "sub-collision" },
  "google-link": { email: "link@test.local", email_verified: true, sub: "sub-link" },
};

const arrancar = async (puerto, env) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-goog-"));
  const child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PORT: String(puerto),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      NODE_ENV: "test",
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      ADMIN_EMAIL: "admin@test.local",
      ADMIN_PASSWORD: "ClaveDePrueba123!",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await esperarSalud(`http://127.0.0.1:${puerto}`, child);
  return { child, tmpDir };
};

describe("Google configurado", () => {
  const PORT = 18274;
  const BASE = `http://127.0.0.1:${PORT}`;
  let proc;

  before(async () => {
    proc = await arrancar(PORT, {
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_TEST_PROFILES_JSON: JSON.stringify(TEST_PROFILES),
    });
  });
  after(() => {
    proc?.child?.kill();
    if (proc?.tmpDir) fs.rmSync(proc.tmpDir, { recursive: true, force: true });
  });

  test("/config anuncia Google y publica el Client ID", async () => {
    const res = await fetch(`${BASE}/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.auth.google.enabled, true);
    // El Client ID es publico por diseño: identifica a la app ante Google.
    assert.equal(body.auth.google.clientId, CLIENT_ID);
  });

  test("/config sirve planes publicables y capacidades sin registro por correo", async () => {
    const config = await (await fetch(`${BASE}/config`)).json();
    const { planes, planPredeterminado } = config;
    assert.equal(planPredeterminado, "free");
    assert.equal(planes.free.titulos, 0, "el plan free no regala la herramienta mas cara");
    assert.ok(planes.free.tabulacion > 0);
    assert.ok(planes.tesista, "tambien vienen los planes de pago");
    assert.equal(planes.institucion, undefined, "Institucion sigue oculto hasta tener organizaciones");
    assert.equal(config.auth.emailRegistration, false);
    assert.equal(config.capabilities.emailRegistration, false);
    assert.equal(config.capabilities.devicePairing, true);
    assert.equal(config.formsResponses.esencial, 500);
    assert.equal(config.formsResponses.tesista, 2500);
    assert.equal(config.paymentCurrency, "PEN");
  });

  test("un token inventado no entra", async () => {
    const res = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "no.es.un-token" }),
    });
    assert.equal(res.status, 401);
  });

  test("un JWT bien formado pero firmado por otro tampoco entra", async () => {
    // Estructura valida de JWT (tres partes en base64url) para comprobar que
    // el rechazo viene de la FIRMA, no de que no se pueda parsear.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const falso = [
      b64({ alg: "RS256", kid: "inventado" }),
      b64({
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        email: "atacante@gmail.com",
        email_verified: true,
        sub: "123",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
      "firmafalsa",
    ].join(".");

    const res = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: falso }),
    });
    assert.equal(res.status, 401, "sin firma valida de Google no se entra");

    const cuerpo = await res.json();
    // El motivo tecnico se queda en el log del servidor: al cliente no se le
    // dan pistas sobre por que fallo la validacion.
    assert.match(cuerpo.error, /no se pudo validar/i);
    assert.doesNotMatch(cuerpo.error, /kid|firma|jwt|certif/i);
  });

  test("sin credencial responde 401, no un error del servidor", async () => {
    const res = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });

  test("Google crea, recupera por sub estable y actualiza el correo verificado", async () => {
    const authenticate = async (credential) => {
      const response = await fetch(`${BASE}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      return { status: response.status, body: await response.json() };
    };
    const created = await authenticate("google-new");
    assert.equal(created.status, 201);
    assert.equal(created.body.creado, true);
    assert.equal(created.body.user.plan, "free");
    assert.equal(created.body.user.passwordEnabled, false);

    const recurrent = await authenticate("google-new");
    assert.equal(recurrent.status, 200);
    assert.equal(recurrent.body.user.id, created.body.user.id);

    const renamed = await authenticate("google-new-renamed");
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.id, created.body.user.id);
    assert.equal(renamed.body.user.email, "google-renamed@test.local");
  });

  test("el respaldo y la restauracion conservan una cuenta creada con Google", async () => {
    const google = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "google-new" }),
    });
    assert.ok([200, 201].includes(google.status));
    const googleUser = (await google.json()).user;

    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.local", password: "ClaveDePrueba123!" }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };
    const backupResponse = await fetch(`${BASE}/auth/users/backup`, { headers });
    assert.equal(backupResponse.status, 200);
    const backup = await backupResponse.json();
    const backedUpGoogleUser = backup.users.find((user) => user.id === googleUser.id);
    assert.equal(backedUpGoogleUser.passwordEnabled, false);
    assert.equal(backedUpGoogleUser.googleSub, "sub-google-new");

    const restoreResponse = await fetch(`${BASE}/auth/users/restore`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ users: backup.users }),
    });
    assert.equal(restoreResponse.status, 200);

    const restoredLogin = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "google-new" }),
    });
    assert.equal(restoredLogin.status, 200);
    assert.equal((await restoredLogin.json()).user.id, googleUser.id);
  });

  test("no vincula por correo una cuenta manual y permite vinculación con ambas sesiones", async () => {
    const login = async (email, password) => {
      const response = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return response.json();
    };
    const admin = await login("admin@test.local", "ClaveDePrueba123!");
    const createManual = async (email) => fetch(`${BASE}/auth/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({ email, password: "ManualTest123!", role: "user", subscriptionDays: 30 }),
    });
    assert.equal((await createManual("collision@test.local")).status, 201);
    assert.equal((await createManual("link@test.local")).status, 201);

    const collision = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "google-collision" }),
    });
    assert.equal(collision.status, 409);
    assert.equal((await collision.json()).code, "IDENTITY_LINK_REQUIRED");

    const manual = await login("link@test.local", "ManualTest123!");
    const linked = await fetch(`${BASE}/auth/link-google`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${manual.token}`,
      },
      body: JSON.stringify({ currentPassword: "ManualTest123!", credential: "google-link" }),
    });
    assert.equal(linked.status, 200);
    const linkedUser = (await linked.json()).user;
    assert.equal(linkedUser.googleLinked, true);

    const googleLogin = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "google-link" }),
    });
    assert.equal(googleLogin.status, 200);
    assert.equal((await googleLogin.json()).user.id, linkedUser.id);
  });
});

describe("Google sin configurar", () => {
  const PORT = 18275;
  const BASE = `http://127.0.0.1:${PORT}`;
  let proc;

  before(async () => { proc = await arrancar(PORT, { GOOGLE_CLIENT_ID: "" }); });
  after(() => {
    proc?.child?.kill();
    if (proc?.tmpDir) fs.rmSync(proc.tmpDir, { recursive: true, force: true });
  });

  test("/config no ofrece Google si no hay Client ID", async () => {
    const { auth } = await (await fetch(`${BASE}/config`)).json();
    assert.equal(auth.google.enabled, false);
    assert.equal(auth.google.clientId, undefined);
  });

  test("el endpoint responde 503 en vez de fallar de forma rara", async () => {
    const res = await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "lo-que-sea" }),
    });
    assert.equal(res.status, 503);
  });
});
