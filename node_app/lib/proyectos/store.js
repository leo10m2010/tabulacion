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
  const conProgreso = (p) => (p && !p.progreso ? { ...p, progreso: {} } : p);

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
        `INSERT INTO ${TABLA} (id, user_id, nombre, instrumento, progreso, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
         ON CONFLICT (id) DO UPDATE
           SET nombre = EXCLUDED.nombre,
               instrumento = EXCLUDED.instrumento,
               progreso = EXCLUDED.progreso,
               updated_at = EXCLUDED.updated_at`,
        [proyecto.id, proyecto.userId, proyecto.nombre,
          JSON.stringify(proyecto.instrumento), JSON.stringify(proyecto.progreso ?? {}),
          proyecto.createdAt, proyecto.updatedAt],
      );
      return proyecto;
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
export const borrarProyecto = (id) => backend.borrar(id);
export const borrarProyectosDeUsuario = (userId) => backend.borrarDeUsuario(userId);
export const cerrarProyectos = () => backend?.cerrar();
