import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import XlsxPopulate from "xlsx-populate";
import { validateSimulation } from "../lib/descriptiva/validate.js";
import {
  baremoDistribution, computeAciertos, computeLikertPuntajes, computePuntajes,
  detectLikertBaremo, distributionFor,
} from "../lib/descriptiva/compute.js";
import { stripCodeFences } from "../lib/descriptiva/openrouter.js";
import { buildDescriptivaWorkbook } from "../lib/descriptiva/workbook.js";
import { postProcessWorkbook } from "../lib/ooxml.js";
import { CHART_THEMES } from "../lib/config.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const fixtureIndependiente = (n = 12) => ({
  metadata: {
    titulo_estudio: "Consumo de bebidas azucaradas, I.E. de prueba - 2026",
    n_encuestados: n,
    tipo_instrumento: "independiente",
    nivel_preponderancia: "ALTO",
  },
  preguntas: [
    { id: "p1_edad", texto: "Edad", tipo: "numerica", rango: [12, 17] },
    {
      id: "p2_genero", texto: "Género", tipo: "nominal_unica",
      opciones: ["Masculino", "Femenino"], pesos: [0.5, 0.5], es_ancla: false, depende_de: null,
    },
    {
      id: "p3_frecuencia", texto: "¿Con qué frecuencia consumes?", tipo: "ordinal_unica",
      opciones: ["Siempre", "A veces", "Nunca"], pesos: [0.5, 0.3, 0.2], es_ancla: true, depende_de: null,
    },
    {
      id: "p4_tipo", texto: "¿Qué tipos consumes?", tipo: "multirrespuesta",
      opciones: ["Gaseosa", "Jugo", "Energizante"], pesos_marca_independientes: [0.6, 0.5, 0.3],
      es_ancla: false, depende_de: "p3_frecuencia",
    },
  ],
  baremo: null,
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_edad: 12 + (i % 6),
    p2_genero: i % 2 === 0 ? "Masculino" : "Femenino",
    p3_frecuencia: ["Siempre", "A veces", "Nunca"][i % 3],
    p4_tipo__gaseosa: i % 2,
    p4_tipo__jugo: (i + 1) % 2,
    p4_tipo__energizante: i % 3 === 0 ? 1 : 0,
  })),
});

const fixturePuntaje = (n = 10) => ({
  metadata: {
    titulo_estudio: "Test de riesgo (FINDRISC adaptado) - 2026",
    n_encuestados: n,
    tipo_instrumento: "puntaje_sumado",
    nivel_preponderancia: "MODERADO",
  },
  preguntas: [
    {
      id: "p1_imc", texto: "IMC", tipo: "ordinal_unica",
      opciones: ["Menor de 25", "25 a 30", "Mayor de 30"],
      pesos: [0.3, 0.4, 0.3], puntos_por_opcion: [0, 1, 3], es_ancla: true, depende_de: null,
    },
    {
      id: "p2_actividad", texto: "¿Realiza actividad física?", tipo: "nominal_unica",
      opciones: ["Sí", "No"], pesos: [0.4, 0.6], puntos_por_opcion: [0, 2],
      es_ancla: false, depende_de: "p1_imc",
    },
  ],
  baremo: {
    variable_base: "puntaje_total",
    rangos: [
      { min: 0, max: 1, categoria: "Riesgo bajo" },
      { min: 2, max: 3, categoria: "Riesgo moderado" },
      { min: 4, max: 5, categoria: "Riesgo alto" },
    ],
  },
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_imc: ["Menor de 25", "25 a 30", "Mayor de 30"][i % 3],
    p2_actividad: i % 2 === 0 ? "Sí" : "No",
  })),
});

const fixtureConocimiento = (n = 8) => ({
  metadata: {
    titulo_estudio: "Cuestionario de conocimiento en RCP - 2026",
    n_encuestados: n,
    tipo_instrumento: "conocimiento",
    nivel_preponderancia: "MODERADO",
  },
  preguntas: [
    {
      id: "p1_rcp", texto: "¿Qué significa RCP?", tipo: "nominal_unica",
      opciones: ["a) Reanimación cardiopulmonar", "b) Revisión clínica", "c) Rescate primario"],
      pesos: [0.6, 0.2, 0.2], respuesta_correcta: "a) Reanimación cardiopulmonar",
      es_ancla: false, depende_de: null,
    },
    {
      id: "p2_compresiones", texto: "¿Frecuencia de compresiones?", tipo: "nominal_unica",
      opciones: ["a) 60/min", "b) 100-120/min", "c) 140/min"],
      pesos: [0.2, 0.5, 0.3], respuesta_correcta: "b) 100-120/min",
      es_ancla: false, depende_de: null,
    },
  ],
  baremo: {
    variable_base: "porcentaje_aciertos",
    rangos: [
      { min: 0, max: 49, categoria: "Conocimiento bajo" },
      { min: 50, max: 74, categoria: "Conocimiento medio" },
      { min: 75, max: 100, categoria: "Conocimiento alto" },
    ],
  },
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_rcp: i % 2 === 0 ? "a) Reanimación cardiopulmonar" : "b) Revisión clínica",
    p2_compresiones: i % 4 === 0 ? "b) 100-120/min" : "a) 60/min",
  })),
});

