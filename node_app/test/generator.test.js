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
  generateBaseData,
  lillieforsTest,
  normalizeConfig,
  shapiroWilkTest,
} from "../generator.js";
import { sumPerRow } from "../lib/stats.js";

const baseConfig = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));

test("una semilla reproduce exactamente la misma base", () => {
  const cfg = normalizeConfig({ ...baseConfig, muestra: "40", seed: "caso-reproducible" });
  const first = generateBaseData(cfg);
  const second = generateBaseData(cfg);
  assert.deepEqual(second, first);

  const different = generateBaseData(
    normalizeConfig({ ...baseConfig, muestra: "40", seed: "otra-semilla" }),
  );
  assert.notDeepEqual(different.base, first.base);
});

test("items inversos se guardan como respuestas crudas y se puntuan al reves", async () => {
  const raw = {
    ...baseConfig,
    muestra: "40",
    seed: "items-inversos",
    items_inversos_v1: [2],
  };
  const cfg = normalizeConfig(raw);
  assert.deepEqual(cfg.variables[0].itemsInversos, [2]);

  const { base } = generateBaseData(cfg);
  const totals = sumPerRow(base, 1, cfg.variables[0].totalItems, cfg.encuestados, cfg);
  for (let row = 0; row < cfg.encuestados; row += 1) {
    let manual = 0;
    for (let item = 1; item <= cfg.variables[0].totalItems; item += 1) {
      const value = base[`V1_${item}`][row];
      manual += item === 2 ? 6 - value : value;
    }
    assert.equal(totals[row], manual);
  }

  const result = await generateArtifacts(raw);
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const baseSheet = workbook.sheet("Gestion de abastecimiento");
  const dimsSheet = workbook.sheet("Dimensiones Gestion de abasteci");
  assert.equal(baseSheet.cell("C4").value(), "P2 (R)");
  assert.match(String(baseSheet.cell("T5").formula()), /\(6-C5\)/);
  assert.match(String(dimsSheet.cell("C5").formula()), /\(6-'Gestion de abastecimiento'!C5\)/);
});

test("items inversos rechaza posiciones fuera del instrumento o duplicadas", () => {
  assert.throws(
    () => normalizeConfig({ ...baseConfig, items_inversos_v1: [0] }),
    /posiciones enteras entre 1 y 18/,
  );
  assert.throws(
    () => normalizeConfig({ ...baseConfig, items_inversos_v1: [2, 2] }),
    /no pueden repetirse/,
  );
});

