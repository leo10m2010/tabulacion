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
  await pool.query(`DROP TABLE IF EXISTS ${PREFIJO}users, ${PREFIJO}pending_uses`);
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
  });

  test("no se escribe users.json cuando hay Postgres", () => {
    assert.equal(
      fs.existsSync(path.join(tmpDir, "users.json")),
      false,
      "el backend de archivo no se usa si hay DATABASE_URL",
    );
  });

  // No todas las escrituras esperan a Postgres: las que salen de codigo
  // sincrono (metricas, consumo de usos desde Forms, la marca de ultimo
  // acceso) se encolan y siguen. Lo que las salva en un deploy es el apagado
  // ordenado, que vacia la cola al recibir SIGTERM.
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

    // El login marca lastLoginAt con una escritura NO esperada: la respuesta
    // sale antes de que Postgres la confirme.
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

  test("un uso a medias se devuelve tras un reinicio con el disco borrado", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const email = "tesista-persistente@test.local";
    const antes = (await listarUsuarios(admin.body.token)).find((u) => u.email === email);

    // Se simula el job interrumpido escribiendo directamente en la tabla de
    // pendientes, junto con el descuento que ya se le habia aplicado.
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `UPDATE ${PREFIJO}users
       SET data = jsonb_set(data, '{uses,descriptiva}', to_jsonb($2::int))
       WHERE id = $1`,
      [antes.id, antes.uses.descriptiva - 1],
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
