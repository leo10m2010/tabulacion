// Persistencia en Postgres: lo que de verdad importa es que los usuarios
// sobrevivan a un reinicio con el disco borrado, que es lo que pasa en cada
// deploy del plan gratis de Render.
//
// Solo corre si hay DATABASE_URL (con --env-file=.env). Sin ella se salta, para
// que `npm test` siga funcionando sin base de datos.
//
// Usa tablas con prefijo propio (STORE_TABLE_PREFIX) para no tocar los datos
// reales de la base.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { esperarSalud } from "./helpers/servidor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18262;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "ClaveDePrueba123!";
const PREFIJO = "test_";
const GOOGLE_CLIENT_ID = "postgres-test.apps.googleusercontent.com";
const GOOGLE_TEST_PROFILES = {
  "google-concurrent": {
    email: "google-concurrent@test.local",
    email_verified: true,
    sub: "google-concurrent-http-sub",
  },
};

const HAY_DB = Boolean(String(process.env.DATABASE_URL ?? "").trim());

let child;
let tmpDir;

const arrancar = async () => {
  child = spawn(process.execPath, [path.join(SCRIPT_DIR, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: "true",
      AUTH_TOKEN_SECRET: "secreto-de-prueba-no-usar-en-produccion",
      // Se pasa igualmente: con DATABASE_URL presente el store lo ignora, y asi
      // se comprueba que de verdad NO esta usando el archivo.
      USER_STORE_PATH: path.join(tmpDir, "users.json"),
      STORE_TABLE_PREFIX: PREFIJO,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      GOOGLE_CLIENT_ID,
      GOOGLE_TEST_PROFILES_JSON: JSON.stringify(GOOGLE_TEST_PROFILES),
      NODE_ENV: "test",
    },
    stdio: process.env.VER_LOGS ? "inherit" : "ignore",
  });
  await esperarSalud(BASE, child);
};

const detener = async () => {
  if (!child) return;
  const fin = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await fin;
  child = null;
};

// Borra el directorio entero: es exactamente lo que hace Render al levantar un
// contenedor nuevo en el plan gratis.
const borrarDisco = () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-pg-"));
};

const login = async (email, password) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
};

const listarUsuarios = async (token) => {
  const res = await fetch(`${BASE}/auth/users`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()).users;
};

const limpiarTablas = async () => {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE $1",
    [`${PREFIJO}%`],
  );
  for (const { tablename } of tables.rows) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(tablename)) throw new Error("Nombre de tabla de prueba invalido");
    await pool.query(`DROP TABLE IF EXISTS ${tablename} CASCADE`);
  }
  await pool.end();
};