test("config clasica genera con correlacion alta, csv y graficos", async () => {
  const result = await generateArtifacts(baseConfig);
  assert.ok(Math.abs(result.correlation) >= 0.8, `r=${result.correlation}`);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.excelBuffer.length > 10000);

  const lines = result.baseCsv.split("\n");
  assert.equal(lines.length, 1 + 289);
  assert.equal(lines[0].split(",").length, 18 + 9);

  // Graficos inyectados: 27 por item y 4 + 2 en dimensiones (sin hojas de
  // conteo: la escala Likert es de los items; las dimensiones van por nivel).
  const zip = await JSZip.loadAsync(result.excelBuffer);
  const charts = Object.keys(zip.files)
    .filter((n) => n.startsWith("xl/charts/") && !zip.files[n].dir);
  assert.equal(charts.length, 33);
  const contentTypes = await zip.file("[Content_Types].xml").async("string");
  assert.equal((contentTypes.match(/chart\+xml/g) ?? []).length, 33);
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

test("hoja de dimensiones: tabla ancha Suma/Nivel/Código, baremo y narrativa", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "20" });
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Dimensiones Gestion de abasteci");
  assert.ok(sheet, "hoja de dimensiones V1 existe");

  // Tabla ancha unica: 3 columnas (Suma | Nivel | Código) por dimension y por
  // el consolidado; la base de datos NO se repite, solo se referencia.
  assert.match(String(sheet.cell("B2").value()), /SUMA, NIVEL Y CÓDIGO/);
  assert.equal(sheet.cell("C3").value(), "Planificacion");
  assert.equal(sheet.cell("F3").value(), "Transparencia");
  assert.match(String(sheet.cell("L3").value()), /consolidado/);
  assert.equal(sheet.cell("B4").value(), "ID");
  assert.equal(sheet.cell("C4").value(), "Suma");
  assert.equal(sheet.cell("D4").value(), "Nivel");
  assert.equal(sheet.cell("E4").value(), "Código");

  // Suma por referencia a la hoja base; nivel y codigo derivados de la suma
  // (6 items, escala 1-5, 3 niveles => 6-13 / 14-21 / 22-30).
  assert.match(String(sheet.cell("C5").formula()), /SUM\('Gestion de abastecimiento'!B5:G5\)/);
  assert.match(String(sheet.cell("D5").formula()), /IF\(C5<=13,"Bajo"/);
  assert.match(String(sheet.cell("E5").formula()), /IF\(C5<=13,1,IF\(C5<=21,2,3\)\)/);
  assert.match(String(sheet.cell("L5").formula()), /'Gestion de abastecimiento'!T5/);
  // No hay columnas de items repetidas: tras el consolidado (L:N) no hay datos.
  assert.equal(sheet.cell(5, 15).value(), undefined);

  // Bloque de la dimension 1: ficha de baremo sin base repetida.
  let dimRow = null;
  for (let r = 5; r <= 300; r += 1) {
    if (String(sheet.cell(r, 2).value() ?? "").startsWith("DIMENSIÓN 1")) { dimRow = r; break; }
  }
  assert.ok(dimRow, "existe bloque DIMENSIÓN 1");
  assert.equal(sheet.cell(dimRow + 2, 2).value(), "Variable");
  assert.equal(sheet.cell(dimRow + 2, 6).value(), 6); // rango minimo nivel 1
  assert.equal(sheet.cell(dimRow + 2, 7).value(), 13); // rango maximo nivel 1
  assert.equal(sheet.cell(dimRow + 4, 8).value(), "Alto");

  // Tabla baremada: cuenta la columna Nivel de la tabla ancha.
  let tablaRow = null;
  for (let r = dimRow; r <= dimRow + 40; r += 1) {
    if (String(sheet.cell(r, 2).value() ?? "") === "Tabla 1") { tablaRow = r; break; }
  }
  assert.ok(tablaRow, "existe rotulo Tabla 1");
  assert.equal(sheet.cell(tablaRow + 2, 2).value(), "Calificación");
  assert.equal(sheet.cell(tablaRow + 2, 3).value(), "Desde");
  assert.match(String(sheet.cell(tablaRow + 3, 5).formula()), /COUNTIF\(D\$5:D\$24,"Bajo"\)/);
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

test("hoja de items: tablas, fuente y narrativas; sin hojas de conteo", async () => {
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

  // La escala Likert es de los items; las dimensiones se miden por niveles en
  // la hoja "Dimensiones": no deben existir hojas de conteo por escala.
  assert.equal(workbook.sheet("Conteo Gestion de abastecimient"), undefined);
  assert.ok(workbook.sheets().every((s) => !s.name().startsWith("Conteo")));
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
  assert.match(String(sheet.cell("C5").formula()), /'Dimensiones Gestion de abasteci'!C5/);

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

test("control de correlacion: niveles y direccion respetados", async () => {
  // Nivel moderada, direccion directa: r de Spearman dentro de ±0.40-0.69.
  const moderada = await generateArtifacts({ ...baseConfig, muestra: "80", nivelCorrelacion: "moderada" });
  const cc = moderada.correlationControl;
  assert.equal(cc.activo, true);
  assert.equal(cc.metodo, "spearman");
  assert.equal(cc.direccion, "directa");
  assert.equal(cc.esperadoMin, 0.4);
  assert.equal(cc.esperadoMax, 0.69);
  assert.ok(cc.obtenido >= 0.34 && cc.obtenido <= 0.75, `r=${cc.obtenido}`);

  // Nivel alta + relacion inversa: correlacion negativa en ±0.70-0.89.
  const inversa = await generateArtifacts({
    ...baseConfig, muestra: "80", relacionversa: "1", nivelCorrelacion: "alta",
  });
  const cci = inversa.correlationControl;
  assert.equal(cci.direccion, "inversa");
  assert.ok(cci.obtenido <= -0.64 && cci.obtenido >= -0.95, `r=${cci.obtenido}`);

  // Nivel desconocido: aviso y fallback a muy_alta.
  const malo = await generateArtifacts({ ...baseConfig, muestra: "30", nivelCorrelacion: "gigante" });
  assert.ok(malo.warnings.some((w) => w.includes("nivel de correlacion")));
  assert.equal(malo.correlationControl.nivel, "muy_alta");
});

test("metodo pearson: la normalidad pasa y Relaciones usa Pearson", async () => {
  const result = await generateArtifacts({
    ...baseConfig, muestra: "80", nivelCorrelacion: "alta", metodoCorrelacion: "pearson",
  });
  assert.equal(result.correlationControl.metodo, "pearson");
  assert.ok(result.correlationControl.obtenido >= 0.64 && result.correlationControl.obtenido <= 0.95,
    `r=${result.correlationControl.obtenido}`);

  // Con datos generados con perfiles simetricos la prueba de normalidad de la
  // hoja Relaciones debe pasar y las tablas usar Pearson (no Spearman).
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const sheet = workbook.sheet("Relaciones");
  let label = null;
  for (let r = 4; r <= 150; r += 1) {
    const v = String(sheet.cell(r, 10).value() ?? "");
    if (v === "Correlación de Pearson" || v === "Rho de Spearman") { label = v; break; }
  }
  assert.equal(label, "Correlación de Pearson");
});

test("control de correlacion desactivado: resultado natural", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "60", controlCorrelacion: "0" });
  const cc = result.correlationControl;
  assert.equal(cc.activo, false);
  assert.equal(typeof cc.obtenido, "number");
  assert.equal(cc.cumple, undefined); // sin objetivo no hay rango que cumplir
  assert.equal(typeof result.correlation, "number"); // Pearson informativo sigue presente
});

