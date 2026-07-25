// Proyecto de tesis: el objeto que permite definir el instrumento UNA vez.
//
// Es la recomendacion #1 de la auditoria UX: hoy el instrumento (variables,
// dimensiones, indicadores, items y escala) se re-escribe desde cero en cada
// herramienta, y tras las observaciones del jurado hay que reconstruirlo
// entero.
//
// Lo que mas importa verificar aqui es el AISLAMIENTO: el proyecto de un
// usuario no puede verlo, tocarlo ni borrarlo nadie mas.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { esperarSalud } from "./helpers/servidor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18296;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";

let child;
let tmpDir;

const INSTRUMENTO = {
  escala: ["Nunca", "A veces", "Siempre"],
  variables: [{
    nombre: "Clima laboral",
    dimensiones: [{
      nombre: "Comunicación",
      indicadores: [{ nombre: "Claridad", items: ["Me explican bien", "Entiendo mis tareas"] }],
    }],
    baremo: [
      { nombre: "Bajo", desde: 2, hasta: 3, porcentaje: 50 },
      { nombre: "Alto", desde: 4, hasta: 6, porcentaje: 50 },
    ],
  }],
};

const api = async (metodo, ruta, token, cuerpo) => {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const login = async (email, password) => (await api("POST", "/auth/login", null, { email, password })).body.token;

const crearUsuario = async (adminToken, email, plan = "tesista") => {
  await api("POST", "/auth/users", adminToken, {
    email, password: "ClaveDePrueba123!", role: "user", plan,
  });
  return login(email, "ClaveDePrueba123!");
};

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-proy-"));
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await esperarSalud(BASE, child);
});

after(() => {
  child?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ciclo de vida del proyecto", () => {
  test("se crea, se lee, se renombra y se elimina", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await crearUsuario(admin, "dueno@test.local");

    const creado = await api("POST", "/proyectos", token, {
      nombre: "Tesis de clima laboral",
      instrumento: INSTRUMENTO,
    });
    assert.equal(creado.status, 201);
    const id = creado.body.proyecto.id;
    assert.equal(creado.body.proyecto.nombre, "Tesis de clima laboral");

    // El instrumento se guarda completo, con sus items.
    const inst = creado.body.proyecto.instrumento;
    assert.equal(inst.variables[0].nombre, "Clima laboral");
    assert.equal(inst.variables[0].dimensiones[0].indicadores[0].items.length, 2);
    assert.equal(inst.variables[0].totalItems, 2, "cuenta los ítems por variable");
    assert.deepEqual(inst.escala, ["Nunca", "A veces", "Siempre"]);

    const leido = await api("GET", `/proyectos/${id}`, token);
    assert.equal(leido.status, 200);
    assert.equal(leido.body.proyecto.id, id);

    const renombrado = await api("PATCH", `/proyectos/${id}`, token, { nombre: "Tesis final" });
    assert.equal(renombrado.status, 200);
    assert.equal(renombrado.body.proyecto.nombre, "Tesis final");
    assert.deepEqual(
      renombrado.body.proyecto.instrumento, inst,
      "renombrar no debe tocar el instrumento",
    );

    assert.equal((await api("DELETE", `/proyectos/${id}`, token)).status, 200);
    assert.equal((await api("GET", `/proyectos/${id}`, token)).status, 404);
  });

  test("aparece en la lista del dueño", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await crearUsuario(admin, "lista@test.local");
    await api("POST", "/proyectos", token, { nombre: "Proyecto A", instrumento: INSTRUMENTO });
    const lista = await api("GET", "/proyectos", token);
    assert.equal(lista.status, 200);
    assert.equal(lista.body.proyectos.length, 1);
    assert.equal(lista.body.proyectos[0].nombre, "Proyecto A");
    assert.ok(lista.body.limite > 0, "informa el límite del plan");
  });
});