describe("almacen en Postgres", { skip: HAY_DB ? false : "sin DATABASE_URL" }, () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-pg-"));
    await limpiarTablas();
    await arrancar();
  });

  after(async () => {
    await detener();
    await limpiarTablas();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("los usuarios sobreviven a un reinicio con el disco borrado", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.equal(admin.status, 200);

    const email = "tesista-persistente@test.local";
    const crear = await fetch(`${BASE}/auth/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.body.token}` },
      body: JSON.stringify({
        email,
        password: "ClaveTesista123!",
        role: "user",
        plan: "tesista",
        uses: { descriptiva: 7, humanizador: 4 },
      }),
    });
    assert.equal(crear.status, 201);

    // Deploy: contenedor nuevo, disco en blanco.
    await detener();
    borrarDisco();
    await arrancar();

    const admin2 = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const usuarios = await listarUsuarios(admin2.body.token);
    const tesista = usuarios.find((u) => u.email === email);

    assert.ok(tesista, "la cuenta sigue existiendo tras borrarse el disco");
    assert.equal(tesista.uses.descriptiva, 7, "conserva sus usos");
    assert.equal(tesista.uses.humanizador, 4);

    // Y su contraseña sigue sirviendo (no solo el registro, tambien el hash).
    const suSesion = await login(email, "ClaveTesista123!");
    assert.equal(suSesion.status, 200, "puede iniciar sesion tras el reinicio");

    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const normalized = await pool.query(
      `SELECT email, role, plan, password_hash, profile, data
         FROM ${PREFIJO}users WHERE id=$1`,
      [tesista.id],
    );
    await pool.end();
    assert.equal(normalized.rows[0].email, email);
    assert.equal(normalized.rows[0].role, "user");
    assert.ok(normalized.rows[0].password_hash);
    assert.equal(normalized.rows[0].data.email, undefined,
      "JSONB no duplica identidad autoritativa");
    assert.equal(normalized.rows[0].data.uses, undefined,
      "JSONB no duplica saldos autoritativos");
    assert.deepEqual(normalized.rows[0].data, normalized.rows[0].profile,
      "data es solo el adaptador temporal del perfil variable");
  });

  test("no se escribe users.json cuando hay Postgres", () => {
    assert.equal(
      fs.existsSync(path.join(tmpDir, "users.json")),
      false,
      "el backend de archivo no se usa si hay DATABASE_URL",
    );
  });

  test("dos altas Google concurrentes crean una sola identidad y sobreviven al reinicio", async () => {
    const request = () => fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "google-concurrent" }),
    });
    const responses = await Promise.all([request(), request()]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.ok(responses.every((response) => [200, 201, 409].includes(response.status)));
    const created = bodies.find((body) => body.creado === true);
    assert.ok(created?.user?.id);
    const recurrentBody = bodies.find((body, index) => responses[index].status === 200);
    if (recurrentBody) assert.equal(recurrentBody.user.id, created.user.id);

    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const identities = await pool.query(
      `SELECT user_id FROM ${PREFIJO}identities WHERE provider='google' AND subject=$1`,
      ["google-concurrent-http-sub"],
    );
    await pool.end();
    assert.equal(identities.rowCount, 1);
    assert.equal(identities.rows[0].user_id, created.user.id);

    await detener();
    borrarDisco();
    await arrancar();

    const recurrent = await request();
    assert.equal(recurrent.status, 200);
    assert.equal((await recurrent.json()).user.id, created.user.id);
  });

  // Las rutas críticas ya esperan a PostgreSQL. Esta prueba conserva la
  // garantía adicional del apagado ordenado para escrituras de compatibilidad
  // o métricas reconstruibles que todavía usen la cola masiva.
  //
  // OJO: en Windows no se puede comprobar. `child.kill()` alli no entrega una
  // señal interceptable — termina el proceso de golpe y `process.on("SIGTERM")`
  // nunca corre. Dejar el test activo daba FALSA CONFIANZA: pasaba o fallaba
  // segun si la escritura alcanzaba a llegar a Neon antes del corte, no segun
  // si el apagado ordenado funcionaba. Render corre Linux, donde si aplica.
  // La logica de vaciado en si se prueba, sin depender del sistema operativo,
  // en test/store-escritura.test.js.
  test("el apagado ordenado guarda lo que quedo en la cola de escritura", {
    skip: process.platform === "win32"
      ? "SIGTERM no es interceptable en Windows; se verifica en Linux (CI/Render)"
      : false,
  }, async () => {
    const email = "tesista-persistente@test.local";

    // El login confirma lastLoginAt antes de responder; el reinicio inmediato
    // verifica además que no dependía del disco o de la caché del proceso.
    const sesion = await login(email, "ClaveTesista123!");
    assert.equal(sesion.status, 200);
    const marcaEsperada = sesion.body.user.lastLoginAt;
    assert.ok(marcaEsperada, "el login registra la marca de acceso");

    // Sin darle tiempo a nada: SIGTERM inmediato, como en un deploy.
    await detener();
    borrarDisco();
    await arrancar();

    const admin2 = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const usuarios = await listarUsuarios(admin2.body.token);
    const tesista = usuarios.find((u) => u.email === email);
    assert.equal(tesista.lastLoginAt, marcaEsperada, "la escritura encolada llego a Postgres");
  });

  test("un proyecto sobrevive al reinicio con el disco borrado", async () => {
    // El instrumento es lo que el usuario mas trabajo le costo escribir: es el
    // dato que menos se puede permitir perder.
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const email = "tesista-persistente@test.local";
    const sesion = await login(email, "ClaveTesista123!");

    const creado = await fetch(`${BASE}/proyectos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.body.token}` },
      body: JSON.stringify({
        nombre: "Tesis persistente",
        instrumento: {
          escala: ["Nunca", "A veces", "Siempre"],
          variables: [{
            nombre: "Clima laboral",
            dimensiones: [{
              nombre: "Comunicación",
              indicadores: [{ nombre: "Claridad", items: ["Ítem uno", "Ítem dos"] }],
            }],
            baremo: [
              { nombre: "Bajo", desde: 2, hasta: 3, porcentaje: 60 },
              { nombre: "Alto", desde: 4, hasta: 6, porcentaje: 40 },
            ],
          }],
        },
      }),
    });
    assert.equal(creado.status, 201);
    const id = (await creado.json()).proyecto.id;

    await detener();
    borrarDisco();
    await arrancar();

    const sesion2 = await login(email, "ClaveTesista123!");
    const leido = await fetch(`${BASE}/proyectos/${id}`, {
      headers: { Authorization: `Bearer ${sesion2.body.token}` },
    });
    assert.equal(leido.status, 200, "el proyecto sigue ahí tras borrarse el disco");
    const p = (await leido.json()).proyecto;
    assert.equal(p.nombre, "Tesis persistente");
    assert.equal(p.instrumento.variables[0].dimensiones[0].indicadores[0].items.length, 2,
      "el instrumento completo sobrevive, no solo el nombre");
    assert.equal(p.instrumento.variables[0].baremo[0].porcentaje, 60);
    assert.ok(admin);
  });

  test("un uso a medias se devuelve tras un reinicio con el disco borrado", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const email = "tesista-persistente@test.local";
    const antes = (await listarUsuarios(admin.body.token)).find((u) => u.email === email);

    // Se simula el job interrumpido escribiendo directamente en la tabla de
    // pendientes, junto con el descuento que ya se le habia aplicado.
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `UPDATE ${PREFIJO}entitlement_balances
          SET available = available - 1, consumed = consumed + 1
        WHERE user_id = $1 AND tool = 'descriptiva'`,
      [antes.id],
    );
    await pool.query(
      `INSERT INTO ${PREFIJO}pending_uses (job_id, user_id, tool) VALUES ($1, $2, $3)`,
      ["job-interrumpido-pg", antes.id, "descriptiva"],
    );
    await pool.end();

    await detener();
    borrarDisco();
    await arrancar();

    const admin2 = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const despues = (await listarUsuarios(admin2.body.token)).find((u) => u.email === email);
    assert.equal(despues.uses.descriptiva, antes.uses.descriptiva, "el uso interrumpido volvio");
  });
});
