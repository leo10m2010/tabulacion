// Baremo manual: validacion estricta SIN perder la funcion.
//
// El usuario puede seguir escribiendo el "desde" y el "hasta" de cada nivel; lo
// que cambia es que un baremo mal formado ya no se ignora en silencio. Antes,
// cualquier problema hacia que `parseBaremoOverride` devolviera undefined y el
// sistema cayera al baremo AUTOMATICO sin decir nada: el usuario recibia un
// Excel con unos rangos que no habia pedido y no tenia forma de enterarse.
//
// Criterio de las pruebas:
//   - Sin baremo manual  -> automatico (comportamiento de siempre, intacto).
//   - Manual bien puesto -> se respeta tal cual (funcion conservada).
//   - Manual roto        -> error que senala el nivel y el rango exactos.
//   - Manual que no cubre todo el rango -> AVISO, no error: sigue generando,
//     porque hay configuraciones guardadas asi y funcionan.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { DEFAULT_CONFIG_PATH, generateArtifacts, normalizeConfig } from "../generator.js";
import { validarBaremoManual } from "../lib/config.js";

const base = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
const NIVELES = ["Bajo", "Medio", "Alto"];

// ── La funcion sigue disponible ──────────────────────────────────────────────

test("un baremo manual correcto se respeta tal cual", () => {
  const r = validarBaremoManual(["18", "43", "67"], ["42", "66", "90"], NIVELES, "Variable 1");
  assert.deepEqual(r, [
    { nombre: "Bajo", min: 18, max: 42 },
    { nombre: "Medio", min: 43, max: 66 },
    { nombre: "Alto", min: 67, max: 90 },
  ]);
});

test("sin baremo manual se usa el automatico (no es un error)", () => {
  assert.equal(validarBaremoManual([], [], NIVELES, "Variable 1"), undefined);
  assert.equal(validarBaremoManual(undefined, undefined, NIVELES, "Variable 1"), undefined);
  assert.equal(validarBaremoManual(["", "  ", ""], ["", "", ""], NIVELES, "Variable 1"), undefined);
});

test("el baremo manual del ejemplo del producto sigue generando", async () => {
  const r = await generateArtifacts(base);
  assert.ok(r.excelBuffer.length > 10000);
});

test("acepta escalas personalizadas y cualquier numero de niveles", () => {
  const siete = ["N1", "N2", "N3", "N4", "N5", "N6", "N7"];
  const r = validarBaremoManual(
    ["10", "20", "30", "40", "50", "60", "70"],
    ["19", "29", "39", "49", "59", "69", "80"],
    siete, "Variable 1",
  );
  assert.equal(r.length, 7);
  assert.equal(r[6].max, 80);
});

// ── Lo que ahora se rechaza, con el rango exacto ─────────────────────────────

test("rango invertido: senala el nivel y sus dos valores", () => {
  assert.throws(
    () => validarBaremoManual(["18", "67", "43"], ["42", "66", "90"], NIVELES, "Variable 1"),
    (e) => /Medio/.test(e.message) && /67/.test(e.message) && /66/.test(e.message) && /al reves/i.test(e.message),
  );
});

test("niveles solapados: dice donde deberia empezar el siguiente", () => {
  assert.throws(
    () => validarBaremoManual(["18", "40", "67"], ["42", "66", "90"], NIVELES, "Variable 1"),
    (e) => /solapan/i.test(e.message) && /debe empezar en 43/.test(e.message),
  );
});

test("hueco entre niveles: dice que hay puntajes sin nivel", () => {
  assert.throws(
    () => validarBaremoManual(["18", "50", "67"], ["42", "66", "90"], NIVELES, "Variable 1"),
    (e) => /sin nivel/i.test(e.message) && /debe empezar en 43/.test(e.message),
  );
});

test("valor no numerico: dice cual es", () => {
  assert.throws(
    () => validarBaremoManual(["18", "cuarenta y tres", "67"], ["42", "66", "90"], NIVELES, "Variable 1"),
    /no numerico/i,
  );
});

test("faltan filas: dice cuantas hay y cuantas se esperaban", () => {
  assert.throws(
    () => validarBaremoManual(["18", "43"], ["42", "66"], NIVELES, "Variable 1"),
    (e) => /3 nivel/.test(e.message) && /2 valor/.test(e.message),
  );
});

test("solo una de las dos columnas: dice cual falta", () => {
  assert.throws(
    () => validarBaremoManual(["18", "43", "67"], [], NIVELES, "Variable 1"),
    /falta la columna "Hasta"/,
  );
  assert.throws(
    () => validarBaremoManual([], ["42", "66", "90"], NIVELES, "Variable 1"),
    /falta la columna "Desde"/,
  );
});

test("etiqueta de nivel vacia: se rechaza", () => {
  assert.throws(
    () => validarBaremoManual(["18", "43", "67"], ["42", "66", "90"], ["Bajo", "  ", "Alto"], "Variable 1"),
    /no tiene nombre/i,
  );
});

test("los decimales se truncan a entero, no se rechazan", () => {
  // El puntaje de un baremo es una suma de respuestas: siempre entero. Aceptar
  // "42.7" y quedarse con 42 es mas util que rechazar la configuracion.
  const r = validarBaremoManual(["18", "43", "67"], ["42.7", "66", "90"], NIVELES, "Variable 1");
  assert.equal(r[0].max, 42);
});

// ── Cobertura: avisa, no rompe ───────────────────────────────────────────────

test("un baremo que no cubre todo el rango genera igual, pero avisa", () => {
  // 9 items con escala 1-5 dan puntajes de 9 a 45; este baremo cubre 18-90
  // (quedo de una configuracion con 18 items). Sigue siendo utilizable.
  const cfg = normalizeConfig({
    ...base,
    variable: "1",
    item: "9",
    items_por_dim_v1: ["9"],
    nombre_dims_v1: ["Unica"],
    nombre_indicador: ["Ind"],
    numero_indicador0: ["1"],
    estructura_v1: undefined,
  });
  const aviso = cfg.warnings.find((w) => /baremo manual/i.test(w));
  assert.ok(aviso, `deberia avisar de la cobertura. Avisos: ${JSON.stringify(cfg.warnings)}`);
  assert.match(aviso, /van de 9 a 45/);
  assert.match(aviso, /cubre de 18 a 90/);
});

test("cuando el baremo cubre exactamente el rango no hay aviso", async () => {
  const r = await generateArtifacts(base);
  assert.equal(r.warnings.filter((w) => /baremo manual/i.test(w)).length, 0);
});
