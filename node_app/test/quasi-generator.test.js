// Pruebas del flujo cuasiexperimental completo: configuracion, simulacion,
// workbook real (hojas, formulas, grafico) y CSV. El flujo correlacional se
// cubre en generator.test.js y no debe verse afectado.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import XlsxPopulate from "xlsx-populate";
import JSZip from "jszip";
import {
  MAX_MUESTRA,
  ROOT_DIR,
  buildQuasiExperimentalCsv,
  generateArtifacts,
  generateQuasiExperimentalData,
  isQuasiExperimentalConfig,
  normalizeConfig,
  normalizeQuasiExperimentalConfig,
  prepareQuasiExperimentalRawConfig,
} from "../generator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(here, "../../examples/Tabulacion_cuasiexperimental.json");
const raw = JSON.parse(fs.readFileSync(examplePath, "utf8"));

const normalizedExample = () => {
  const prepared = prepareQuasiExperimentalRawConfig(raw);
  return normalizeQuasiExperimentalConfig(raw, normalizeConfig(prepared));
};

test("detecta y normaliza el diseño cuasiexperimental", () => {
  assert.equal(isQuasiExperimentalConfig(raw), true);
  assert.equal(isQuasiExperimentalConfig({ muestra: "30" }), false);
  const cfg = normalizedExample();
  assert.equal(cfg.diseno, "cuasiexperimental");
  assert.equal(cfg.cuasiexperimental.nExperimental, 30);
  assert.equal(cfg.cuasiexperimental.nControl, 30);
  assert.equal(cfg.cuasiexperimental.efectoNivel, "moderado");
  assert.equal(cfg.cuasiexperimental.direccion, 1);
  assert.equal(cfg.cuasiexperimental.alpha, 0.05);
  assert.equal(cfg.variables.length, 1);
  assert.equal(cfg.variables[0].totalItems, 12);
});

test("rechaza grupos invalidos y muestras excesivas", () => {
  assert.throws(
    () => prepareQuasiExperimentalRawConfig({ ...raw, nExperimental: 1 }),
    /al menos 2 participantes/,
  );
  assert.throws(
    () => prepareQuasiExperimentalRawConfig({ ...raw, nExperimental: MAX_MUESTRA, nControl: 10 }),
    /muestra total máxima/,
  );
});

test("genera grupos coherentes: escala respetada, totales y cambio", () => {
  const cfg = normalizedExample();
  const data = generateQuasiExperimentalData(cfg);
  assert.equal(data.experimental.length, 30);
  assert.equal(data.control.length, 30);
  assert.equal(data.analysis.comparisons.length, 3);

  [...data.experimental, ...data.control].forEach((row) => {
    assert.equal(row.pre.length, 12);
    assert.equal(row.post.length, 12);
    [...row.pre, ...row.post].forEach((value) => {
      assert.ok(value >= 1 && value <= 5, `valor fuera de escala: ${value}`);
    });
    assert.equal(row.preTotal, row.pre.reduce((a, b) => a + b, 0));
    assert.equal(row.postTotal, row.post.reduce((a, b) => a + b, 0));
    assert.equal(row.change, row.postTotal - row.preTotal);
  });
});

test("efecto grande con mejora: GE sube significativamente", () => {
  const rawGrande = { ...raw, efectoIntervencion: "grande", controlarResultados: true };
  const prepared = prepareQuasiExperimentalRawConfig(rawGrande);
  const cfg = normalizeQuasiExperimentalConfig(rawGrande, normalizeConfig(prepared));
  const data = generateQuasiExperimentalData(cfg);
  const [experimental] = data.analysis.comparisons;
  assert.ok(data.analysis.descriptive.experimentalChange.mean > 0, "el GE debe mejorar");
  assert.ok(experimental.p < 0.05, `pre-post GE debe ser significativo (p=${experimental.p})`);
  assert.equal(experimental.significant, true);
  assert.match(experimental.decision, /Se rechaza/);
});

test("direccion disminuye invierte el cambio del GE", () => {
  const rawBaja = { ...raw, efectoIntervencion: "grande", direccionEfecto: "disminuye" };
  const prepared = prepareQuasiExperimentalRawConfig(rawBaja);
  const cfg = normalizeQuasiExperimentalConfig(rawBaja, normalizeConfig(prepared));
  assert.equal(cfg.cuasiexperimental.direccion, -1);
  const data = generateQuasiExperimentalData(cfg);
  assert.ok(data.analysis.descriptive.experimentalChange.mean < 0, "el GE debe disminuir");
});

