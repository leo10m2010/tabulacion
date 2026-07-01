import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import XlsxPopulate from "xlsx-populate";
import JSZip from "jszip";
import {
  DEFAULT_CONFIG_PATH,
  MAX_ITEMS_POR_VARIABLE,
  MAX_MUESTRA,
  generateArtifacts,
  lillieforsTest,
  shapiroWilkTest,
} from "../generator.js";

const baseConfig = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));

test("config clasica genera con correlacion alta, csv y graficos", async () => {
  const result = await generateArtifacts(baseConfig);
  assert.ok(Math.abs(result.correlation) >= 0.8, `r=${result.correlation}`);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.excelBuffer.length > 10000);

  const lines = result.baseCsv.split("\n");
  assert.equal(lines.length, 1 + 289);
  assert.equal(lines[0].split(",").length, 18 + 9);

  // Graficos inyectados: 27 por item, 4 + 2 en dimensiones, 3 + 1 en conteo.
  const zip = await JSZip.loadAsync(result.excelBuffer);
  const charts = Object.keys(zip.files)
    .filter((n) => n.startsWith("xl/charts/") && !zip.files[n].dir);
  assert.equal(charts.length, 37);
  const contentTypes = await zip.file("[Content_Types].xml").async("string");
  assert.equal((contentTypes.match(/chart\+xml/g) ?? []).length, 37);
});

test("hoja base: encabezados, datos, estadisticos y frecuencias", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "50" });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Gestion de abastecimiento");
  assert.ok(sheet, "hoja base V1 existe");

  assert.match(String(sheet.cell("A1").value()), /Variable 1/);
  assert.equal(sheet.cell("B4").value(), "P1");
  assert.equal(sheet.cell("S4").value(), "P18");
  // V2 continua la numeracion global
  const v2 = workbook.sheet("Satisfaccion del servicio");
  assert.equal(v2.cell("B4").value(), "P19");
  assert.equal(v2.cell("J4").value(), "P27");

  // Datos simulados dentro del rango de la escala
  for (let r = 5; r <= 54; r += 1) {
    const v = sheet.cell(r, 2).value();
    assert.ok(v >= 1 && v <= 5, `valor fuera de escala en fila ${r}: ${v}`);
  }

  // Estadisticos protegidos contra errores
  assert.equal(sheet.cell("A55").value(), "TOTAL");
  assert.equal(sheet.cell("B55").formula(), "SUM(B5:B54)");
  assert.match(String(sheet.cell("B56").formula()), /MODE\.SNGL/);
  assert.match(String(sheet.cell("B57").formula()), /IFERROR\(AVERAGE/);
  assert.match(String(sheet.cell("B59").formula()), /STDEV\.S/);

  // Frecuencias por escala y porcentajes con divisor de la muestra real
  assert.match(String(sheet.cell("B63").formula()), /COUNTIF\(B5:B54,1\)/);
  assert.match(String(sheet.cell("B71").formula()), /B63\/50\*100/);

  // Total y Valoracion por encuestado (baremo de la variable: 18-41/42-65/66-90)
  assert.equal(sheet.cell("T2").value(), "Total");
  assert.equal(sheet.cell("U2").value(), "Valoración");
  assert.match(String(sheet.cell("T5").formula()), /SUM\(B5:S5\)/);
  assert.match(String(sheet.cell("U5").formula()), /IF\(T5<=41,"Bajo"/);
});

test("items declarados distintos a la estructura producen aviso", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "10", item: "20" });
  assert.ok(result.warnings.some((w) => w.includes("declara 20 items")));
});

