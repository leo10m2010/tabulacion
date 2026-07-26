// Endurecimiento de la superficie HTTP.
//
// Cubre dos hallazgos de la auditoria de seguridad:
//
//   1. La API no emitia NINGUNA cabecera de seguridad: se podia enmarcar
//      (clickjacking sobre el panel de administracion), el navegador podia
//      adivinar el tipo de contenido y la URL completa viajaba como referente
//      hacia terceros.
//
//   2. Los cuatro endpoints de IA comprobaban la concurrencia contra un mapa
//      de jobs que solo se poblaba DESPUES de un await (writeUsers), dejando
//      una ventana en la que dos peticiones simultaneas del mismo usuario
//      podian pasar las dos el control y arrancar dos generaciones, gastando
//      dos veces en OpenRouter. El arreglo mueve el registro antes del await,
//      con lo que comprobar y registrar quedan en el mismo turno del event
//      loop y la ventana desaparece por construccion.
//
//      HONESTIDAD SOBRE ESTA PRUEBA: la ventana era estrecha y no consegui
//      dispararla de forma fiable desde fuera (con el codigo sin arreglar esta
//      prueba tambien pasa). Por tanto NO demuestra que el fallo fuera
//      explotable: es un guardian del invariante "una sola generacion por
//      usuario a la vez", que es lo que hay que conservar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { esperarSalud } from "./helpers/servidor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18291;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: "admin@test.local", password: "ClaveDePrueba123!" };

let child;
let tmpDir;
let iaLenta;

before(async () => {
  // OpenRouter falso que nunca contesta. Es lo que mantiene el job en
  // "processing" el tiempo suficiente para que la segunda peticion se
  // encuentre con el: sin clave real, la generacion falla en microsegundos y
  // el job sale de "activo" antes de que llegue la segunda, con lo que la
  // carrera no se puede ejercitar.
  iaLenta = http.createServer(() => { /* deliberadamente sin responder */ });
  await new Promise((r) => iaLenta.listen(0, "127.0.0.1", r));
  const iaUrl = `http://127.0.0.1:${iaLenta.address().port}/v1/chat/completions`;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-hardening-"));
  child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      OPENROUTER_API_KEY: "clave-de-prueba",
      OPENROUTER_BASE_URL: iaUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await esperarSalud(BASE, child);
});

after(async () => {
  child?.kill();
  if (iaLenta) await new Promise((r) => iaLenta.close(r));
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("toda respuesta de la API lleva las cabeceras de seguridad", async () => {
  const res = await fetch(`${BASE}/health`);

  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=\d+/);
});

test("tambien las respuestas de error las llevan", async () => {
  const res = await fetch(`${BASE}/ruta-que-no-existe`);

  assert.equal(res.status, 404);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
});

test("dos generaciones simultaneas del mismo usuario: solo una arranca", async () => {
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  const { token } = await login.json();
  assert.ok(token, "el login de prueba deberia devolver token");

  const pedir = () => fetch(`${BASE}/descriptiva`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      texto: "Cuestionario de prueba con preguntas suficientes para pasar el minimo de longitud exigido.",
      config: { n: 10 },
    }),
  });

  // Simultaneas de verdad: se lanzan sin esperar la primera, que es
  // exactamente la ventana que abria la carrera.
  const [a, b] = await Promise.all([pedir(), pedir()]);
  const estados = [a.status, b.status].sort();

  // Una entra (202) y la otra choca con el control de concurrencia (409).
  // Antes las dos devolvian 202 y se lanzaban dos generaciones.
  assert.deepEqual(estados, [202, 409], `estados obtenidos: ${estados.join(", ")}`);
});