test("analisis: normalidad de diferencias en pares e hipotesis completas", () => {
  const cfg = normalizedExample();
  const data = generateQuasiExperimentalData(cfg);
  const { baseline, comparisons } = data.analysis;

  // Comparaciones relacionadas: 1 prueba de normalidad sobre las diferencias.
  comparisons.slice(0, 2).forEach((comparison) => {
    assert.equal(comparison.type, "paired");
    assert.equal(comparison.normality.length, 1);
    assert.match(comparison.normality[0].target, /Diferencias post-pre/);
    assert.ok(["t_pareada", "wilcoxon"].includes(comparison.test));
  });
  // Independientes: normalidad de ambos grupos.
  [baseline, comparisons[2]].forEach((comparison) => {
    assert.equal(comparison.type, "independent");
    assert.equal(comparison.normality.length, 2);
    assert.ok(["t_independiente_welch", "mann_whitney"].includes(comparison.test));
  });
  // Cada comparacion informa hipotesis, alpha, decision, efecto e interpretacion.
  [baseline, ...comparisons].forEach((comparison) => {
    assert.match(comparison.hypotheses.nula, /^H₀/);
    assert.match(comparison.hypotheses.alterna, /^H₁/);
    assert.equal(comparison.alpha, 0.05);
    assert.ok(typeof comparison.p === "number" && comparison.p >= 0 && comparison.p <= 1);
    assert.match(comparison.decision, /H₀/);
    assert.ok(Number.isFinite(comparison.effectSize));
    assert.ok(comparison.interpretation.length > 30);
    assert.ok(comparison.testLabel.length > 5);
  });
});

