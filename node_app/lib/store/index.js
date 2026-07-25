// Persistencia del almacen de usuarios y de los usos pendientes.
//
// Dos backends intercambiables:
//   - Postgres (si hay DATABASE_URL): el de produccion. En el plan gratis de
//     Render el disco es efimero — cada deploy o cada despertar de suspension
//     borraba users.json con todas las cuentas, sus usos y sus claves ttab_.
//   - Archivo JSON (si no hay DATABASE_URL): desarrollo local y tests, que asi
//     siguen corriendo sin necesidad de una base de datos.
//
// ESCRITURA DIFERIDA (write-behind). `writeUsers()` se llama desde codigo
// sincrono (incluido el callback de consumo de usos de Forms, que es sincrono
// por contrato), asi que no puede volverse `await` sin arrastrar a medio
// servidor a ser asincrono. En su lugar: la memoria es la fuente de verdad en
// caliente y la escritura sale en una cola ordenada por detras.
//
// Consecuencia asumida: hay una ventana de milisegundos en la que un cierre
// abrupto pierde la ultima escritura. Para este producto el sesgo favorece al
// usuario (un consumo de uso perdido le deja el uso).
import fs from "fs";
import path from "path";

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
export const usingPostgres = Boolean(DATABASE_URL);

// ── Cola de escritura con fusion ────────────────────────────────────────────
// Se serializa a JSON en el momento de encolar (sincrono, por lo tanto un
// estado coherente) y solo se conserva el ultimo pendiente: si llegan 10
// cambios mientras una escritura esta en vuelo, se persiste una sola vez el
// estado final, no 10 veces.
const crearEscritor = (guardar, etiqueta) => {
  let enVuelo = null;
  let pendiente = null;

  const bucle = async () => {
    while (pendiente !== null) {
      const instantanea = pendiente;
      pendiente = null;
      try {
        await guardar(instantanea);
      } catch (err) {
        // Nunca tumbar el proceso por un fallo de escritura: el estado en
        // memoria sigue siendo valido y el proximo cambio reintenta.
        // eslint-disable-next-line no-console
        console.error(`[store] no se pudo persistir ${etiqueta}:`, err.message);
      }
    }
    enVuelo = null;
  };

  return {
    encolar(valor) {
      pendiente = JSON.stringify(valor);
      if (!enVuelo) enVuelo = bucle();
    },
    async vaciar() {
      while (enVuelo) await enVuelo;
    },
  };
};

