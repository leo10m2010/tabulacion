// Escrituras concurrentes sobre el mismo usuario.
//
// El riesgo: los handlers obtienen una REFERENCIA al objeto del usuario y la
// conservan mientras esperan el cuerpo de la peticion (`await parseJsonBody`).
// Si en esa ventana otra peticion SUSTITUYE el objeto dentro del arreglo
// `users`, la referencia queda huerfana: quien la tenia escribe sobre un
// objeto que ya no forma parte del store, y su cambio se pierde al persistir.
//
// El caso peligroso es el cambio de contraseña: el usuario recibe 200 y un
// token nuevo, pero su contraseña NO cambio. Un fallo de autenticacion
// silencioso.
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
const PORT = 18251;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";

let child;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-conc-"));
  child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await esperarSalud(BASE, child);
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

// Envia una peticion dejando el cuerpo a medias: devuelve una funcion para
// completarlo mas tarde. Asi se abre a voluntad la ventana en la que el
// handler esta esperando en `await parseJsonBody`.
const peticionEnDosPartes = (metodo, ruta, token, cuerpo) => {
  const json = JSON.stringify(cuerpo);
  const mitad = Math.floor(json.length / 2);
  const req = http.request({
    host: "127.0.0.1",
    port: PORT,
    path: ruta,
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Length": Buffer.byteLength(json),
    },
  });
  const respuesta = new Promise((resolve, reject) => {
    req.on("response", (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }));
    });
    req.on("error", reject);
  });
  req.write(json.slice(0, mitad));
  return { respuesta, completar: () => req.end(json.slice(mitad)) };
};

test("un PATCH del admin no anula el cambio de contraseña que el usuario tiene en vuelo", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const email = "concurrente@test.local";
  const PASS_VIEJA = "ClaveInicial123!";
  const PASS_NUEVA = "ClaveNueva456!";

  const crear = await fetch(`${BASE}/auth/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body: JSON.stringify({ email, password: PASS_VIEJA, role: "user", plan: "tesista" }),
  });
  assert.equal(crear.status, 201);
  const usuario = (await crear.json()).user;

  const sesion = await login(email, PASS_VIEJA);
  assert.equal(sesion.status, 200);

  // 1. El usuario empieza a cambiar su contraseña; el servidor queda esperando
  //    el resto del cuerpo, con la referencia al usuario ya en la mano.
  const cambio = peticionEnDosPartes("POST", "/auth/change-password", sesion.body.token, {
    currentPassword: PASS_VIEJA,
    newPassword: PASS_NUEVA,
  });
  await new Promise((r) => setTimeout(r, 100));

  // 2. En esa ventana, el admin modifica al mismo usuario (una recarga de usos
  //    cualquiera). Esta peticion entra y sale completa.
  const patch = await fetch(`${BASE}/auth/users/${usuario.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
    body: JSON.stringify({ usesDelta: { descriptiva: 5 } }),
  });
  assert.equal(patch.status, 200);

  // 3. El usuario termina de enviar su cambio de contraseña.
  cambio.completar();
  const resultado = await cambio.respuesta;
  assert.equal(resultado.status, 200, "el servidor confirma el cambio de contraseña");

  // Si el servidor dijo que si, la contraseña nueva TIENE que funcionar.
  const conNueva = await login(email, PASS_NUEVA);
  assert.equal(conNueva.status, 200, "la contraseña nueva funciona (no se perdio el cambio)");

  const conVieja = await login(email, PASS_VIEJA);
  assert.equal(conVieja.status, 401, "la contraseña vieja ya no sirve");
});

test("el PATCH concurrente si aplica su propio cambio", async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const res = await fetch(`${BASE}/auth/users`, { headers: { Authorization: `Bearer ${admin.body.token}` } });
  const { users } = await res.json();
  const usuario = users.find((u) => u.email === "concurrente@test.local");
  assert.equal(usuario.uses.descriptiva, 15, "los 5 usos recargados por el admin siguen ahi");
});
