// Construccion del Excel de Tabulacion Descriptiva a partir del JSON validado
// de la IA. Mismo lenguaje visual que el generador principal (sheet-style.js)
// y graficos inyectados por ooxml.js. Las tablas usan formulas vivas
// (COUNTIF/COUNTIFS/SUM contra la hoja base), no valores pegados.
import XlsxPopulate from "xlsx-populate";
import {
  FONT, FMT_PCT, ST_BLOCK, ST_CELL, ST_CELL_LEFT, ST_HEADER, ST_LABEL_BOLD,
  ST_NOTE, ST_STATS_LABEL, ST_STATS_VALUE, ST_SUBHEADER,
  colLetter, paintFrame, quoteSheet, writeFuente, writeNarrative,
} from "../sheet-style.js";
import { resetAxisIds } from "../ooxml.js";
import {
  baremoDistribution, distributionFor, narrativeBaremo, narrativePregunta, pairMultiColumns,
} from "./compute.js";

const BASE_SHEET = "Base de datos";
const RESULTS_SHEET = "Resultados";
const BAREMO_SHEET = "Baremo";
const CHART_W = 6;
const CHART_H = 14;

// Criterio literal para COUNTIF: ademas de doblar comillas hay que escapar
// los comodines de Excel (?, *, ~) con "~", o una opcion como "Otros (¿cuál?)"
// contaria filas por patron en vez de por igualdad.
const escCriteria = (text) => String(text).replace(/"/g, '""').replace(/[~*?]/g, "~$&");

// Plan de columnas de la hoja base: una por pregunta de respuesta unica, una
// binaria por opcion de multirrespuesta y, al final, las calculadas por el
// sistema (puntaje/aciertos/clasificacion segun el tipo de instrumento).
const buildColumnPlan = (data, computed) => {
  const firstRow = data.datos_simulados[0];
  const plan = [];
  for (const p of data.preguntas) {
    if (p.tipo === "multirrespuesta") {
      // Emparejadas por slug (no por posicion): el orden de las claves del
      // JSON de la IA no garantiza el orden de las opciones.
      const cols = pairMultiColumns(p, firstRow);
      cols.forEach((key, i) => plan.push({
        key,
        id: key,
        header: `${p.texto} — ${p.opciones[i]}`,
        fromRow: (row) => Number(row[key]),
      }));
    } else {
      plan.push({
        key: p.id,
        id: p.id,
        header: String(p.texto ?? p.id),
        fromRow: (row) => (p.tipo === "numerica" ? Number(row[p.id]) : String(row[p.id])),
      });
    }
  }
  if (computed && computed.length > 0) {
    // Las columnas calculadas se deducen de lo que compute.js entrego: sirve
    // igual para el puntaje del instrumento, para aciertos y para el baremo
    // Likert generado por el sistema.
    if ("puntaje_total" in computed[0]) {
      plan.push({ key: "puntaje_total", id: "puntaje_total", header: "Puntaje total", fromRow: (_r, i) => computed[i].puntaje_total });
    }
    if ("aciertos" in computed[0]) {
      plan.push({ key: "aciertos", id: "aciertos", header: "Aciertos", fromRow: (_r, i) => computed[i].aciertos });
      plan.push({ key: "porcentaje_aciertos", id: "pct_aciertos", header: "% de aciertos", fromRow: (_r, i) => computed[i].porcentaje_aciertos });
    }
    plan.push({ key: "clasificacion", id: "clasificacion", header: "Clasificación", fromRow: (_r, i) => computed[i].clasificacion });
  }
  return plan;
};

const addBaseSheet = (sheet, data, plan) => {
  const rows = data.datos_simulados;
  const N = rows.length;
  const lastCol = plan.length + 1;

  sheet.gridLinesVisible(false);
  sheet.range(1, 1, 1, Math.min(lastCol, 12)).merged(true).style({ ...ST_HEADER, horizontalAlignment: "left" });
  sheet.cell(1, 1).value(`BASE DE DATOS — ${data.metadata.titulo_estudio}`);
  sheet.row(1).height(24);
  sheet.cell(2, 1).style(ST_NOTE).value(
    `${N} encuestados · instrumento ${data.metadata.tipo_instrumento}.`,
  );

  // Encabezados: fila de codigos (id) y fila con el texto de la pregunta.
  sheet.cell(4, 1).value("").style(ST_SUBHEADER);
  sheet.cell(5, 1).value("N°").style(ST_HEADER);
  plan.forEach((col, i) => {
    sheet.cell(4, i + 2).value(col.id).style(ST_SUBHEADER);
    sheet.cell(5, i + 2).value(col.header).style({ ...ST_HEADER, wrapText: true });
  });
  sheet.row(5).height(45);
  sheet.freezePanes(1, 5);

  const dataStart = 6;
  rows.forEach((row, i) => {
    const r = dataStart + i;
    const alt = i % 2 === 1 ? { fill: "F2F2F2" } : {};
    sheet.cell(r, 1).value(i + 1).style({ ...ST_CELL, ...alt });
    plan.forEach((col, j) => {
      sheet.cell(r, j + 2).value(col.fromRow(row, i)).style({ ...ST_CELL, ...alt });
    });
  });

  sheet.column("A").width(6);
  for (let c = 2; c <= lastCol; c += 1) sheet.column(colLetter(c)).width(16);

  return { dataStart, dataEnd: dataStart + N - 1 };
};

// Formula de frecuencia de una categoria contra la hoja base.
const freqFormula = (baseRef, colL, baseRange, dist, index) => {
  const rng = `${baseRef}!$${colL}$${baseRange.dataStart}:$${colL}$${baseRange.dataEnd}`;
  if (dist.multi) return `SUM(${rng})`;
  if (dist.criteria) {
    const { min, max } = dist.criteria[index];
    if (min === max) return `COUNTIF(${rng},${min})`;
    return `COUNTIFS(${rng},">=${min}",${rng},"<=${max}")`;
  }
  return `COUNTIF(${rng},"${escCriteria(dist.labels[index])}")`;
};

// Bloque Tabla N° + Figura N° + interpretacion para una distribucion. La
// numeracion de tablas y figuras es correlativa en todo el documento.
const addDistributionBlock = (sheet, ctx) => {
  const {
    numero, tituloBloque, textoPregunta, dist, formulaAt, charts, startRow, N,
  } = ctx;
  const C0 = 2;
  const sheetRef = quoteSheet(sheet.name());
  let row = startRow;

  sheet.range(row, C0, row, C0 + 3).merged(true).style(ST_BLOCK);
  sheet.cell(row, C0).value(tituloBloque);
  row += 1;
  sheet.cell(row, C0).value(`Tabla ${numero}`).style(ST_LABEL_BOLD);
  sheet.cell(row + 1, C0).value(textoPregunta).style(FONT);
  row += 2;

  sheet.cell(row, C0).value("").style(ST_HEADER);
  sheet.cell(row, C0 + 1).value("Frec.").style(ST_HEADER);
  sheet.cell(row, C0 + 2).value("%").style(ST_HEADER);
  const tStart = row + 1;
  dist.labels.forEach((label, i) => {
    const r = tStart + i;
    sheet.cell(r, C0).value(label).style(ST_CELL_LEFT);
    sheet.cell(r, C0 + 1).style(ST_CELL).formula(formulaAt(i));
    sheet.cell(r, C0 + 2).style({ ...ST_CELL, numberFormat: FMT_PCT })
      .formula(`${colLetter(C0 + 1)}${r}/${N}`);
  });
  const tTotal = tStart + dist.labels.length;
  if (dist.multi) {
    // En multirrespuesta el total no aplica: se anota la base de calculo.
    sheet.range(tTotal, C0, tTotal, C0 + 2).merged(true).style(ST_NOTE);
    sheet.cell(tTotal, C0).value(`Respuesta múltiple: porcentajes sobre ${N} encuestados.`);
  } else {
    sheet.cell(tTotal, C0).value("Total").style(ST_STATS_LABEL);
    sheet.cell(tTotal, C0 + 1).style(ST_STATS_VALUE)
      .formula(`SUM(${colLetter(C0 + 1)}${tStart}:${colLetter(C0 + 1)}${tTotal - 1})`);
    sheet.cell(tTotal, C0 + 2).style({ ...ST_STATS_VALUE, numberFormat: FMT_PCT })
      .formula(`SUM(${colLetter(C0 + 2)}${tStart}:${colLetter(C0 + 2)}${tTotal - 1})`);
  }
  row = writeFuente(sheet, tTotal + 1, C0) + 1;

  const chartTop = row;
  charts.push({
    title: `Figura ${numero}`,
    seriesName: "%",
    catRef: `${sheetRef}!$${colLetter(C0)}$${tStart}:$${colLetter(C0)}$${tTotal - 1}`,
    valRef: `${sheetRef}!$${colLetter(C0 + 2)}$${tStart}:$${colLetter(C0 + 2)}$${tTotal - 1}`,
    numFmt: FMT_PCT,
    varyColors: false,
    points: dist.labels.length,
    preview: { categories: dist.labels, values: dist.counts.map((c) => c / N) },
    anchor: {
      fromCol: C0 - 1,
      fromRow: chartTop - 1,
      toCol: C0 - 1 + CHART_W,
      toRow: chartTop - 1 + CHART_H,
    },
  });
  row = chartTop + CHART_H + 1;

  sheet.cell(row, C0).value(`Figura ${numero}`).style(ST_LABEL_BOLD);
  sheet.cell(row + 1, C0).value(textoPregunta).style(FONT);
  row += 3;
  return row;
};

const addResultsSheet = (sheet, data, plan, baseRange) => {
  const rows = data.datos_simulados;
  const N = rows.length;
  const baseRef = quoteSheet(BASE_SHEET);
  const colOf = new Map(plan.map((c, i) => [c.key, colLetter(i + 2)]));
  const charts = [];
  const C0 = 2;
  let row = 2;
  let numero = 0;

  sheet.gridLinesVisible(false);
  sheet.range(row, C0, row, C0 + 6).merged(true).style(ST_HEADER);
  sheet.cell(row, C0).value(`RESULTADOS DESCRIPTIVOS — ${data.metadata.titulo_estudio}`);
  sheet.row(row).height(24);
  row += 1;
  sheet.range(row, C0, row, C0 + 6).merged(true).style(ST_NOTE);
  sheet.cell(row, C0).value(
    `N = ${N} encuestados · frecuencia y porcentaje por ítem calculados sobre la hoja "${BASE_SHEET}".`,
  );
  row += 2;

  data.preguntas.forEach((p, idx) => {
    numero += 1;
    const dist = distributionFor(p, rows);
    const formulaAt = (i) => {
      const key = dist.multi ? dist.columns[i] : p.id;
      return freqFormula(baseRef, colOf.get(key), baseRange, dist, i);
    };
    row = addDistributionBlock(sheet, {
      numero,
      tituloBloque: `Pregunta ${idx + 1}`,
      textoPregunta: String(p.texto ?? p.id),
      dist,
      formulaAt,
      charts,
      startRow: row,
      N,
    });
    row = writeNarrative(sheet, row, C0, 7, 5, narrativePregunta(numero, String(p.texto ?? p.id), dist)) + 2;
  });

  sheet.column("B").width(30);
  ["C", "D", "E", "F", "G", "H"].forEach((c) => sheet.column(c).width(13));
  paintFrame(sheet, row, C0 + 8);
  return { charts, nextNumero: numero + 1 };
};

const addBaremoSheet = (sheet, data, plan, baseRange, computed, startNumero, baremo, modo) => {
  const baseRef = quoteSheet(BASE_SHEET);
  const colOf = new Map(plan.map((c, i) => [c.key, colLetter(i + 2)]));
  const charts = [];
  const C0 = 2;
  let row = 2;

  sheet.gridLinesVisible(false);
  const titulo = modo === "conocimiento"
    ? "NIVEL DE CONOCIMIENTO (ACIERTOS)"
    : modo === "likert"
      ? "NIVEL GENERAL DE LA VARIABLE (ESCALA LIKERT)"
      : "CLASIFICACIÓN SEGÚN PUNTAJE (BAREMO)";
  sheet.range(row, C0, row, C0 + 6).merged(true).style(ST_HEADER);
  sheet.cell(row, C0).value(`${titulo} — ${data.metadata.titulo_estudio}`);
  sheet.row(row).height(24);
  row += 2;

  // Tabla de referencia del baremo: los rangos del instrumento, o los cortes
  // por intervalos que construyo el sistema (solo escala Likert).
  sheet.cell(row, C0).value("Rango").style(ST_SUBHEADER);
  sheet.cell(row, C0 + 1).value("Categoría").style(ST_SUBHEADER);
  baremo.rangos.forEach((r, i) => {
    const unidad = baremo.variable_base === "porcentaje_aciertos" ? "%" : " pts";
    sheet.cell(row + 1 + i, C0).value(`${r.min} – ${r.max}${unidad}`).style(ST_CELL);
    sheet.cell(row + 1 + i, C0 + 1).value(String(r.categoria)).style(ST_CELL_LEFT);
  });
  const notaBaremo = modo === "likert"
    ? `Baremo construido por el sistema: suma de ${baremo.itemIds.length} ítems ordinales (códigos 1 a ${baremo.escala.length}`
      + `${baremo.invertida ? ", invertidos porque la escala está listada de mayor a menor" : ""}) con cortes por intervalos equivalentes.`
    : `Variable base: ${baremo.variable_base} (rangos definidos por el instrumento).`;
  sheet.cell(row + 1 + baremo.rangos.length, C0).style(ST_NOTE).value(notaBaremo);
  row += baremo.rangos.length + 3;

  const dist = baremoDistribution(baremo, computed);
  const clasL = colOf.get("clasificacion");
  const rng = `${baseRef}!$${clasL}$${baseRange.dataStart}:$${clasL}$${baseRange.dataEnd}`;
  const textoTabla = modo === "conocimiento"
    ? "Distribución del nivel de conocimiento según porcentaje de aciertos"
    : modo === "likert"
      ? "Distribución del nivel general según el puntaje sumado de la escala Likert"
      : "Distribución de la clasificación según puntaje total";
  row = addDistributionBlock(sheet, {
    numero: startNumero,
    tituloBloque: "Resultado global del instrumento",
    textoPregunta: textoTabla,
    dist,
    formulaAt: (i) => `COUNTIF(${rng},"${escCriteria(dist.labels[i])}")`,
    charts,
    startRow: row,
    N: dist.N,
  });
  row = writeNarrative(sheet, row, C0, 7, 5, narrativeBaremo(startNumero, modo, textoTabla, dist)) + 2;

  sheet.column("B").width(30);
  ["C", "D", "E", "F", "G", "H"].forEach((c) => sheet.column(c).width(13));
  paintFrame(sheet, row, C0 + 8);
  return { charts };
};

// Construye el workbook completo. `computed` es null cuando no hay capa de
// clasificacion; si existe, `baremo` es el del instrumento (puntaje_sumado /
// conocimiento) o el generado por el sistema para escala Likert. La capa
// siempre viene recalculada por compute.js, nunca de los agregados de la IA.
export const buildDescriptivaWorkbook = async (data, computed, baremoOverride = null) => {
  resetAxisIds();
  const workbook = await XlsxPopulate.fromBlankAsync();
  const plan = buildColumnPlan(data, computed);

  const baseSheet = workbook.sheet(0).name(BASE_SHEET);
  const baseRange = addBaseSheet(baseSheet, data, plan);

  const resultsSheet = workbook.addSheet(RESULTS_SHEET);
  const results = addResultsSheet(resultsSheet, data, plan, baseRange);

  const sheetCharts = [{ sheetName: RESULTS_SHEET, charts: results.charts }];

  const baremo = baremoOverride ?? data.baremo;
  if (computed && baremo) {
    const tipo = data.metadata.tipo_instrumento;
    const modo = baremoOverride?.generado ? "likert" : tipo === "conocimiento" ? "conocimiento" : "puntaje";
    const baremoSheet = workbook.addSheet(BAREMO_SHEET);
    const baremoResult = addBaremoSheet(baremoSheet, data, plan, baseRange, computed, results.nextNumero, baremo, modo);
    sheetCharts.push({ sheetName: BAREMO_SHEET, charts: baremoResult.charts });
  }

  workbook.activeSheet(RESULTS_SHEET);
  return { workbook, sheetCharts };
};
