// Condicion de carrera en el limite de proyectos por plan.
//
// El endpoint POST /proyectos comprobaba el limite asi: contar los proyectos
// del usuario, y SOLO DESPUES (tras el `await parseJsonBody(req)`) guardar el
// nuevo. Esas son dos operaciones separadas con un punto de cesion del hilo en
// medio: dos peticiones concurrentes del mismo usuario pueden pasar las dos el
// conteo antes de que ninguna haya guardado, y las dos terminan guardando.
// Con un plan que permite 1 proyecto, dos clics rapidos (o un cliente que
// reintenta) podian dejarle 2, 3 o mas.
//
// Esta prueba reproduce el patron viejo directamente contra el store (sin
// pasar por HTTP, para que la interconexion sea determinista y no dependa de
// temporizacion real), y comprueba que el reemplazo (`crearProyectoSiCabe`,
// que cuenta y guarda en el MISMO tramo sincrono/transaccional) lo cierra.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { crearProyecto } from "../lib/proyectos/index.js";
import {
  contarProyectos,
  crearProyectoSiCabe,
  guardarProyecto,
  initProyectos,
} from "../lib/proyectos/store.js";

let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-proy-race-"));
  await initProyectos(path.join(tmpDir, "users.json"));
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// El patron ANTIGUO que usaba el endpoint: contar, ceder el hilo (como el
// `await parseJsonBody` real de server.js), y solo entonces guardar.
const crearPatronViejo = async (userId, limite) => {
  const actuales = await contarProyectos(userId);
  await Promise.resolve();
  if (actuales >= limite) return { ok: false };
  const proyecto = crearProyecto({ userId, nombre: "Racy" });
  await guardarProyecto(proyecto);
  return { ok: true };
};

test("el patron antiguo (contar, luego guardar) deja pasar mas proyectos que el limite", async () => {
  const userId = "usuario-patron-viejo";
  const intentos = await Promise.all(Array.from({ length: 5 }, () => crearPatronViejo(userId, 1)));
  const exitosos = intentos.filter((r) => r.ok).length;
  const total = await contarProyectos(userId);

  // Este es el bug real: con limite=1, 5 peticiones "simultaneas" no deberian
  // dejar mas de 1 proyecto guardado. El patron viejo lo permite.
  assert.ok(
    exitosos > 1,
    `se esperaba que el patron antiguo fallara (colara mas de 1 con limite 1); coló ${exitosos}`,
  );
  assert.equal(total, exitosos, "cada 'exito' del patron viejo de verdad quedo guardado");
});

test("crearProyectoSiCabe cierra la carrera: nunca deja mas proyectos que el limite", async () => {
  const userId = "usuario-patron-nuevo";
  const limite = 1;
  const intentos = await Promise.all(
    Array.from({ length: 5 }, () => crearProyectoSiCabe(crearProyecto({ userId, nombre: "Atomico" }), limite)),
  );
  const exitosos = intentos.filter((r) => r.ok).length;
  const total = await contarProyectos(userId);

  assert.equal(exitosos, limite, "solo una de las 5 peticiones concurrentes debe tener exito");
  assert.equal(total, limite, "el store no debe terminar con mas proyectos que el limite del plan");
});

test("crearProyectoSiCabe con concurrencia alta y limite mayor a 1 respeta el tope exacto", async () => {
  const userId = "usuario-patron-nuevo-limite3";
  const limite = 3;
  const intentos = await Promise.all(
    Array.from({ length: 10 }, () => crearProyectoSiCabe(crearProyecto({ userId, nombre: "Atomico" }), limite)),
  );
  const exitosos = intentos.filter((r) => r.ok).length;
  const total = await contarProyectos(userId);

  assert.equal(exitosos, limite, `se esperaban exactamente ${limite} exitos de 10 intentos concurrentes`);
  assert.equal(total, limite);
});