describe("aislamiento entre usuarios", () => {
  test("nadie puede ver, tocar ni borrar el proyecto de otro", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const dueno = await crearUsuario(admin, "propietario@test.local");
    const ajeno = await crearUsuario(admin, "curioso@test.local");

    const creado = await api("POST", "/proyectos", dueno, {
      nombre: "Privado", instrumento: INSTRUMENTO,
    });
    const id = creado.body.proyecto.id;

    // 404 y no 403: no se confirma siquiera que el proyecto exista.
    assert.equal((await api("GET", `/proyectos/${id}`, ajeno)).status, 404);
    assert.equal((await api("PATCH", `/proyectos/${id}`, ajeno, { nombre: "Mío" })).status, 404);
    assert.equal((await api("DELETE", `/proyectos/${id}`, ajeno)).status, 404);

    // Y sigue intacto para su dueño.
    const sigue = await api("GET", `/proyectos/${id}`, dueno);
    assert.equal(sigue.status, 200);
    assert.equal(sigue.body.proyecto.nombre, "Privado");

    // El listado del otro sigue vacío.
    assert.equal((await api("GET", "/proyectos", ajeno)).body.proyectos.length, 0);
  });

  test("ni siquiera el administrador lo lee", async () => {
    // Un proyecto es material de tesis sin publicar. El admin gestiona cuentas
    // y usos, no el contenido privado de nadie.
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const dueno = await crearUsuario(admin, "reservado@test.local");
    const creado = await api("POST", "/proyectos", dueno, {
      nombre: "Confidencial", instrumento: INSTRUMENTO,
    });
    assert.equal((await api("GET", `/proyectos/${creado.body.proyecto.id}`, admin)).status, 404);
  });

  test("sin sesión no se llega a nada", async () => {
    assert.equal((await api("GET", "/proyectos", null)).status, 401);
    assert.equal((await api("POST", "/proyectos", null, { nombre: "X" })).status, 401);
  });
});

describe("validación del instrumento", () => {
  test("el nombre del proyecto es obligatorio", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await crearUsuario(admin, "sinnombre@test.local");
    const r = await api("POST", "/proyectos", token, { nombre: "   ", instrumento: INSTRUMENTO });
    assert.equal(r.status, 400, "debe ser error del usuario, no del servidor");
    assert.match(r.body.error, /nombre/i);
  });

  test("los porcentajes del baremo deben sumar 100", async () => {
    // El porcentaje NO es decorativo: la simulación lo respeta. Si entrara mal
    // aquí, el Excel saldría con un reparto que nadie pidió.
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await crearUsuario(admin, "baremomal@test.local");
    const malo = JSON.parse(JSON.stringify(INSTRUMENTO));
    malo.variables[0].baremo[1].porcentaje = 30; // 50 + 30 = 80
    const r = await api("POST", "/proyectos", token, { nombre: "Mal baremo", instrumento: malo });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /100%/);
  });

  test("se rechaza pasarse del máximo de ítems", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await crearUsuario(admin, "muchos@test.local");
    const enorme = JSON.parse(JSON.stringify(INSTRUMENTO));
    enorme.variables[0].dimensiones[0].indicadores[0].items =
      Array.from({ length: 61 }, (_, i) => `Ítem ${i + 1}`);
    const r = await api("POST", "/proyectos", token, { nombre: "Enorme", instrumento: enorme });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /ítems|items/i);
  });

  test("un instrumento vacío se acepta: se rellena después", async () => {
    // Crear el proyecto y definir el instrumento son dos momentos distintos.
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await crearUsuario(admin, "vacio@test.local");
    const r = await api("POST", "/proyectos", token, { nombre: "Empezando" });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.proyecto.instrumento, { escala: [], variables: [] });
  });
});

describe("límite por plan", () => {
  test("el plan gratuito solo permite un proyecto", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await crearUsuario(admin, "gratis@test.local", "free");

    assert.equal((await api("POST", "/proyectos", token, { nombre: "Primero" })).status, 201);
    const segundo = await api("POST", "/proyectos", token, { nombre: "Segundo" });
    assert.equal(segundo.status, 403);
    assert.match(segundo.body.error, /plan permite/i);
  });
});

describe("eliminar la cuenta se lleva los proyectos", () => {
  test("no quedan proyectos huérfanos", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const email = "seva@test.local";
    const token = await crearUsuario(admin, email);
    await api("POST", "/proyectos", token, { nombre: "Se va conmigo", instrumento: INSTRUMENTO });

    const borrado = await api("DELETE", "/auth/me", token, { confirmEmail: email });
    assert.equal(borrado.status, 200);

    const guardados = JSON.parse(fs.readFileSync(path.join(tmpDir, "proyectos.json"), "utf-8"));
    assert.equal(
      guardados.some((p) => p.nombre === "Se va conmigo"), false,
      "eliminar la cuenta debe borrar también sus proyectos",
    );
  });
});
