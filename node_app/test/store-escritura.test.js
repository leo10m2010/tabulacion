// Cola de escritura diferida del almacen (lib/store).
//
// Estas garantias son las que sostienen todo el esquema write-behind, y se
// prueban aqui de forma determinista y sin depender del sistema operativo
// (a diferencia del apagado por SIGTERM, que en Windows no es interceptable).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { closeStore, flushStore, initStore, persistUsers, usingPostgres } from "../lib/store/index.js";

const leerArchivo = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf-8"));

describe("cola de escritura del almacen", {
  // El modulo elige backend al importarse; estas pruebas son del de archivo.
  skip: usingPostgres ? "corriendo con DATABASE_URL (backend Postgres)" : false,
}, () => {
  test("flushStore espera a que la escritura encolada llegue al disco", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-flush-"));
    await initStore(path.join(dir, "users.json"));

    persistUsers([{ id: "u1", email: "uno@test.local" }]);
    // Sin esperar, el archivo aun no refleja el cambio necesariamente; lo que
    // se garantiza es que despues de flushStore SI.
    await flushStore();

    assert.deepEqual(leerArchivo(dir), [{ id: "u1", email: "uno@test.local" }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("varias escrituras seguidas dejan el ULTIMO estado, no uno intermedio", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-fusion-"));
    await initStore(path.join(dir, "users.json"));

    // Diez cambios sin ceder el control: la cola los fusiona y persiste el
    // estado final. Lo que nunca puede pasar es quedarse con uno del medio.
    for (let i = 1; i <= 10; i += 1) {
      persistUsers([{ id: "u1", contador: i }]);
    }
    await flushStore();

    assert.deepEqual(leerArchivo(dir), [{ id: "u1", contador: 10 }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("una escritura encolada durante otra en vuelo tampoco se pierde", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-encadenado-"));
    await initStore(path.join(dir, "users.json"));

    persistUsers([{ id: "u1", paso: "primero" }]);
    // Sin await: se encola mientras la anterior puede seguir en vuelo.
    persistUsers([{ id: "u1", paso: "segundo" }]);
    await flushStore();

    assert.deepEqual(leerArchivo(dir), [{ id: "u1", paso: "segundo" }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("el estado se captura al encolar, no al escribir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-instantanea-"));
    await initStore(path.join(dir, "users.json"));

    const usuarios = [{ id: "u1", saldo: 5 }];
    persistUsers(usuarios);
    // Mutar el arreglo DESPUES de encolar no debe corromper lo ya encolado:
    // se serializa en el momento de encolar, de forma sincrona, para que nunca
    // se persista un estado a medio modificar.
    usuarios[0].saldo = 999;
    await flushStore();

    assert.deepEqual(leerArchivo(dir), [{ id: "u1", saldo: 5 }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("closeStore vacia la cola antes de cerrar", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-cierre-"));
    await initStore(path.join(dir, "users.json"));

    persistUsers([{ id: "u1", estado: "sin guardar" }]);
    await closeStore();

    assert.deepEqual(leerArchivo(dir), [{ id: "u1", estado: "sin guardar" }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