// ── stripCodeFences ─────────────────────────────────────────────────────────

test("stripCodeFences limpia backticks y texto alrededor", () => {
  assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFences('Aquí está tu JSON:\n{"a":1}\nSaludos.'), '{"a":1}');
  assert.equal(stripCodeFences('{"a":1}'), '{"a":1}');
});

// ── validateSimulation ──────────────────────────────────────────────────────

test("fixtures validas pasan sin errores", () => {
  assert.deepEqual(validateSimulation(fixtureIndependiente()), []);
  assert.deepEqual(validateSimulation(fixturePuntaje()), []);
  assert.deepEqual(validateSimulation(fixtureConocimiento()), []);
});

test("detecta n_encuestados inconsistente", () => {
  const data = fixtureIndependiente();
  data.metadata.n_encuestados = 99;
  assert.ok(validateSimulation(data).some((e) => e.includes("99")));
});

test("detecta fila sin respuesta y valor fuera de opciones", () => {
  const data = fixtureIndependiente();
  delete data.datos_simulados[3].p3_frecuencia;
  data.datos_simulados[5].p2_genero = "Otro";
  const errors = validateSimulation(data);
  assert.ok(errors.some((e) => e.includes("p3_frecuencia")));
  assert.ok(errors.some((e) => e.includes("p2_genero")));
});

test("exige baremo cuando el instrumento no es independiente", () => {
  const data = fixturePuntaje();
  data.baremo = null;
  assert.ok(validateSimulation(data).some((e) => e.includes("baremo")));
});

test("detecta columnas multirrespuesta incompletas", () => {
  const data = fixtureIndependiente();
  for (const row of data.datos_simulados) delete row.p4_tipo__energizante;
  assert.ok(validateSimulation(data).some((e) => e.includes("p4_tipo")));
});

// ── compute ─────────────────────────────────────────────────────────────────

test("distribucion de respuesta unica y multirrespuesta", () => {
  const data = fixtureIndependiente(12);
  const dGenero = distributionFor(data.preguntas[1], data.datos_simulados);
  assert.deepEqual(dGenero.counts, [6, 6]);
  const dMulti = distributionFor(data.preguntas[3], data.datos_simulados);
  assert.equal(dMulti.multi, true);
  assert.equal(dMulti.counts[0], 6); // p4_tipo__gaseosa = i % 2
  assert.equal(dMulti.counts[2], 4); // multiplos de 3 entre 0 y 11
});

test("puntaje total y clasificacion se recalculan desde las filas", () => {
  const data = fixturePuntaje(6);
  const computed = computePuntajes(data.preguntas, data.datos_simulados, data.baremo);
  // fila 0: "Menor de 25" (0 pts) + "Sí" (0 pts) = 0 -> Riesgo bajo
  assert.equal(computed[0].puntaje_total, 0);
  assert.equal(computed[0].clasificacion, "Riesgo bajo");
  // fila 1: "25 a 30" (1 pt) + "No" (2 pts) = 3 -> Riesgo moderado
  assert.equal(computed[1].puntaje_total, 3);
  assert.equal(computed[1].clasificacion, "Riesgo moderado");
  const dist = baremoDistribution(data.baremo, computed);
  assert.equal(dist.counts.reduce((a, b) => a + b, 0), 6);
});

test("aciertos y porcentaje contra respuesta_correcta", () => {
  const data = fixtureConocimiento(8);
  const computed = computeAciertos(data.preguntas, data.datos_simulados, data.baremo);
  // fila 0: ambas correctas -> 100% -> Conocimiento alto
  assert.equal(computed[0].aciertos, 2);
  assert.equal(computed[0].porcentaje_aciertos, 100);
  assert.equal(computed[0].clasificacion, "Conocimiento alto");
  // fila 1: ambas incorrectas -> 0% -> Conocimiento bajo
  assert.equal(computed[1].aciertos, 0);
  assert.equal(computed[1].clasificacion, "Conocimiento bajo");
});

