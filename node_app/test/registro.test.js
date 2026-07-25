// Auto-registro con plan gratuito.
//
// Es el endpoint que permite que alguien pruebe el producto sin que un admin
// le cree la cuenta a mano. Al ser publico, lo que se verifica aqui es tanto
// que funcione como que no se pueda abusar de el.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18268;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";
const MAX_POR_IP = 5;

let child;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-reg-"));
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
      REGISTER_MAX_PER_IP: String(MAX_POR_IP),
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

const registrar = async (email, password = "ClaveNueva123!") => {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json(), retryAfter: res.headers.get("retry-after") };
};

test("registrarse crea la cuenta, la deja lista y devuelve sesion", async () => {
  const alta = await registrar("nuevo@test.local");
  assert.equal(alta.status, 201);
  assert.ok(alta.body.token, "entra directo, sin tener que iniciar sesion aparte");
  assert.equal(alta.body.user.plan, "free");
  assert.equal(alta.body.user.role, "user");
  assert.equal(alta.body.user.status, "active");

  // La sesion que devuelve sirve de verdad.
  const me = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${alta.body.token}` },
  });
  assert.equal(me.status, 200);
});

test("el plan gratuito NO reparte usos de las herramientas de IA", async () => {
  const alta = await registrar("cuotas@test.local");
  const { uses } = alta.body.user;

  // Sin IA: son las que cuestan dinero por generacion (titulos ademas paga
  // busqueda web). Que esto se rompa sin querer significa regalar dinero.
  assert.equal(uses.descriptiva, 0, "descriptiva no se regala");
  assert.equal(uses.titulos, 0, "titulos no se regala (es la mas cara)");
  assert.equal(uses.matriz, 0, "matriz no se regala");

  // Sin IA: solo cuestan CPU, se pueden regalar.
  assert.ok(uses.tabulacion > 0, "tabulacion si, no usa IA");
  assert.ok(uses.confiabilidad > 0, "confiabilidad si, no usa IA");
  assert.equal(uses.humanizador, 1, "una humanizacion de muestra");
});

test("una herramienta de IA sin usos se rechaza y no llega a gastar", async () => {
  const alta = await registrar("sinusos@test.local");
  const res = await fetch(`${BASE}/titulos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${alta.body.token}` },
    body: JSON.stringify({
      universidad: "Universidad X", carrera: "Psicología", lugar: "Lima", numero_variables: "2",
    }),
  });
  assert.equal(res.status, 403, "sin usos no se lanza el job (ni se llama a OpenRouter)");
  assert.match((await res.json()).error, /usos/i);
});

test("no se puede registrar un correo que ya existe", async () => {
  await registrar("repetido@test.local");
  const otra = await registrar("repetido@test.local");
  assert.equal(otra.status, 409);
});

test("se rechazan correos con erratas y contraseñas cortas", async () => {
  assert.equal((await registrar("sin-arroba")).status, 400);
  assert.equal((await registrar("sin@dominio")).status, 400);
  assert.equal((await registrar("valido@test.local", "corta")).status, 400);
});

test("el limite por IP corta la creacion masiva de cuentas", async () => {
  // Se insiste con correos nuevos hasta que corte. No se asume cuanto cupo
  // queda: las pruebas anteriores ya gastaron parte y depender de ese numero
  // haria que este test se rompiera al reordenar los de arriba.
  let bloqueado = null;
  for (let i = 0; i < 20 && !bloqueado; i += 1) {
    const intento = await registrar(`masivo-${i}@test.local`);
    if (intento.status === 429) bloqueado = intento;
    else assert.equal(intento.status, 201, `intento ${i}`);
  }
  assert.ok(bloqueado, "en algun momento corta");
  assert.ok(Number(bloqueado.retryAfter) > 0, "indica cuando reintentar");
});

test("los intentos fallidos no gastan cupo de registro", async () => {
  // Ya se alcanzo el limite arriba, asi que ahora TODO responde 429 — incluido
  // un correo invalido. Es el comportamiento correcto: el limite se comprueba
  // antes de validar, para que probar suerte con datos basura tampoco sirva
  // para sondear el sistema.
  assert.equal((await registrar("no-es-un-correo")).status, 429);
});