test("hoja de dimensiones: baremo, valoracion, consolidado y narrativa", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "20" });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Dimensiones Gestion de abasteci");
  assert.ok(sheet, "hoja de dimensiones V1 existe");

  assert.match(String(sheet.cell("B2").value()), /DIMENSIÓN 1/);
  assert.equal(sheet.cell("B4").value(), "Variable");
  // 6 items, escala 1-5, 3 niveles => 6-13 / 14-21 / 22-30
  assert.equal(sheet.cell("F4").value(), 6);
  assert.equal(sheet.cell("G4").value(), 13);
  assert.equal(sheet.cell("H6").value(), "Alto");

  // La base de la dimension referencia la hoja base de la variable
  assert.match(String(sheet.cell("C17").formula()), /'Gestion de abastecimiento'!B5/);
  assert.match(String(sheet.cell("I17").formula()), /SUM\(C17:H17\)/);
  assert.match(String(sheet.cell("J17").formula()), /IF\(I17<=13,"Bajo"/);

  // Tabla baremada con Tabla/Figura, fuente y narrativa
  let tablaRow = null;
  for (let r = 17; r <= 200; r += 1) {
    if (String(sheet.cell(r, 2).value() ?? "") === "Tabla 1") { tablaRow = r; break; }
  }
  assert.ok(tablaRow, "existe rotulo Tabla 1");
  assert.equal(sheet.cell(tablaRow + 2, 2).value(), "Calificación");
  assert.equal(sheet.cell(tablaRow + 2, 3).value(), "Desde");
  let narrativa = null;
  for (let r = tablaRow; r <= tablaRow + 40; r += 1) {
    const v = String(sheet.cell(r, 2).value() ?? "");
    if (v.startsWith("En la Tabla 1")) { narrativa = v; break; }
  }
  assert.ok(narrativa && narrativa.includes("Planificacion"), "narrativa de la dimension presente");

  // Bloque consolidado con el baremo de la variable (desde/hasta del config)
  let consolidadoRow = null;
  for (let r = 1; r <= 2000; r += 1) {
    if (String(sheet.cell(r, 2).value() ?? "").startsWith("VARIABLE (CONSOLIDADO)")) {
      consolidadoRow = r;
      break;
    }
  }
  assert.ok(consolidadoRow, "existe bloque consolidado");
  assert.equal(sheet.cell(consolidadoRow + 2, 6).value(), 18); // desde nivel 1
  assert.equal(sheet.cell(consolidadoRow + 2, 7).value(), 41); // hasta nivel 1
  assert.equal(sheet.cell(consolidadoRow + 4, 7).value(), 90); // hasta nivel 3
});

test("hojas de items y conteo: tablas, fuente y narrativas", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "15" });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);

  const items = workbook.sheet("Ítems Gestion de abastecimiento");
  assert.ok(items, "hoja de items V1 existe");
  assert.equal(items.cell("B2").value(), "Ítem 1");
  assert.equal(items.cell("B3").value(), "Tabla 1");
  assert.match(String(items.cell("C6").formula()), /'Gestion de abastecimiento'!B/);
  assert.match(String(items.cell("D6").formula()), /C6\/15/);
  assert.equal(items.cell("B12").value(), "Elaboración: Propia");
  assert.equal(items.cell("B13").value(), "Fuente: Encuesta aplicada");

  const conteo = workbook.sheet("Conteo Gestion de abastecimient");
  assert.ok(conteo, "hoja de conteo V1 existe");
  assert.match(String(conteo.cell("B2").value()), /Dimensión 1/);
  // 15 personas x 6 items = 90 respuestas agregadas por dimension
  assert.match(String(conteo.cell("C6").formula()), /COUNTIF\('Gestion de abastecimiento'!B5:G19,1\)/);
  assert.match(String(conteo.cell("D6").formula()), /C6\/90/);
});

test("pruebas de normalidad: Lilliefors y Shapiro-Wilk", () => {
  // scipy.stats.shapiro(range(1, 11)) -> W ~ 0.970, p ~ 0.893
  const uniforme = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const sw = shapiroWilkTest(uniforme);
  assert.ok(Math.abs(sw.stat - 0.970) < 0.02, `W=${sw.stat}`);
  assert.ok(sw.p > 0.5, `p=${sw.p}`);
  const ks = lillieforsTest(uniforme);
  assert.ok(ks.stat > 0 && ks.stat < 0.25, `D=${ks.stat}`);
  assert.ok(ks.p > 0.05, `p=${ks.p}`);

  // Datos muy asimetricos: ambas pruebas deben rechazar la normalidad.
  const sesgados = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 5, 9, 20, 45, 90];
  assert.ok(shapiroWilkTest(sesgados).p < 0.01);
  assert.ok(lillieforsTest(sesgados).p < 0.01);

  // Sin varianza no hay prueba posible.
  assert.equal(shapiroWilkTest([3, 3, 3, 3, 3]), null);
  assert.equal(lillieforsTest([3, 3, 3, 3, 3]), null);
});