// ── Baremo Likert generado por el sistema ───────────────────────────────────

const ESCALA_LIKERT = ["Nunca", "A veces", "Casi siempre", "Siempre"];
const fixtureLikert = (n = 12) => ({
  metadata: {
    titulo_estudio: "Clima organizacional, empresa de prueba - 2026",
    n_encuestados: n,
    tipo_instrumento: "independiente",
    nivel_preponderancia: "MODERADO",
  },
  preguntas: [
    { id: "p1_edad", texto: "Edad", tipo: "numerica", rango: [20, 60] },
    ...[1, 2, 3, 4].map((k) => ({
      id: `p${k + 1}_item`, texto: `Ítem Likert ${k}`, tipo: "ordinal_unica",
      opciones: [...ESCALA_LIKERT], pesos: [0.2, 0.3, 0.3, 0.2], es_ancla: k === 1, depende_de: null,
    })),
  ],
  baremo: null,
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_edad: 20 + (i * 3) % 40,
    p2_item: ESCALA_LIKERT[i % 4],
    p3_item: ESCALA_LIKERT[(i + 1) % 4],
    p4_item: ESCALA_LIKERT[(i + 2) % 4],
    p5_item: ESCALA_LIKERT[i % 4],
  })),
});

test("instrumento Likert sin escala propia: se genera baremo Bajo/Medio/Alto", () => {
  const data = fixtureLikert();
  const likert = detectLikertBaremo(data);
  assert.ok(likert, "debe detectar el grupo Likert");
  assert.equal(likert.generado, true);
  assert.equal(likert.itemIds.length, 4);
  // 4 items, escala 1-4: puntajes 4 a 16, cortes por intervalos equivalentes.
  assert.deepEqual(likert.rangos.map((r) => r.categoria), ["Bajo", "Medio", "Alto"]);
  assert.equal(likert.rangos[0].min, 4);
  assert.equal(likert.rangos[2].max, 16);

  const computed = computeLikertPuntajes(likert, data.datos_simulados);
  // fila 0: Nunca(1) + A veces(2) + Casi siempre(3) + Nunca(1) = 7
  assert.equal(computed[0].puntaje_total, 7);
  assert.ok(computed.every((c) => c.clasificacion !== "Sin clasificar"));
});

test("prohibido: escala dicotomica no genera baremo", () => {
  const data = fixtureLikert();
  // Todas las preguntas pasan a Si/No (dicotomicas).
  data.preguntas = data.preguntas.map((p) => (p.tipo === "ordinal_unica"
    ? { ...p, opciones: ["Sí", "No"] }
    : p));
  data.datos_simulados = data.datos_simulados.map((row) => {
    const out = { ...row };
    for (const k of ["p2_item", "p3_item", "p4_item", "p5_item"]) out[k] = "Sí";
    return out;
  });
  assert.equal(detectLikertBaremo(data), null);
});

test("prohibido: menos de 3 items con la misma escala no genera baremo", () => {
  const data = fixtureLikert();
  // Solo 2 items comparten escala; los otros usan opciones distintas.
  data.preguntas[3].opciones = ["Bajo", "Medio", "Alto"];
  data.preguntas[4].opciones = ["Malo", "Regular", "Bueno"];
  assert.equal(detectLikertBaremo(data), null);
});

test("si el instrumento ya trae su propia escala, no se genera baremo Likert", () => {
  // Con puntos por opcion (escala de medicion determinada) manda el
  // instrumento, aunque los items parezcan Likert.
  const conPuntos = fixtureLikert();
  conPuntos.preguntas[1].puntos_por_opcion = [0, 1, 2, 3];
  assert.equal(detectLikertBaremo(conPuntos), null);

  // Y un instrumento puntaje_sumado/conocimiento nunca pasa por aqui.
  const propio = fixturePuntaje();
  assert.equal(detectLikertBaremo(propio), null);
});

test("workbook Likert: hoja Baremo generada con nota del sistema", async () => {
  const data = fixtureLikert();
  const likert = detectLikertBaremo(data);
  const computed = computeLikertPuntajes(likert, data.datos_simulados);
  const { workbook, sheetCharts } = await buildDescriptivaWorkbook(data, computed, likert);
  const plain = await workbook.outputAsync({ type: "nodebuffer" });
  const buffer = await postProcessWorkbook(plain, sheetCharts, CHART_THEMES.clasico.colores);

  const wb = await XlsxPopulate.fromDataAsync(buffer);
  assert.deepEqual(wb.sheets().map((s) => s.name()), ["Base de datos", "Resultados", "Baremo"]);
  const text = wb.sheet("Baremo").usedRange().value().flat().filter(Boolean).join(" ");
  assert.ok(text.includes("ESCALA LIKERT"));
  assert.ok(text.includes("Baremo construido por el sistema"));

  // La base incluye Puntaje total y Clasificación calculados.
  const base = wb.sheet("Base de datos");
  const headers = [];
  for (let c = 2; c <= 9; c += 1) headers.push(base.cell(5, c).value());
  assert.ok(headers.includes("Puntaje total"));
  assert.ok(headers.includes("Clasificación"));
});