test("workbook cuasiexperimental: hojas, formulas, grafico y CSV", async () => {
  const result = await generateArtifacts(raw);
  assert.equal(result.diseno, "cuasiexperimental");
  assert.equal(result.correlation, null);
  assert.ok(result.quasiExperimental, "expone el analisis para el frontend");
  assert.ok(result.excelBuffer.length > 10000);

  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const names = workbook.sheets().map((s) => s.name());
  assert.deepEqual(names, [
    "GE Pretest", "GE Postest", "GC Pretest", "GC Postest",
    "Consolidado", "Comparaciones", "Información",
  ]);

  // Hoja de medicion: columnas Codigo/Grupo/Medicion, items, dimension, total,
  // nivel y cambio. 12 items y 3 dimensiones: items D4..O4 (cols 4-15),
  // dimensiones P-U (16-21), total V (22), nivel W (23), cambio X (24).
  const gePre = workbook.sheet("GE Pretest");
  assert.equal(gePre.cell("A2").value(), "Código");
  assert.equal(gePre.cell("B2").value(), "Grupo");
  assert.equal(gePre.cell("C2").value(), "Medición");
  assert.equal(gePre.cell("D2").value(), "Coordinación visomanual");
  assert.equal(gePre.cell("P3").value(), "Puntaje");
  assert.equal(gePre.cell("Q3").value(), "Nivel");
  assert.equal(gePre.cell("V2").value(), "Puntaje total");
  assert.equal(gePre.cell("W2").value(), "Nivel general");
  assert.match(String(gePre.cell("X2").value()), /Cambio/);

  assert.equal(gePre.cell("A4").value(), "GE-001");
  assert.equal(gePre.cell("B4").value(), "Experimental");
  assert.equal(gePre.cell("C4").value(), "Pretest");
  const v = gePre.cell("D4").value();
  assert.ok(v >= 1 && v <= 5, `respuesta fuera de escala: ${v}`);
  assert.match(String(gePre.cell("P4").formula()), /SUM\(D4:G4\)/);
  assert.match(String(gePre.cell("Q4").formula()), /IF\(P4<=/);
  assert.match(String(gePre.cell("V4").formula()), /SUM\(D4:O4\)/);
  assert.match(String(gePre.cell("W4").formula()), /IF\(V4<=/);
  assert.match(String(gePre.cell("X4").formula()), /'GE Postest'!V4-'GE Pretest'!V4/);

  // GC usa sus propias hojas para el cambio.
  const gcPost = workbook.sheet("GC Postest");
  assert.equal(gcPost.cell("A4").value(), "GC-001");
  assert.equal(gcPost.cell("C4").value(), "Postest");
  assert.match(String(gcPost.cell("X4").formula()), /'GC Postest'!V4-'GC Pretest'!V4/);

  // Consolidado: formulas hacia las hojas de medicion; 60 filas de datos.
  const consolidado = workbook.sheet("Consolidado");
  assert.equal(consolidado.cell("B2").value(), "Grupo");
  assert.match(String(consolidado.cell("A3").formula()), /'GE Pretest'!A4/);
  assert.match(String(consolidado.cell("C3").formula()), /'GE Pretest'!V4/);
  assert.match(String(consolidado.cell("E3").formula()), /'GE Postest'!V4/);
  assert.match(String(consolidado.cell("G3").formula()), /E3-C3/);
  assert.equal(consolidado.cell("B33").value(), "Control");
  assert.match(String(consolidado.cell("C33").formula()), /'GC Pretest'!V4/);

  // Comparaciones: bloques de analisis presentes.
  const comparaciones = workbook.sheet("Comparaciones");
  let found = { descriptivos: false, normalidad: false, contraste: false, hipotesis: false };
  for (let r = 1; r <= 200; r += 1) {
    const value = String(comparaciones.cell(r, 1).value() ?? "");
    if (value.startsWith("Estadísticos descriptivos")) found.descriptivos = true;
    if (value.startsWith("Pruebas de normalidad")) found.normalidad = true;
    if (value.startsWith("Contraste de hipótesis")) found.contraste = true;
    if (value.startsWith("Hipótesis nula")) found.hipotesis = true;
  }
  assert.deepEqual(found, { descriptivos: true, normalidad: true, contraste: true, hipotesis: true });

  // Grafico de medias inyectado y con vista previa.
  const zip = await JSZip.loadAsync(result.excelBuffer);
  const charts = Object.keys(zip.files).filter((n) => n.startsWith("xl/charts/") && !zip.files[n].dir);
  assert.equal(charts.length, 1);
  const contentTypes = await zip.file("[Content_Types].xml").async("string");
  assert.equal((contentTypes.match(/chart\+xml/g) ?? []).length, 1);
  assert.equal(result.chartsPreview.length, 1);
  assert.equal(result.chartsPreview[0].sheet, "Comparaciones");
  assert.equal(result.chartsPreview[0].charts[0].categories.length, 4);

  // CSV: cabecera + 60 filas, con items, dimensiones, totales y cambio.
  const lines = result.baseCsv.trim().split("\n");
  assert.equal(lines.length, 61);
  const header = lines[0].split(",");
  ["ID", "Grupo", "PRE_P1", "PRE_P12", "PRE_D1", "PRE_D1_Nivel", "PRE_Total", "PRE_Nivel",
    "POST_P1", "POST_D3_Nivel", "POST_Total", "POST_Nivel", "Cambio"].forEach((column) => {
    assert.ok(header.includes(column), `falta columna ${column}`);
  });
  // Coherencia interna de la primera fila: D1 = suma de los primeros 4 items.
  const first = lines[1].split(",");
  const idx = (name) => header.indexOf(name);
  const d1 = Number(first[idx("PRE_D1")]);
  const items = [1, 2, 3, 4].map((i) => Number(first[idx(`PRE_P${i}`)]));
  assert.equal(d1, items.reduce((a, b) => a + b, 0));
  const total = Number(first[idx("PRE_Total")]);
  const allItems = Array.from({ length: 12 }, (_, i) => Number(first[idx(`PRE_P${i + 1}`)]));
  assert.equal(total, allItems.reduce((a, b) => a + b, 0));
  assert.equal(Number(first[idx("Cambio")]), Number(first[idx("POST_Total")]) - total);
});

test("conDatos=0 deja plantilla vacia con formulas listas", async () => {
  const result = await generateArtifacts({ ...raw, conDatos: "0" });
  assert.equal(result.quasiExperimental, null);
  assert.equal(result.baseCsv.split("\n").length, 1);
  assert.deepEqual(result.chartsPreview, []);
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const gePre = workbook.sheet("GE Pretest");
  assert.equal(gePre.cell("A4").value(), "GE-001");
  assert.equal(gePre.cell("D4").value(), undefined);
  assert.match(String(gePre.cell("V4").formula()), /SUM\(D4:O4\)/);
  const comparaciones = workbook.sheet("Comparaciones");
  assert.match(String(comparaciones.cell("A3").value()), /sin datos simulados/);
});

test("baremo del ejemplo: 12 items escala 1-5 => 12-27 / 28-43 / 44-60", async () => {
  const result = await generateArtifacts(raw);
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  const gePre = workbook.sheet("GE Pretest");
  // Bloque "Baremo de la variable" tras las 30 filas (fila 35 en adelante).
  let baremoRow = null;
  for (let r = 34; r <= 60; r += 1) {
    if (String(gePre.cell(r, 1).value() ?? "").startsWith("Baremo de la variable")) { baremoRow = r; break; }
  }
  assert.ok(baremoRow, "existe el bloque de baremo");
  assert.equal(gePre.cell(baremoRow + 2, 1).value(), "Bajo");
  assert.equal(gePre.cell(baremoRow + 2, 2).value(), 12);
  assert.equal(gePre.cell(baremoRow + 2, 3).value(), 27);
  assert.equal(gePre.cell(baremoRow + 4, 3).value(), 60);
});

test("el flujo correlacional sigue intacto (diseno correlacional por defecto)", async () => {
  const baseConfig = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "Tabulacion.json"), "utf-8"));
  const result = await generateArtifacts({ ...baseConfig, muestra: "15" });
  assert.equal(result.diseno, "correlacional");
  assert.equal(result.quasiExperimental, null);
  assert.equal(typeof result.correlation, "number");
  const workbook = await XlsxPopulate.fromDataAsync(result.excelBuffer);
  assert.ok(workbook.sheet("Correlación"), "hoja Correlación presente");
  assert.equal(workbook.sheet("GE Pretest"), undefined);
});

test("CSV sin datos conserva la cabecera completa", () => {
  const cfg = normalizedExample();
  const csv = buildQuasiExperimentalCsv(null, cfg);
  const header = csv.split("\n")[0];
  assert.match(header, /^ID,Grupo,PRE_P1/);
  assert.match(header, /Cambio$/);
});
