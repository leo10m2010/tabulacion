// Recuperacion de usos que quedaron a medias en un reinicio.
//
// Los jobs de IA viven solo en memoria: si el proceso muere mientras uno corre
// (deploy, suspension del hosting, OOM), el `.catch` que devuelve el uso nunca
// se ejecuta y el usuario pierde el uso sin recibir nada. El servidor anota
// cada uso descontado en pending-uses.json y lo devuelve al arrancar.
//
// Aqui se simula exactamente eso: se arranca el servidor, se deja una anotacion
// de uso pendiente (como la que habria dejado un job interrumpido), se reinicia
// y se comprueba que el uso volvio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { esperarSalud } from "./helpers/servidor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18237;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";

let tmpDir;
let child;

const storePath = () => path.join(tmpDir, "users.json");
const pendingPath = () => path.join(tmpDir, "pending-uses.json");
const jobsPath = () => path.join(tmpDir, "jobs.json");

const waitForHealth = () => esperarSalud(BASE, child);

const startServer = async () => {
  child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      USER_STORE_PATH: storePath(),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
};

const stopServer = async () => {
  if (!child) return;
  const done = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await done;
  child = null;
};

const login = async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await res.json();
  return body.token;
};

const findUser = async (token, email) => {
  const res = await fetch(`${BASE}/auth/users`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  return body.users.find((u) => u.email === email);
};

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-pending-"));
  await startServer();
});

after(async () => {
  await stopServer();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("un uso que quedo a medias en un reinicio se devuelve al arrancar", async () => {
  const token = await login();
  const email = "tesista@test.local";
  const crear = await fetch(`${BASE}/auth/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email,
      password: "ClaveTesista123!",
      role: "user",
      plan: "tesista",
      uses: { descriptiva: 3 },
    }),
  });
  assert.equal(crear.status, 201);
  const creado = (await crear.json()).user;
  assert.equal(creado.uses.descriptiva, 3);

  // Estado que deja un job interrumpido: el uso ya fue descontado del store y
  // la anotacion quedo en disco porque el job nunca llego a cerrarse.
  const usuarios = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
  const registro = usuarios.find((u) => u.id === creado.id);
  registro.uses.descriptiva = 2;
  registro.usesConsumed.descriptiva = 1;
  fs.writeFileSync(storePath(), JSON.stringify(usuarios, null, 2), "utf-8");
  fs.writeFileSync(pendingPath(), JSON.stringify([
    { jobId: "job-interrumpido", userId: creado.id, tool: "descriptiva", at: new Date().toISOString() },
  ]), "utf-8");
  fs.writeFileSync(jobsPath(), JSON.stringify([{
    id: "job-interrumpido",
    userId: creado.id,
    type: "descriptiva",
    status: "processing",
    parameters: { input: { texto: "contenido que no debe quedar retenido" } },
    progress: { stage: "generating" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }]), "utf-8");

  await stopServer();
  await startServer();

  const token2 = await login();
  const recuperado = await findUser(token2, email);
  assert.equal(recuperado.uses.descriptiva, 3, "el uso interrumpido volvio a su saldo");
  assert.equal(recuperado.usesConsumed.descriptiva, 0, "y deja de contar como consumido");

  assert.deepEqual(JSON.parse(fs.readFileSync(pendingPath(), "utf-8")), [], "el registro queda vacio");
  const durable = JSON.parse(fs.readFileSync(jobsPath(), "utf-8"))[0];
  assert.equal(durable.status, "failed", "el job durable no queda bloqueando la cola");
  assert.equal(durable.parameters.input, undefined, "el input sensible se retira al reconciliar");
  assert.match(durable.progress.error, /reinici/i);
});

test("un segundo reinicio no vuelve a devolver el mismo uso", async () => {
  const token = await login();
  const email = "tesista@test.local";
  const antes = await findUser(token, email);

  await stopServer();
  await startServer();

  const token2 = await login();
  const despues = await findUser(token2, email);
  assert.equal(despues.uses.descriptiva, antes.uses.descriptiva, "sin reembolsos duplicados");
});

test("los usos pendientes de un usuario borrado no rompen el arranque", async () => {
  fs.writeFileSync(pendingPath(), JSON.stringify([
    { jobId: "job-fantasma", userId: "no-existe", tool: "matriz", at: new Date().toISOString() },
  ]), "utf-8");

  await stopServer();
  await startServer();

  const token = await login();
  assert.ok(token, "el servidor arranca igual");
  assert.deepEqual(JSON.parse(fs.readFileSync(pendingPath(), "utf-8")), []);
});