test("independiente no medible (nominal/dicotomico) queda sin hoja Baremo", async () => {
  const data = fixtureIndependiente(12); // genero nominal + ordinal de 3 pero solo 1 item ordinal
  const { workbook } = await buildDescriptivaWorkbook(data, null, detectLikertBaremo(data));
  assert.deepEqual(workbook.sheets().map((s) => s.name()), ["Base de datos", "Resultados"]);
});

// ── workbook ────────────────────────────────────────────────────────────────

const buildBuffer = async (data, computed) => {
  const { workbook, sheetCharts } = await buildDescriptivaWorkbook(data, computed);
  const plain = await workbook.outputAsync({ type: "nodebuffer" });
  return { buffer: await postProcessWorkbook(plain, sheetCharts, CHART_THEMES.clasico.colores), sheetCharts };
};

test("workbook independiente: hojas, formulas y graficos", async () => {
  const data = fixtureIndependiente(12);
  const { buffer, sheetCharts } = await buildBuffer(data, null);

  const wb = await XlsxPopulate.fromDataAsync(buffer);
  const names = wb.sheets().map((s) => s.name());
  assert.deepEqual(names, ["Base de datos", "Resultados"]);

  // Base: 12 filas de datos + columnas multirrespuesta expandidas.
  const base = wb.sheet("Base de datos");
  assert.equal(base.cell(6, 1).value(), 1);
  assert.equal(base.cell(17, 1).value(), 12);
  assert.equal(base.cell(4, 2).value(), "p1_edad");

  // Resultados: una tabla por pregunta con COUNTIF/SUM vivos.
  const res = wb.sheet("Resultados");
  const usedRange = res.usedRange().value().flat().filter(Boolean).join(" ");
  assert.ok(usedRange.includes("Tabla 4"), "debe haber 4 tablas (una por pregunta)");
  assert.ok(usedRange.includes("Figura 4"));

  // Graficos inyectados en el zip: 4 (uno por pregunta).
  assert.equal(sheetCharts[0].charts.length, 4);
  const zip = await JSZip.loadAsync(buffer);
  const charts = Object.keys(zip.files).filter((p) => p.startsWith("xl/charts/") && !zip.files[p].dir);
  assert.equal(charts.length, 4);
});

test("workbook puntaje_sumado agrega hoja Baremo con clasificacion", async () => {
  const data = fixturePuntaje(10);
  const computed = computePuntajes(data.preguntas, data.datos_simulados, data.baremo);
  const { buffer } = await buildBuffer(data, computed);

  const wb = await XlsxPopulate.fromDataAsync(buffer);
  assert.deepEqual(wb.sheets().map((s) => s.name()), ["Base de datos", "Resultados", "Baremo"]);

  // La base incluye las columnas calculadas por el sistema.
  const base = wb.sheet("Base de datos");
  const headers = [];
  for (let c = 2; c <= 6; c += 1) headers.push(base.cell(5, c).value());
  assert.ok(headers.includes("Puntaje total"));
  assert.ok(headers.includes("Clasificación"));

  const zip = await JSZip.loadAsync(buffer);
  const charts = Object.keys(zip.files).filter((p) => p.startsWith("xl/charts/") && !zip.files[p].dir);
  assert.equal(charts.length, 3); // 2 preguntas + 1 baremo
});

test("workbook conocimiento agrega aciertos y nivel", async () => {
  const data = fixtureConocimiento(8);
  const computed = computeAciertos(data.preguntas, data.datos_simulados, data.baremo);
  const { buffer } = await buildBuffer(data, computed);

  const wb = await XlsxPopulate.fromDataAsync(buffer);
  const base = wb.sheet("Base de datos");
  const headers = [];
  for (let c = 2; c <= 7; c += 1) headers.push(base.cell(5, c).value());
  assert.ok(headers.includes("Aciertos"));
  assert.ok(headers.includes("% de aciertos"));

  // La numeracion de la figura del baremo continua tras las preguntas.
  const baremoSheet = wb.sheet("Baremo");
  const text = baremoSheet.usedRange().value().flat().filter(Boolean).join(" ");
  assert.ok(text.includes("Tabla 3"));
});
