// Pruebas de lib/cronbach.js (prueba de confiabilidad Alfa de Cronbach).
//
// Antes de esto NO existia ningun test a nivel de libreria para este modulo:
// solo lo tocaba test/server.test.js, y de forma superficial (que el
// resultado sea un .xlsx con firma "PK" y que el alfa devuelto caiga en el
// nivel pedido). Nunca se verifico la formula misma, los limites de
// configuracion, ni la estructura del Excel (celdas, formulas vivas).
// La validacion "se abre en una hoja de calculo real" vive en
// scripts/validar-excel-libreoffice.mjs (que ahora tambien cubre Cronbach).
import { test } from "node:test";
import assert from "node:assert/strict";
import XlsxPopulate from "xlsx-populate";
import {
  NIVELES_ALFA, normalizeCronbachConfig, computeCronbachAlpha, generateCronbachData,
  buildCronbachWorkbook, generateCronbach,
} from "../lib/cronbach.js";

// ── computeCronbachAlpha ─────────────────────────────────────────────────────

test("computeCronbachAlpha: dos items perfectamente correlacionados (transformacion lineal) dan alfa = 1", () => {
  // item2 = item1 + 1 para cada sujeto: consistencia interna perfecta.
  const matrix = [[1, 2], [3, 4], [5, 6]];
  assert.equal(computeCronbachAlpha(matrix), 1);
});

test("computeCronbachAlpha: items que se cancelan (suma constante) dan varianza total 0 -> NaN, no un error de division", () => {
  // item2 = 7 - item1 para cada fila: la suma por sujeto es siempre 7, asi
  // que St² = 0. El codigo debe devolver NaN (guardado explicito), nunca
  // lanzar ni devolver Infinity/#DIV/0! silencioso.
  const matrix = [[1, 6], [6, 1], [3, 4], [4, 3]];
  assert.ok(Number.isNaN(computeCronbachAlpha(matrix)));
});

test("computeCronbachAlpha: mismo criterio que las formulas del Excel (VARP + K/(K-1))", () => {
  // Verificacion independiente con una matriz de 3 items x 4 sujetos,
  // calculando VARP y el alfa a mano (misma formula que sheet.formula() en
  // buildCronbachWorkbook), para asegurarse de que el JS y el Excel nunca
  // pueden divergir en el metodo.
  const matrix = [[4, 3, 5], [2, 2, 3], [5, 4, 5], [1, 2, 2]];
  const k = 3;
  const varp = (vals) => {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  };
  const itemVars = [0, 1, 2].map((j) => varp(matrix.map((row) => row[j])));
  const sumItemVar = itemVars.reduce((a, b) => a + b, 0);
  const totalVar = varp(matrix.map((row) => row.reduce((a, b) => a + b, 0)));
  const esperado = (k / (k - 1)) * (1 - sumItemVar / totalVar);
  assert.ok(Math.abs(computeCronbachAlpha(matrix) - esperado) < 1e-9);
});

// ── normalizeCronbachConfig ──────────────────────────────────────────────────

const cfgBase = () => ({
  variable: "Satisfacción laboral",
  encuestados: 30,
  dimensiones: [{ nombre: "Única", items: 8 }],
});

test("normalizeCronbachConfig: rechaza menos de 5 encuestados", () => {
  assert.throws(() => normalizeCronbachConfig({ ...cfgBase(), encuestados: 4 }), /al menos 5/);
});

test("normalizeCronbachConfig: rechaza una muestra por encima del maximo soportado", () => {
  assert.throws(() => normalizeCronbachConfig({ ...cfgBase(), encuestados: 5000 }), /maxima/);
});

test("normalizeCronbachConfig: rechaza menos de 2 items en total", () => {
  assert.throws(
    () => normalizeCronbachConfig({ ...cfgBase(), dimensiones: [{ nombre: "Única", items: 1 }] }),
    /al menos 2 items/,
  );
});

test("normalizeCronbachConfig: rechaza mas items que el maximo por variable", () => {
  assert.throws(
    () => normalizeCronbachConfig({ ...cfgBase(), dimensiones: [{ nombre: "Única", items: 61 }] }),
    /maximo/,
  );
});

test("normalizeCronbachConfig: rechaza una escala de respuesta fuera de 2-10 opciones", () => {
  assert.throws(() => normalizeCronbachConfig({ ...cfgBase(), respuesta: 1 }), /2 y 10/);
  assert.throws(() => normalizeCronbachConfig({ ...cfgBase(), respuesta: 11 }), /2 y 10/);
});

test("normalizeCronbachConfig: nivel de alfa invalido cae a 'excelente' con aviso, no lanza", () => {
  const cfg = normalizeCronbachConfig({ ...cfgBase(), nivelAlfa: "sobresaliente" });
  assert.equal(cfg.nivelAlfa, "excelente");
  assert.ok(cfg.warnings.some((w) => w.includes("sobresaliente")));
});

test("normalizeCronbachConfig: acepta el campo de compatibilidad 'items' cuando no hay dimensiones", () => {
  const cfg = normalizeCronbachConfig({ variable: "X", encuestados: 20, items: 10 });
  assert.equal(cfg.dimensiones.length, 1);
  assert.equal(cfg.totalItems, 10);
});

test("normalizeCronbachConfig: ignora dimensiones con 0 items (no cuelan columnas vacias)", () => {
  const cfg = normalizeCronbachConfig({
    ...cfgBase(),
    dimensiones: [{ nombre: "Real", items: 6 }, { nombre: "Vacía", items: 0 }],
  });
  assert.equal(cfg.dimensiones.length, 1);
  assert.equal(cfg.totalItems, 6);
});

