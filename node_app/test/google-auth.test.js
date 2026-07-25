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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ID = "1234567890-pruebadetest.apps.googleusercontent.com";

const arrancar = async (puerto, env) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-goog-"));
  const child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PORT: String(puerto),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      ADMIN_EMAIL: "admin@test.local",
      ADMIN_PASSWORD: "ClaveDePrueba123!",
      ...env,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${puerto}/health`)).ok) return { child, tmpDir };
    } catch { /* aun no levanta */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("La API no levanto a tiempo.");
};

describe("Google configurado", () => {
  const PORT = 18274;
  const BASE = `http://127.0.0.1:${PORT}`;
  let proc;

  before(async () => { proc = await arrancar(PORT, { GOOGLE_CLIENT_ID: CLIENT_ID }); });
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

  test("/config sirve los planes, para no duplicarlos en el frontend", async () => {
    const { planes, planPredeterminado } = await (await fetch(`${BASE}/config`)).json();
    assert.equal(planPredeterminado, "free");
    assert.equal(planes.free.titulos, 0, "el plan free no regala la herramienta mas cara");
    assert.ok(planes.free.tabulacion > 0);
    assert.ok(planes.tesista, "tambien vienen los planes de pago");
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