test("hoja Relaciones: normalidad calculada y correlaciones", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "15" });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Relaciones");
  assert.ok(sheet, "hoja Relaciones existe");
  assert.equal(sheet.cell("B4").value(), "Encuestado");
  assert.match(String(sheet.cell("C5").formula()), /'Dimensiones Gestion de abasteci'!I17/);

  // Tabla unica de normalidad: total V1, total V2 y las 3 dimensiones de V1,
  // con estadisticos y significancias ya calculados.
  let normRow = null;
  for (let r = 4; r <= 20; r += 1) {
    if (String(sheet.cell(r, 10).value() ?? "") === "Pruebas de normalidad") { normRow = r; break; }
  }
  assert.ok(normRow, "tabla de normalidad presente");
  const firstData = normRow + 3;
  assert.match(String(sheet.cell(firstData, 10).value()), /^Total /);
  for (let r = firstData; r < firstData + 5; r += 1) {
    assert.equal(typeof sheet.cell(r, 11).value(), "number", `KS estadistico fila ${r}`);
    assert.equal(sheet.cell(r, 12).value(), 15);
    assert.equal(typeof sheet.cell(r, 13).value(), "number", `KS sig fila ${r}`);
    assert.equal(typeof sheet.cell(r, 14).value(), "number", `SW estadistico fila ${r}`);
    assert.equal(typeof sheet.cell(r, 16).value(), "number", `SW sig fila ${r}`);
  }
  assert.match(String(sheet.cell(firstData + 5, 10).value()), /^a\. Corrección/,
    "solo 5 filas: las dimensiones de V2 no llevan normalidad");

  // Correlaciones con el metodo decidido por la normalidad: la general V1-V2
  // mas una por cada dimension de V1 (4 tablas en total).
  const corrRows = [];
  let label = null;
  for (let r = 4; r <= 150; r += 1) {
    const v = String(sheet.cell(r, 10).value() ?? "");
    if (v === "Correlación de Pearson" || v === "Rho de Spearman") {
      corrRows.push(r);
      label = v;
    }
  }
  assert.equal(corrRows.length, 4, "correlacion general + 3 dimensiones de V1");
  corrRows.forEach((r) => {
    assert.match(String(sheet.cell(r, 11).formula()), /CORREL\(/);
    assert.match(String(sheet.cell(r + 1, 11).formula()), /T\.DIST\.2T/);
  });
  if (label === "Rho de Spearman") {
    // Con Spearman las columnas de rangos alimentan el CORREL.
    assert.match(String(sheet.cell(5, 19).formula()), /RANK\.AVG/);
  }
});

test("estructura_v1 agrupa indicadores con celdas combinadas", async () => {
  const result = await generateArtifacts({
    muestra: "10",
    variable: "1",
    nombre_respuesta: ["Nunca", "A veces", "Siempre"],
    nombre_escala: ["Bajo", "Alto"],
    nombre_dimension: ["Var Uno"],
    estructura_v1: [
      { nombre: "Dim A", indicadores: [{ nombre: "Ind 1", items: 2 }, { nombre: "Ind 2", items: 1 }] },
      { nombre: "Dim B", indicadores: [{ nombre: "Ind 3", items: 2 }] },
    ],
  });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Var Uno");
  assert.equal(sheet.cell("B2").value(), "Dim A");
  assert.equal(sheet.cell("E2").value(), "Dim B");
  assert.equal(sheet.cell("B3").value(), "Ind 1");
  assert.equal(sheet.cell("D3").value(), "Ind 2");
  assert.equal(sheet.cell("E3").value(), "Ind 3");
  assert.equal(sheet.cell("F4").value(), "P5");
});

test("rechaza muestra e items por encima del limite", async () => {
  await assert.rejects(
    generateArtifacts({ ...baseConfig, muestra: String(MAX_MUESTRA + 1) }),
    /muestra maxima soportada/,
  );
  await assert.rejects(
    generateArtifacts({ ...baseConfig, items_por_dim_v1: ["30", "30", "30"] }),
    new RegExp(`maximo ${MAX_ITEMS_POR_VARIABLE} items`),
  );
});

test("una sola variable: correlacion null, aviso y sin hoja Correlación", async () => {
  const result = await generateArtifacts({ ...baseConfig, variable: "1", itemv2: "0" });
  assert.equal(result.correlation, null);
  assert.ok(result.warnings.some((w) => w.includes("1 sola variable")));
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  assert.equal(workbook.sheet("Correlación"), undefined);
  assert.equal(workbook.sheet("Relaciones"), undefined);
});

test("dos variables generan hoja Correlación con CORREL", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "15" });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Correlación");
  assert.ok(sheet, "hoja Correlación existe");
  assert.match(String(sheet.cell("B7").formula()), /CORREL\(/);
});

test("conDatos=0 deja la base vacia para ingreso manual", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "25", conDatos: "0" });
  assert.equal(result.correlation, null);
  assert.equal(result.baseCsv.split("\n").length, 1); // solo cabecera
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Gestion de abastecimiento");
  assert.equal(sheet.cell("A5").value(), 1);
  assert.equal(sheet.cell("B5").value(), undefined);
  assert.equal(sheet.cell("B29").value(), undefined);
});

test("nombres de variable que colisionan generan hojas distintas", async () => {
  const result = await generateArtifacts({
    ...baseConfig,
    muestra: "10",
    nombre_dimension: ["Satisfaccion de los usuarios", "Satisfaccion de los usuarios"],
  });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const names = workbook.sheets().map((s) => s.name());
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
});

test("relacion inversa produce correlacion negativa", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "60", relacionversa: "1" });
  assert.ok(result.correlation <= -0.8, `r=${result.correlation}`);
});
