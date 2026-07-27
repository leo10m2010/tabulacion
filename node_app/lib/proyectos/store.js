// Persistencia de los proyectos de tesis.
//
// A DIFERENCIA del almacen de usuarios (lib/store), aqui se escribe FILA A
// FILA en vez de reescribir el arreglo completo en cada cambio. El motivo es
// de escala: los usuarios son cientos y su ficha es pequeña, pero los
// proyectos pueden ser miles y cada uno lleva dentro su instrumento
// (variables, dimensiones, indicadores e items), que no es pequeño. Reescribir
// todo en cada guardado mandaria megas a Neon por cambiar un nombre.
//
// Eso obliga a que estas funciones sean asincronas — lo cual esta bien, porque
// a diferencia del consumo de usos de Forms, nada las llama desde codigo
// sincrono.
//
// Mismo criterio que el resto: Postgres si hay DATABASE_URL, archivo JSON si
// no (desarrollo local y pruebas, que asi no necesitan base de datos).
import fs from "fs";
import path from "path";

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();

let backend = null;

// ── Backend: archivo JSON ───────────────────────────────────────────────────
const backendArchivo = (rutaBase) => {
  const ruta = path.join(path.dirname(rutaBase), "proyectos.json");

  const leer = () => {
    try {
      if (!fs.existsSync(ruta)) return [];
      const parsed = JSON.parse(fs.readFileSync(ruta, "utf-8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[proyectos] proyectos.json ilegible (${err.message}); se ignora.`);
      return [];
    }
  };

  const escribir = (lista) => {
    const tmp = `${ruta}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), "utf-8");
    fs.renameSync(tmp, ruta);
  };

  // Los proyectos guardados antes de que existiera el progreso no lo traen.
  // Se rellena al leer para que nadie aguas abajo tenga que comprobarlo.
  const conProgreso = (p) => (p ? { ...p, progreso: p.progreso ?? {}, titulo: p.titulo ?? "" } : p);

  return {
    async init() { fs.mkdirSync(path.dirname(ruta), { recursive: true }); },
    async listarDeUsuario(userId) {
      return leer()
        .filter((p) => p.userId === userId)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map(conProgreso);
    },
    async obtener(id) {
      return conProgreso(leer().find((p) => p.id === id)) ?? null;
    },
    async contarDeUsuario(userId) {
      return leer().filter((p) => p.userId === userId).length;
    },
    async guardar(proyecto) {
      const lista = leer();
      const i = lista.findIndex((p) => p.id === proyecto.id);
      if (i >= 0) lista[i] = proyecto;
      else lista.push(proyecto);
      escribir(lista);
      return proyecto;
    },
    // Crea SOLO si el usuario no llego al limite de su plan, contando y
    // escribiendo en el mismo tramo sincrono (sin ningun `await` en medio):
    // en Node eso basta para que dos peticiones concurrentes no puedan colarse
    // las dos. Antes el conteo y el guardado eran dos llamadas separadas con
    // un `await parseJsonBody` de por medio en server.js, y dos peticiones
    // simultaneas del mismo usuario podian pasar las dos el conteo antes de
    // que ninguna guardara (ver test/proyectos-store-race.test.js).
    async crearSiCabe(proyecto, limite) {
      const lista = leer();
      const actuales = lista.filter((p) => p.userId === proyecto.userId).length;
      if (actuales >= limite) return { ok: false, actuales };
      lista.push(proyecto);
      escribir(lista);
      return { ok: true, actuales: actuales + 1 };
    },
    async borrar(id) {
      const lista = leer();
      const restantes = lista.filter((p) => p.id !== id);
      if (restantes.length === lista.length) return false;
      escribir(restantes);
      return true;
    },
    // Al eliminar una cuenta hay que llevarse sus proyectos.
    async borrarDeUsuario(userId) {
      const lista = leer();
      const restantes = lista.filter((p) => p.userId !== userId);
      const borrados = lista.length - restantes.length;
      if (borrados > 0) escribir(restantes);
      return borrados;
    },
    async cerrar() {},
  };
};

// ── Backend: Postgres ───────────────────────────────────────────────────────
const backendPostgres = async () => {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4, idleTimeoutMillis: 10_000 });

  const prefijo = String(process.env.STORE_TABLE_PREFIX ?? "").trim();
  if (prefijo && !/^[a-z_][a-z0-9_]*$/i.test(prefijo)) {
    throw new Error("STORE_TABLE_PREFIX solo admite letras, numeros y guion bajo.");
  }
  const TABLA = `${prefijo}proyectos`;

  const fila = (r) => ({
    id: r.id,
    userId: r.user_id,
    nombre: r.nombre,
    titulo: r.titulo ?? "",
    instrumento: r.instrumento,
    progreso: r.progreso ?? {},
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  });

  return {
    async init() {
      // El instrumento va como JSONB: su forma va a cambiar mientras el
      // producto madura, y asi no hace falta migrar el esquema cada vez.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLA} (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          nombre      TEXT NOT NULL,
          instrumento JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ${TABLA}_user_idx ON ${TABLA} (user_id, updated_at DESC);
      `);
      // Añadida despues de la primera version: las tablas ya creadas en Neon
      // no la tienen, y IF NOT EXISTS deja el CREATE de arriba sin efecto.
      await pool.query(
        `ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS progreso JSONB NOT NULL DEFAULT '{}'::jsonb`,
      );
      await pool.query(
        `ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS titulo TEXT NOT NULL DEFAULT ''`,
      );
    },
    async listarDeUsuario(userId) {
      const r = await pool.query(
        `SELECT * FROM ${TABLA} WHERE user_id = $1 ORDER BY updated_at DESC`, [userId],
      );
      return r.rows.map(fila);
    },
    async obtener(id) {
      const r = await pool.query(`SELECT * FROM ${TABLA} WHERE id = $1`, [id]);
      return r.rows[0] ? fila(r.rows[0]) : null;
    },
    async contarDeUsuario(userId) {
      const r = await pool.query(`SELECT count(*)::int n FROM ${TABLA} WHERE user_id = $1`, [userId]);
      return r.rows[0].n;
    },
    async guardar(proyecto) {
      await pool.query(
        `INSERT INTO ${TABLA} (id, user_id, nombre, titulo, instrumento, progreso, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
         ON CONFLICT (id) DO UPDATE
           SET nombre = EXCLUDED.nombre,
               titulo = EXCLUDED.titulo,
               instrumento = EXCLUDED.instrumento,
               progreso = EXCLUDED.progreso,
               updated_at = EXCLUDED.updated_at`,
        [proyecto.id, proyecto.userId, proyecto.nombre, proyecto.titulo ?? "",
          JSON.stringify(proyecto.instrumento), JSON.stringify(proyecto.progreso ?? {}),
          proyecto.createdAt, proyecto.updatedAt],
      );
      return proyecto;
    },
    // Version transaccional de "contar y guardar": sin esto, dos peticiones
    // concurrentes del mismo usuario pueden ejecutar su SELECT count(*) antes
    // de que ninguna haga el INSERT, y las dos lo ven por debajo del limite
    // (ver test/proyectos-store-race.test.js para la reproduccion contra el
    // backend de archivo, donde el mismo patron se ataca de otra forma).
    // pg_advisory_xact_lock serializa por usuario: dos transacciones para el
    // MISMO userId se ponen en fila; para userId distintos no se bloquean
    // entre si (hashtext(user_id) practicamente nunca colisiona, y aunque
    // colisionara el peor caso es esperar un poco, no perder el limite). El
    // lock se libera solo al hacer COMMIT o ROLLBACK.
    async crearSiCabe(proyecto, limite) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [proyecto.userId]);
        const cnt = await client.query(
          `SELECT count(*)::int n FROM ${TABLA} WHERE user_id = $1`, [proyecto.userId],
        );
        const actuales = cnt.rows[0].n;
        if (actuales >= limite) {
          await client.query("ROLLBACK");
          return { ok: false, actuales };
        }
        await client.query(
          `INSERT INTO ${TABLA} (id, user_id, nombre, titulo, instrumento, progreso, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
          [proyecto.id, proyecto.userId, proyecto.nombre, proyecto.titulo ?? "",
            JSON.stringify(proyecto.instrumento), JSON.stringify(proyecto.progreso ?? {}),
            proyecto.createdAt, proyecto.updatedAt],
        );
        await client.query("COMMIT");
        return { ok: true, actuales: actuales + 1 };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async borrar(id) {
      const r = await pool.query(`DELETE FROM ${TABLA} WHERE id = $1`, [id]);
      return r.rowCount > 0;
    },
    async borrarDeUsuario(userId) {
      const r = await pool.query(`DELETE FROM ${TABLA} WHERE user_id = $1`, [userId]);
      return r.rowCount;
    },
    async cerrar() { await pool.end(); },
  };
};

export const initProyectos = async (rutaBase) => {
  backend = DATABASE_URL ? await backendPostgres() : backendArchivo(rutaBase);
  await backend.init();
  return backend;
};

export const listarProyectos = (userId) => backend.listarDeUsuario(userId);
export const obtenerProyecto = (id) => backend.obtener(id);
export const contarProyectos = (userId) => backend.contarDeUsuario(userId);
export const guardarProyecto = (p) => backend.guardar(p);
// Crea un proyecto solo si el usuario no llego al limite de su plan; el
// conteo y el guardado son atomicos entre si (ver comentarios de cada
// backend). Devuelve { ok: false } sin escribir nada si ya esta en el limite.
export const crearProyectoSiCabe = (proyecto, limite) => backend.crearSiCabe(proyecto, limite);
export const borrarProyecto = (id) => backend.borrar(id);
export const borrarProyectosDeUsuario = (userId) => backend.borrarDeUsuario(userId);
export const cerrarProyectos = () => backend?.cerrar();