test("tema powerbi colorea los puntos y expone chartsPreview", async () => {
  const result = await generateArtifacts({ ...baseConfig, muestra: "15", tema: "powerbi" });
  assert.equal(result.tema, "powerbi");

  const zip = await JSZip.loadAsync(result.excelBuffer);
  const chartXml = await zip.file("xl/charts/chart1.xml").async("string");
  assert.ok(chartXml.includes("<c:dPt>"), "cada punto lleva color explicito");
  assert.match(chartXml, /118DFF/);

  // Datos para la vista previa: un registro por grafico inyectado.
  const totalCharts = result.chartsPreview.reduce((acc, s) => acc + s.charts.length, 0);
  assert.equal(totalCharts, 33);
  const first = result.chartsPreview[0].charts[0];
  assert.equal(first.categories.length, 5);
  const sum = first.values.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);

  // Tema desconocido: aviso y tema clasico sin dPt.
  const fallback = await generateArtifacts({ ...baseConfig, muestra: "10", tema: "neon" });
  assert.equal(fallback.tema, "clasico");
  assert.ok(fallback.warnings.some((w) => w.includes("tema")));
  const zipFb = await JSZip.loadAsync(fallback.excelBuffer);
  const chartFb = await zipFb.file("xl/charts/chart1.xml").async("string");
  assert.ok(!chartFb.includes("<c:dPt>"), "el tema clasico conserva el XML historico");
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
  assert.deepEqual(result.chartsPreview, []); // sin datos no hay vista previa de graficos
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
