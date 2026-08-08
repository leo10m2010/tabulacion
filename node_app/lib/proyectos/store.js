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
import { runStoreMigrations, storeTables, verifyStoreMigrations } from "../store/migrations.js";
import { errorLogFields, structuredLog } from "../observability.js";
import { acquireStorePool, releaseStorePool } from "../store/db.js";

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();

let backend = null;

export class ProjectVersionConflictError extends Error {
  constructor(current = null) {
    super("El proyecto cambio en otra sesion. Recarga los datos antes de guardar.");
    this.name = "ProjectVersionConflictError";
    this.current = current;
  }
}

// ── Backend: archivo JSON ───────────────────────────────────────────────────
const backendArchivo = (rutaBase) => {
  const ruta = path.join(path.dirname(rutaBase), "proyectos.json");

  const leer = () => {
    try {
      if (!fs.existsSync(ruta)) return [];
      const parsed = JSON.parse(fs.readFileSync(ruta, "utf-8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      structuredLog("error", "projects.local_store_unreadable", errorLogFields(err));
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
  const conProgreso = (p) => (p ? {
    ...p,
    progreso: p.progreso ?? {},
    titulo: p.titulo ?? "",
    version: Number.isInteger(p.version) && p.version > 0 ? p.version : 1,
  } : p);

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
    async guardar(proyecto, expectedVersion = null) {
      const lista = leer();
      const i = lista.findIndex((p) => p.id === proyecto.id);
      if (i >= 0) {
        const actual = conProgreso(lista[i]);
        if (expectedVersion !== null && actual.version !== expectedVersion) {
          throw new ProjectVersionConflictError(actual);
        }
        lista[i] = { ...proyecto, version: actual.version + 1 };
      }
      else lista.push(proyecto);
      escribir(lista);
      return conProgreso(i >= 0 ? lista[i] : proyecto);
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
  const pool = await acquireStorePool();

  const TABLA = storeTables.projects;

  const fila = (r) => ({
    id: r.id,
    userId: r.user_id,
    nombre: r.nombre,
    titulo: r.titulo ?? "",
    instrumento: r.instrumento,
    progreso: r.progreso ?? {},
    version: Number(r.version ?? 1),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  });

  return {
    async init() {
      if (process.env.NODE_ENV === "production"
        && !new Set(["1", "true", "yes", "on"]).has(
          String(process.env.STORE_AUTO_MIGRATE ?? "false").trim().toLowerCase(),
        )) {
        await verifyStoreMigrations(pool);
      } else {
        await runStoreMigrations(pool);
      }
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
    async guardar(proyecto, expectedVersion = null) {
      const expected = expectedVersion ?? proyecto.version;
      const result = await pool.query(
        `UPDATE ${TABLA}
            SET nombre=$3, titulo=$4, instrumento=$5::jsonb, progreso=$6::jsonb,
                version=version+1, updated_at=$7
          WHERE id=$1 AND user_id=$2 AND version=$8
          RETURNING *`,
        [proyecto.id, proyecto.userId, proyecto.nombre, proyecto.titulo ?? "",
          JSON.stringify(proyecto.instrumento), JSON.stringify(proyecto.progreso ?? {}),
          proyecto.updatedAt, expected],
      );
      if (!result.rows[0]) {
        throw new ProjectVersionConflictError(await this.obtener(proyecto.id));
      }
      return fila(result.rows[0]);
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
          `INSERT INTO ${TABLA}
             (id, user_id, nombre, titulo, instrumento, progreso, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
          [proyecto.id, proyecto.userId, proyecto.nombre, proyecto.titulo ?? "",
            JSON.stringify(proyecto.instrumento), JSON.stringify(proyecto.progreso ?? {}),
            proyecto.version ?? 1, proyecto.createdAt, proyecto.updatedAt],
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
    async cerrar() { await releaseStorePool(); },
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
export const guardarProyecto = (p, expectedVersion = null) => backend.guardar(p, expectedVersion);
// Crea un proyecto solo si el usuario no llego al limite de su plan; el
// conteo y el guardado son atomicos entre si (ver comentarios de cada
// backend). Devuelve { ok: false } sin escribir nada si ya esta en el limite.
export const crearProyectoSiCabe = (proyecto, limite) => backend.crearSiCabe(proyecto, limite);
export const borrarProyecto = (id) => backend.borrar(id);
export const borrarProyectosDeUsuario = (userId) => backend.borrarDeUsuario(userId);
export const cerrarProyectos = () => backend?.cerrar();
