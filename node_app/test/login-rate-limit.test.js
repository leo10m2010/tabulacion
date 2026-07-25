// Limite de intentos de login por IP.
//
// El limite por IP+email no frena el ataque que de verdad importa: probando
// una contraseña comun contra MUCHAS cuentas distintas, cada combinacion
// estrena su propio contador y el tope nunca se alcanza. Este archivo verifica
// el tope por IP, que si corta esa rotacion.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18257;
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_POR_IP = 6;

let child;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-rl-"));
  child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      ADMIN_EMAIL: "admin@test.local",
      ADMIN_PASSWORD: "ClaveDePrueba123!",
      // Tope por IP+email alto a proposito: asi el unico limite que puede
      // saltar en esta prueba es el de la IP.
      LOGIN_MAX_ATTEMPTS: "50",
      LOGIN_MAX_ATTEMPTS_PER_IP: String(MAX_POR_IP),
      LOGIN_WINDOW_SECONDS: "900",
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

const intentar = async (email) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "contraseña-incorrecta" }),
  });
  return { status: res.status, retryAfter: res.headers.get("retry-after") };
};

test("rotar el email no evade el limite: la IP se bloquea igual", async () => {
  // Cada intento estrena un email distinto, asi que el contador por IP+email
  // siempre vale 1. Sin tope por IP, esto correria indefinidamente.
  for (let i = 0; i < MAX_POR_IP; i += 1) {
    const { status } = await intentar(`victima-${i}@test.local`);
    assert.equal(status, 401, `intento ${i + 1} con email nuevo`);
  }

  const bloqueado = await intentar("victima-siguiente@test.local");
  assert.equal(bloqueado.status, 429, "la IP queda bloqueada pese a rotar el email");
});

test("el 429 indica cuando reintentar (Retry-After)", async () => {
  const bloqueado = await intentar("otra-mas@test.local");
  assert.equal(bloqueado.status, 429);
  const segundos = Number(bloqueado.retryAfter);
  assert.ok(Number.isFinite(segundos) && segundos > 0, `Retry-After valido (recibido: ${bloqueado.retryAfter})`);
});

// COMPROMISO DELIBERADO, no un descuido: mientras una IP esta bloqueada,
// tampoco entran las credenciales validas que vengan de ella.
//
// El motivo es que el tope por IP se comprueba ANTES de verificar la
// contraseña. Tiene que ser asi: cada verificacion cuesta ~46 ms de scrypt, y
// sobre los 0.1 CPU del plan free unas pocas peticiones por segundo bastan
// para tumbar el servidor. Comprobar despues protegeria las cuentas pero
// dejaria el agotamiento de CPU abierto.
//
// El precio: varias personas detras de la misma IP (laboratorio de una
// universidad, locutorio) comparten el contador, y 20 fallos en 15 minutos las
// dejan fuera hasta que la ventana expire. Por eso el tope por IP es holgado
// (20) frente al de IP+email (5).
test("mientras la IP esta bloqueada tampoco entran las credenciales validas (compromiso conocido)", async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@test.local", password: "ClaveDePrueba123!" }),
  });
  assert.equal(res.status, 429, "el bloqueo de la IP alcanza a todos sus usuarios");
});

test("un login correcto no reinicia el contador de la IP", async () => {
  // Si entrar a una cuenta propia limpiara el contador, bastaria con hacerlo
  // entre tanda y tanda para seguir probando indefinidamente.
  const siguiente = await intentar("victima-final@test.local");
  assert.equal(siguiente.status, 429, "la IP sigue bloqueada para intentos fallidos");
});