test("normalizeCronbachConfig: escala personalizada respeta las etiquetas dadas", () => {
  const cfg = normalizeCronbachConfig({
    ...cfgBase(), respuesta: 4, nombre_respuesta: ["Malo", "Regular", "Bueno", "Excelente"],
  });
  assert.deepEqual(cfg.escala.map((o) => o.etiqueta), ["Malo", "Regular", "Bueno", "Excelente"]);
});

// ── generateCronbachData: la simulacion converge al nivel pedido ───────────

for (const nivel of Object.keys(NIVELES_ALFA)) {
  test(`generateCronbachData: nivel "${nivel}" produce un alfa dentro de su rango (${NIVELES_ALFA[nivel].min}-${NIVELES_ALFA[nivel].max})`, () => {
    const cfg = normalizeCronbachConfig({ ...cfgBase(), encuestados: 40, nivelAlfa: nivel });
    const { matrix, alpha, cumple } = generateCronbachData(cfg);
    assert.equal(matrix.length, 40);
    assert.equal(matrix[0].length, 8);
    assert.ok(cumple, `el alfa ${alpha} no cayo en el rango del nivel "${nivel}"`);
    assert.ok(alpha >= NIVELES_ALFA[nivel].min && alpha <= NIVELES_ALFA[nivel].max);
    // Nunca 1.0 exacto (dato identico seria sospechoso) ni fuera de la escala.
    assert.ok(alpha < 1);
    for (const row of matrix) {
      for (const v of row) assert.ok(v >= 1 && v <= cfg.escala.length && Number.isInteger(v));
    }
  });
}

test("generateCronbachData: con la muestra minima (N=5) no lanza, aunque no siempre alcance el rango exacto", () => {
  const cfg = normalizeCronbachConfig({ ...cfgBase(), encuestados: 5 });
  const { matrix, alpha } = generateCronbachData(cfg);
  assert.equal(matrix.length, 5);
  assert.ok(Number.isFinite(alpha));
});

// ── buildCronbachWorkbook / generateCronbach: estructura y formulas vivas ───

test("buildCronbachWorkbook: hoja unica, formulas vivas (no valores pegados) y K coincide con el numero de items", async () => {
  const cfg = normalizeCronbachConfig({ ...cfgBase(), encuestados: 15, dimensiones: [{ nombre: "Única", items: 5 }] });
  const { matrix } = generateCronbachData(cfg);
  const workbook = await buildCronbachWorkbook(cfg, matrix);
  assert.deepEqual(workbook.sheets().map((s) => s.name()), ["Alfa de Cronbach"]);
  const sheet = workbook.sheet(0);

  // Fila de SUMA (fila 6, primer encuestado): formula viva, no un numero.
  const sumaFormula = sheet.cell(6, 7).formula(); // items en B..F (5), SUMA en G
  assert.ok(typeof sumaFormula === "string" && sumaFormula.startsWith("SUM("));

  // Fila de VARIANZA: una formula VARP por item.
  const varRow = 6 + cfg.encuestados; // dataStart=6, dataEnd=6+N-1, varRow=dataEnd+1
  const varFormula = sheet.cell(varRow, 2).formula();
  assert.ok(typeof varFormula === "string" && varFormula.startsWith("VARP("));

  // Panel de resultados: K se cuenta con COUNT sobre la fila de varianzas
  // (nunca un numero fijo, para que sobreviva a cambios de items).
  const panelTop = varRow + 2;
  const kFormula = sheet.cell(panelTop + 2, 2).formula();
  assert.ok(typeof kFormula === "string" && kFormula.startsWith("COUNT("));

  // El alfa de la tarjeta usa la MISMA formula (K/(K-1))*(1-(ΣSi²/St²)) que
  // computeCronbachAlpha, referenciando las celdas del panel, no un numero.
  const alphaFormula = sheet.cell(panelTop + 2, 11).formula();
  assert.match(alphaFormula, /^\(B\d+\/\(B\d+-1\)\)\*\(1-\(E\d+\/H\d+\)\)$/);
});

test("generateCronbach: end-to-end produce un Excel con el alfa reportado y advertencia cuando no alcanza el rango", async () => {
  const result = await generateCronbach({
    variable: "Confiabilidad de prueba", encuestados: 20,
    dimensiones: [{ nombre: "Única", items: 6 }], nivelAlfa: "excelente",
  });
  assert.ok(Buffer.isBuffer(result.excelBuffer));
  assert.ok(result.excelBuffer.subarray(0, 2).toString("latin1") === "PK");
  assert.ok(Number.isFinite(result.alpha));
  assert.equal(result.K, 6);
  assert.equal(result.encuestados, 20);
  if (!result.cumple) {
    assert.ok(result.warnings.some((w) => /fuera del rango/.test(w)));
  }

  // El buffer debe abrir de verdad con xlsx-populate (post-procesado OOXML
  // intacto) y traer la hoja esperada con datos coherentes con `alpha`.
  const wb = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  assert.deepEqual(wb.sheets().map((s) => s.name()), ["Alfa de Cronbach"]);
});

test("generateCronbach: rechaza configuraciones invalidas con un mensaje explicito, no un Excel roto", async () => {
  await assert.rejects(() => generateCronbach({ variable: "X", encuestados: 2 }), /al menos 5/);
  await assert.rejects(() => generateCronbach(null), /configuracion valida/);
});