// ── Backend: archivo JSON ───────────────────────────────────────────────────
const backendArchivo = (rutaUsuarios) => {
  const rutaPendientes = path.join(path.dirname(rutaUsuarios), "pending-uses.json");

  const escribirAtomico = (ruta, contenido) => {
    const tmp = `${ruta}.tmp`;
    fs.writeFileSync(tmp, contenido, "utf-8");
    fs.renameSync(tmp, ruta);
  };

  const leer = (ruta, porDefecto) => {
    try {
      if (!fs.existsSync(ruta)) return porDefecto;
      const parsed = JSON.parse(fs.readFileSync(ruta, "utf-8"));
      return Array.isArray(parsed) ? parsed : porDefecto;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[store] ${path.basename(ruta)} ilegible (${err.message}); se ignora.`);
      return porDefecto;
    }
  };

  const rutaBorradas = path.join(path.dirname(rutaUsuarios), "deleted-accounts.json");

  return {
    async cargar() {
      fs.mkdirSync(path.dirname(rutaUsuarios), { recursive: true });
      return {
        usuarios: leer(rutaUsuarios, []),
        pendientes: leer(rutaPendientes, []),
        borradas: leer(rutaBorradas, []),
      };
    },
    async guardarUsuarios(json) { escribirAtomico(rutaUsuarios, json); },
    async guardarPendientes(json) { escribirAtomico(rutaPendientes, json); },
    async guardarBorradas(json) { escribirAtomico(rutaBorradas, json); },
    async cerrar() {},
  };
};

// ── Backend: Postgres ───────────────────────────────────────────────────────
const backendPostgres = async () => {
  const { default: pg } = await import("pg");
  // Pensado para el plan gratis de Neon, que da un presupuesto de CU-hora y
  // suspende el compute cuando no hay actividad. Este servidor solo consulta
  // al arrancar y al escribir (no hay sondeos periodicos: el intervalo de
  // limpieza del servidor solo recorre memoria), asi que basta con no dejar
  // conexiones ociosas abiertas mas de lo necesario: 10 s en vez de los 30 s
  // por defecto, y un pool pequeño — una sola instancia de Render con
  // escrituras esporadicas no necesita mas.
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 4,
    idleTimeoutMillis: 10_000,
  });

  // Prefijo de tablas: permite que los tests corran contra la misma base sin
  // tocar los datos reales. Se valida porque acaba interpolado en el SQL (no
  // hay parametros para nombres de tabla).
  const prefijo = String(process.env.STORE_TABLE_PREFIX ?? "").trim();
  if (prefijo && !/^[a-z_][a-z0-9_]*$/i.test(prefijo)) {
    throw new Error("STORE_TABLE_PREFIX solo admite letras, numeros y guion bajo.");
  }
  const TABLA_USUARIOS = `${prefijo}users`;
  const TABLA_PENDIENTES = `${prefijo}pending_uses`;
  const TABLA_BORRADAS = `${prefijo}deleted_accounts`;

  // El usuario se guarda entero como JSONB: los campos cambian a menudo en
  // esta etapa del producto y asi no hace falta migrar el esquema cada vez.
  const DDL = `
    CREATE TABLE IF NOT EXISTS ${TABLA_USUARIOS} (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${TABLA_PENDIENTES} (
      job_id     TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      tool       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Cuentas eliminadas por su propio dueño. Se guarda SOLO un hash del
    -- correo, nunca el correo: lo justo para no regalar otra tanda de usos
    -- gratuitos a quien borra y vuelve a registrarse, sin conservar datos
    -- personales de alguien que pidio que se le borraran.
    CREATE TABLE IF NOT EXISTS ${TABLA_BORRADAS} (
      email_hash TEXT PRIMARY KEY,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;

  // Una sola ida y vuelta pase lo que pase: el arreglo completo viaja como un
  // JSONB y Postgres lo expande en filas. Insertar/actualizar uno por uno
  // costaria N viajes a Neon (que esta en otra region) por cada cambio.
  const SQL_USUARIOS = `
    WITH incoming AS (
      SELECT (elem->>'id') AS id, elem AS data
      FROM jsonb_array_elements($1::jsonb) AS elem
    ), borrados AS (
      DELETE FROM ${TABLA_USUARIOS} AS u
      WHERE NOT EXISTS (SELECT 1 FROM incoming WHERE incoming.id = u.id)
    )
    INSERT INTO ${TABLA_USUARIOS} (id, data, updated_at)
    SELECT id, data, now() FROM incoming
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();
  `;

  const SQL_PENDIENTES = `
    WITH incoming AS (
      SELECT (elem->>'jobId') AS job_id, (elem->>'userId') AS user_id, (elem->>'tool') AS tool
      FROM jsonb_array_elements($1::jsonb) AS elem
    ), borrados AS (
      DELETE FROM ${TABLA_PENDIENTES} AS p
      WHERE NOT EXISTS (SELECT 1 FROM incoming WHERE incoming.job_id = p.job_id)
    )
    INSERT INTO ${TABLA_PENDIENTES} (job_id, user_id, tool)
    SELECT job_id, user_id, tool FROM incoming
    ON CONFLICT (job_id) DO NOTHING;
  `;

  const SQL_BORRADAS = `
    WITH incoming AS (
      SELECT (elem->>'emailHash') AS email_hash, (elem->>'at')::timestamptz AS deleted_at
      FROM jsonb_array_elements($1::jsonb) AS elem
    ), borrados AS (
      DELETE FROM ${TABLA_BORRADAS} AS d
      WHERE NOT EXISTS (SELECT 1 FROM incoming WHERE incoming.email_hash = d.email_hash)
    )
    INSERT INTO ${TABLA_BORRADAS} (email_hash, deleted_at)
    SELECT email_hash, deleted_at FROM incoming
    ON CONFLICT (email_hash) DO UPDATE SET deleted_at = EXCLUDED.deleted_at;
  `;

  return {
    async cargar() {
      await pool.query(DDL);
      const usuarios = await pool.query(`SELECT data FROM ${TABLA_USUARIOS} ORDER BY updated_at`);
      const pendientes = await pool.query(
        `SELECT job_id, user_id, tool, created_at FROM ${TABLA_PENDIENTES}`,
      );
      const borradas = await pool.query(
        `SELECT email_hash, deleted_at FROM ${TABLA_BORRADAS}`,
      );
      return {
        usuarios: usuarios.rows.map((r) => r.data),
        pendientes: pendientes.rows.map((r) => ({
          jobId: r.job_id, userId: r.user_id, tool: r.tool, at: r.created_at,
        })),
        borradas: borradas.rows.map((r) => ({ emailHash: r.email_hash, at: r.deleted_at })),
      };
    },
    async guardarUsuarios(json) { await pool.query(SQL_USUARIOS, [json]); },
    async guardarPendientes(json) { await pool.query(SQL_PENDIENTES, [json]); },
    async guardarBorradas(json) { await pool.query(SQL_BORRADAS, [json]); },
    async cerrar() { await pool.end(); },
  };
};

// ── Fachada ─────────────────────────────────────────────────────────────────
let backend = null;
let escritorUsuarios = null;
let escritorPendientes = null;
let escritorBorradas = null;

export const initStore = async (rutaUsuarios) => {
  backend = usingPostgres ? await backendPostgres() : backendArchivo(rutaUsuarios);
  escritorUsuarios = crearEscritor((json) => backend.guardarUsuarios(json), "los usuarios");
  escritorPendientes = crearEscritor((json) => backend.guardarPendientes(json), "los usos pendientes");
  escritorBorradas = crearEscritor((json) => backend.guardarBorradas(json), "las cuentas eliminadas");
  // Si la carga falla se propaga a proposito: arrancar con la lista vacia y
  // persistirla despues BORRARIA a todos los usuarios. Mejor no arrancar.
  const { usuarios, pendientes, borradas } = await backend.cargar();
  // eslint-disable-next-line no-console
  console.log(
    `[store] ${usingPostgres ? "Postgres" : `archivo (${rutaUsuarios})`}: `
    + `${usuarios.length} usuario(s), ${pendientes.length} uso(s) pendiente(s).`,
  );
  return { usuarios, pendientes, borradas: borradas ?? [] };
};

export const persistUsers = (usuarios) => escritorUsuarios?.encolar(usuarios);
export const persistPending = (pendientes) => escritorPendientes?.encolar(pendientes);
export const persistDeleted = (borradas) => escritorBorradas?.encolar(borradas);

// Espera a que no quede nada por escribir (arranque, tests, apagado ordenado).
export const flushStore = async () => {
  await escritorUsuarios?.vaciar();
  await escritorPendientes?.vaciar();
  await escritorBorradas?.vaciar();
};

export const closeStore = async () => {
  await flushStore();
  await backend?.cerrar();
};
