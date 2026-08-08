// Hojas Excel para el diseño cuasiexperimental pretest-postest con grupos.
// Hojas: GE Pretest, GE Postest, GC Pretest, GC Postest, Consolidado,
// Comparaciones e Información. Los puntajes y niveles van con fórmulas reales
// (se recalculan al abrir en Excel), igual que el flujo correlacional.

import XlsxPopulate from "xlsx-populate";
import {
  COLOR_ALT_ROW,
  COLOR_HEADER,
  COLOR_SUBHEADER,
  FMT_2DEC,
  ST_BLOCK,
  ST_CELL,
  ST_CELL_LEFT,
  ST_HEADER,
  ST_NOTE,
  ST_STATS_LABEL,
  colLetter,
  quoteSheet,
  valoracionFormula,
  altoParaTextoAjustado,
} from "./sheet-style.js";
import { resetAxisIds } from "./ooxml.js";
import {
  computeDimensionLayout,
  computeVariableLevels,
} from "./quasi-experimental.js";

const TITLE_STYLE = { ...ST_HEADER, fontSize: 12, fill: COLOR_HEADER };
const SECTION_STYLE = { ...ST_HEADER, fill: COLOR_SUBHEADER };
const NUMBER_STYLE = { ...ST_CELL, numberFormat: FMT_2DEC };
const P_STYLE = { ...ST_CELL, numberFormat: "0.000" };

const SHEET_NAMES = {
  gePre: "GE Pretest",
  gePost: "GE Postest",
  geSeg: "GE Seguimiento",
  gcPre: "GC Pretest",
  gcPost: "GC Postest",
  gcSeg: "GC Seguimiento",
};

const DATA_START = 4;

// Distribución de columnas de las hojas de medición: Código | Grupo | Medición
// | ítems | (Puntaje, Nivel) por dimensión | Puntaje total | Nivel general |
// Cambio (Post − Pre). Idéntica en las 4 hojas para poder cruzar fórmulas.
const measurementColumns = (cfg) => {
  const itemCount = cfg.variables[0].totalItems;
  const dimensions = computeDimensionLayout(cfg);
  const firstItemCol = 4;
  const firstDimCol = firstItemCol + itemCount;
  const totalCol = firstDimCol + dimensions.length * 2;
  const levelCol = totalCol + 1;
  const changeCol = levelCol + 1;
  return {
    itemCount,
    dimensions,
    firstItemCol,
    firstDimCol,
    totalCol,
    levelCol,
    changeCol,
    lastCol: changeCol,
    dimCols: dimensions.map((_, di) => ({
      score: firstDimCol + di * 2,
      level: firstDimCol + di * 2 + 1,
    })),
  };
};

const addMeasurementSheet = ({ sheet, cfg, rows, group, moment, hasData }) => {
  const variable = cfg.variables[0];
  const inverseItems = new Set(variable.itemsInversos ?? []);
  const scaleValues = cfg.escala.map((option) => option.valor);
  const scaleSum = Math.min(...scaleValues) + Math.max(...scaleValues);
  const levels = computeVariableLevels(cfg);
  const cols = measurementColumns(cfg);
  const { itemCount, dimensions, firstItemCol, totalCol, levelCol, changeCol, lastCol } = cols;
  const isExperimental = group === "Experimental";
  const expectedRows = isExperimental
    ? cfg.cuasiexperimental.nExperimental
    : cfg.cuasiexperimental.nControl;
  // El cambio compara esta medición con la anterior: Post − Pre en las hojas
  // de pretest/postest, Seg − Post en las hojas de seguimiento.
  const isSeg = moment === "Seguimiento";
  const changeFromSheet = isExperimental
    ? (isSeg ? SHEET_NAMES.gePost : SHEET_NAMES.gePre)
    : (isSeg ? SHEET_NAMES.gcPost : SHEET_NAMES.gcPre);
  const changeToSheet = isExperimental
    ? (isSeg ? SHEET_NAMES.geSeg : SHEET_NAMES.gePost)
    : (isSeg ? SHEET_NAMES.gcSeg : SHEET_NAMES.gcPost);
  const changeHeader = isSeg ? "Cambio (Seg − Post)" : "Cambio (Post − Pre)";

  sheet.range(1, 1, 1, lastCol).merged(true).style(TITLE_STYLE);
  sheet.cell(1, 1).value(`${group} - ${moment}: ${variable.nombre}`);
  sheet.row(1).height(25);

  // Encabezados fijos (combinados filas 2-3).
  [["Código", 1], ["Grupo", 2], ["Medición", 3]].forEach(([label, col]) => {
    sheet.range(2, col, 3, col).merged(true).style(ST_HEADER);
    sheet.cell(2, col).value(label);
  });

  // Ítems agrupados bajo su dimensión.
  dimensions.forEach((dimension) => {
    const fromCol = firstItemCol + dimension.from - 1;
    const toCol = firstItemCol + dimension.to - 1;
    sheet.range(2, fromCol, 2, toCol).merged(true).style(SECTION_STYLE);
    sheet.cell(2, fromCol).value(dimension.nombre);
  });
  for (let index = 0; index < itemCount; index += 1) {
    const itemName = variable.itemNames[index]?.trim();
    const label = itemName || `P${index + 1}`;
    sheet.cell(3, firstItemCol + index)
      .value(inverseItems.has(index + 1) ? `${label} (R)` : label)
      .style(ST_HEADER);
  }

  // Puntaje y nivel por dimensión.
  dimensions.forEach((dimension, di) => {
    const { score, level } = cols.dimCols[di];
    sheet.range(2, score, 2, level).merged(true).style(SECTION_STYLE);
    sheet.cell(2, score).value(dimension.nombre);
    sheet.cell(3, score).value("Puntaje").style(ST_HEADER);
    sheet.cell(3, level).value("Nivel").style(ST_HEADER);
  });

  [["Puntaje total", totalCol], ["Nivel general", levelCol], [changeHeader, changeCol]]
    .forEach(([label, col]) => {
      sheet.range(2, col, 3, col).merged(true).style(ST_HEADER);
      sheet.cell(2, col).value(label);
    });

  const firstItemL = colLetter(firstItemCol);
  const lastItemL = colLetter(firstItemCol + itemCount - 1);
  const totalL = colLetter(totalCol);

  for (let index = 0; index < expectedRows; index += 1) {
    const excelRow = DATA_START + index;
    const source = rows?.[index] ?? null;
    sheet.cell(excelRow, 1).value(
      source?.id ?? `${isExperimental ? "GE" : "GC"}-${String(index + 1).padStart(3, "0")}`,
    );
    sheet.cell(excelRow, 2).value(group);
    sheet.cell(excelRow, 3).value(moment);

    const scores = moment === "Pretest" ? source?.pre : (isSeg ? source?.seg : source?.post);
    if (hasData && scores) {
      scores.forEach((value, scoreIndex) => sheet.cell(excelRow, firstItemCol + scoreIndex).value(value));
    }

    dimensions.forEach((dimension, di) => {
      const { score, level } = cols.dimCols[di];
      const fromL = colLetter(firstItemCol + dimension.from - 1);
      const toL = colLetter(firstItemCol + dimension.to - 1);
      const range = `${fromL}${excelRow}:${toL}${excelRow}`;
      const dimensionHasInverse = Array.from(
        { length: dimension.to - dimension.from + 1 },
        (_, offset) => dimension.from + offset,
      ).some((item) => inverseItems.has(item));
      const expression = dimensionHasInverse
        ? `SUM(${Array.from(
          { length: dimension.to - dimension.from + 1 },
          (_, offset) => dimension.from + offset,
        ).map((item) => {
          const ref = `${colLetter(firstItemCol + item - 1)}${excelRow}`;
          return inverseItems.has(item) ? `(${scaleSum}-${ref})` : ref;
        }).join(",")})`
        : `SUM(${range})`;
      sheet.cell(excelRow, score)
        .formula(`IF(COUNTA(${range})=0,"",${expression})`);
      sheet.cell(excelRow, level)
        .formula(valoracionFormula(dimension.niveles, `${colLetter(score)}${excelRow}`));
    });

    const itemsRange = `${firstItemL}${excelRow}:${lastItemL}${excelRow}`;
    const totalExpression = inverseItems.size > 0
      ? `SUM(${Array.from({ length: itemCount }, (_, index) => {
        const ref = `${colLetter(firstItemCol + index)}${excelRow}`;
        return inverseItems.has(index + 1) ? `(${scaleSum}-${ref})` : ref;
      }).join(",")})`
      : `SUM(${itemsRange})`;
    sheet.cell(excelRow, totalCol)
      .formula(`IF(COUNTA(${itemsRange})=0,"",${totalExpression})`);
    sheet.cell(excelRow, levelCol)
      .formula(valoracionFormula(levels, `${totalL}${excelRow}`));

    const fromRef = `${quoteSheet(changeFromSheet)}!${totalL}${excelRow}`;
    const toRef = `${quoteSheet(changeToSheet)}!${totalL}${excelRow}`;
    sheet.cell(excelRow, changeCol)
      .formula(`IF(OR(${fromRef}="",${toRef}=""),"",${toRef}-${fromRef})`);

    sheet.range(excelRow, 1, excelRow, lastCol).style({
      ...ST_CELL,
      fill: index % 2 === 1 ? COLOR_ALT_ROW : "FFFFFF",
    });
    sheet.cell(excelRow, 1).style({ ...ST_CELL, bold: true });
    sheet.cell(excelRow, 2).style(ST_CELL_LEFT);
    sheet.cell(excelRow, 3).style(ST_CELL_LEFT);
    dimensions.forEach((_, di) => sheet.cell(excelRow, cols.dimCols[di].level).style(ST_CELL_LEFT));
    sheet.cell(excelRow, levelCol).style(ST_CELL_LEFT);
  }

  // Baremos de referencia: variable completa y cada dimensión.
  const lastDataRow = DATA_START + expectedRows - 1;
  let row = lastDataRow + 2;
  sheet.range(row, 1, row, 4).merged(true).style(ST_BLOCK);
  sheet.cell(row, 1).value(`Baremo de la variable: ${variable.nombre}`);
  row += 1;
  ["Nivel", "Desde", "Hasta"].forEach((h, i) => sheet.cell(row, i + 1).value(h).style(ST_HEADER));
  levels.forEach((level) => {
    row += 1;
    sheet.cell(row, 1).value(level.nombre).style(ST_CELL_LEFT);
    sheet.cell(row, 2).value(level.min).style(ST_CELL);
    sheet.cell(row, 3).value(level.max).style(ST_CELL);
  });

  row += 2;
  sheet.range(row, 1, row, 4).merged(true).style(ST_BLOCK);
  sheet.cell(row, 1).value("Baremo por dimensión");
  row += 1;
  ["Dimensión", "Nivel", "Desde", "Hasta"].forEach((h, i) => sheet.cell(row, i + 1).value(h).style(ST_HEADER));
  dimensions.forEach((dimension) => {
    dimension.niveles.forEach((level, li) => {
      row += 1;
      sheet.cell(row, 1).value(li === 0 ? dimension.nombre : "").style(ST_CELL_LEFT);
      sheet.cell(row, 2).value(level.nombre).style(ST_CELL_LEFT);
      sheet.cell(row, 3).value(level.min).style(ST_CELL);
      sheet.cell(row, 4).value(level.max).style(ST_CELL);
    });
  });

  row += 2;
  sheet.range(row, 1, row, lastCol).merged(true);
  sheet.cell(row, 1)
    .value("Elaboración: TesisTab. Los puntajes, niveles y cambios se recalculan al abrir el archivo en Excel.")
    .style(ST_NOTE);

  // Anchos útiles.
  sheet.column(1).width(12);
  sheet.column(2).width(13);
  sheet.column(3).width(10);
  for (let col = firstItemCol; col < firstItemCol + itemCount; col += 1) sheet.column(col).width(8);
  cols.dimCols.forEach(({ score, level }) => {
    sheet.column(score).width(10);
    sheet.column(level).width(12);
  });
  sheet.column(totalCol).width(12);
  sheet.column(levelCol).width(14);
  sheet.column(changeCol).width(16);
  sheet.row(2).height(25);
  // La fila 3 lleva el NOMBRE COMPLETO de cada item en columnas de ancho 8. Con
  // un alto fijo de 35 los nombres largos se cortaban a media palabra en el
  // PDF (visto abriendo el archivo con LibreOffice); se calcula del texto real.
  sheet.row(3).height(altoParaTextoAjustado(
    Array.from({ length: itemCount }, (_, i) => variable.itemNames[i]?.trim() || `P${i + 1}`),
    8,
    { min: 35 },
  ));
};

// Consolidado: una fila por participante con fórmulas hacia las hojas de
// medición (si el usuario edita respuestas, el consolidado se actualiza solo).
const addConsolidatedSheet = (sheet, cfg) => {
  const cols = measurementColumns(cfg);
  const totalL = colLetter(cols.totalCol);
  const levelL = colLetter(cols.levelCol);
  const q = cfg.cuasiexperimental;
  const hasSeg = q.mediciones >= 3;
  const totalRows = q.nExperimental + q.nControl;
  const headers = [
    "Código", "Grupo", "Puntaje pretest", "Nivel pretest",
    "Puntaje postest", "Nivel postest",
    ...(hasSeg ? ["Puntaje seguimiento", "Nivel seguimiento"] : []),
    "Diferencia (Post − Pre)",
    ...(hasSeg ? ["Diferencia (Seg − Post)"] : []),
  ];

  sheet.range(1, 1, 1, headers.length).merged(true).style(TITLE_STYLE);
  sheet.cell(1, 1).value(hasSeg
    ? "Consolidado pretest-postest-seguimiento por participante"
    : "Consolidado pretest-postest por participante");
  sheet.row(1).height(25);
  headers.forEach((header, index) => sheet.cell(2, index + 1).value(header).style(ST_HEADER));
  sheet.row(2).height(30);

  const diffCol = hasSeg ? 9 : 7;
  for (let index = 0; index < totalRows; index += 1) {
    const row = index + 3;
    const isExperimental = index < q.nExperimental;
    const sourceRow = DATA_START + (isExperimental ? index : index - q.nExperimental);
    const preSheet = quoteSheet(isExperimental ? SHEET_NAMES.gePre : SHEET_NAMES.gcPre);
    const postSheet = quoteSheet(isExperimental ? SHEET_NAMES.gePost : SHEET_NAMES.gcPost);
    const segSheet = quoteSheet(isExperimental ? SHEET_NAMES.geSeg : SHEET_NAMES.gcSeg);

    sheet.cell(row, 1).formula(`${preSheet}!A${sourceRow}`);
    sheet.cell(row, 2).value(isExperimental ? "Experimental" : "Control");
    sheet.cell(row, 3).formula(`${preSheet}!${totalL}${sourceRow}`);
    sheet.cell(row, 4).formula(`${preSheet}!${levelL}${sourceRow}`);
    sheet.cell(row, 5).formula(`${postSheet}!${totalL}${sourceRow}`);
    sheet.cell(row, 6).formula(`${postSheet}!${levelL}${sourceRow}`);
    if (hasSeg) {
      sheet.cell(row, 7).formula(`${segSheet}!${totalL}${sourceRow}`);
      sheet.cell(row, 8).formula(`${segSheet}!${levelL}${sourceRow}`);
    }
    sheet.cell(row, diffCol).formula(`IF(OR(C${row}="",E${row}=""),"",E${row}-C${row})`);
    if (hasSeg) {
      sheet.cell(row, 10).formula(`IF(OR(E${row}="",G${row}=""),"",G${row}-E${row})`);
    }

    sheet.range(row, 1, row, headers.length).style({
      ...ST_CELL,
      fill: index % 2 === 1 ? COLOR_ALT_ROW : "FFFFFF",
    });
    sheet.cell(row, 2).style(ST_CELL_LEFT);
    sheet.cell(row, 4).style(ST_CELL_LEFT);
    sheet.cell(row, 6).style(ST_CELL_LEFT);
    if (hasSeg) sheet.cell(row, 8).style(ST_CELL_LEFT);
  }

  const noteRow = totalRows + 4;
  sheet.range(noteRow, 1, noteRow, headers.length).merged(true);
  sheet.cell(noteRow, 1)
    .value("Los valores provienen de las hojas de medición mediante fórmulas; se recalculan al abrir el archivo en Excel.")
    .style(ST_NOTE);

  headers.forEach((_, index) => { sheet.column(index + 1).width(index === 0 ? 14 : 16); });
};

// ── Comparaciones ────────────────────────────────────────────────────────────
const writeDescriptiveTable = (sheet, startRow, analysis) => {
  const hasSeg = Boolean(analysis.descriptive.experimentalSeg);
  const rows = [
    ["Experimental", "Pretest", analysis.descriptive.experimentalPre],
    ["Experimental", "Postest", analysis.descriptive.experimentalPost],
    ...(hasSeg ? [["Experimental", "Seguimiento", analysis.descriptive.experimentalSeg]] : []),
    ["Control", "Pretest", analysis.descriptive.controlPre],
    ["Control", "Postest", analysis.descriptive.controlPost],
    ...(hasSeg ? [["Control", "Seguimiento", analysis.descriptive.controlSeg]] : []),
    ["Experimental", "Cambio (Post − Pre)", analysis.descriptive.experimentalChange],
    ["Control", "Cambio (Post − Pre)", analysis.descriptive.controlChange],
  ];
  const headers = ["Grupo", "Medición", "n", "Media", "DE", "Mediana", "Mínimo", "Máximo"];

  sheet.range(startRow, 1, startRow, headers.length).merged(true).style(SECTION_STYLE);
  sheet.cell(startRow, 1).value("Estadísticos descriptivos");
  headers.forEach((header, index) => sheet.cell(startRow + 1, index + 1).value(header).style(ST_HEADER));
  rows.forEach(([group, moment, stats], index) => {
    const row = startRow + 2 + index;
    const values = [group, moment, stats.n, stats.mean, stats.sd, stats.median, stats.min, stats.max];
    values.forEach((value, colIndex) => sheet.cell(row, colIndex + 1).value(value));
    sheet.range(row, 1, row, headers.length).style(index % 2 ? { ...ST_CELL, fill: COLOR_ALT_ROW } : ST_CELL);
    sheet.cell(row, 1).style(ST_CELL_LEFT);
    sheet.cell(row, 2).style(ST_CELL_LEFT);
    sheet.range(row, 4, row, 8).style(NUMBER_STYLE);
  });
  return startRow + 2 + rows.length;
};

// Mini tabla de medias que alimenta el gráfico de barras del análisis.
const writeMeansBlock = (sheet, startRow, analysis) => {
  const hasSeg = Boolean(analysis.descriptive.experimentalSeg);
  const entries = [
    ["GE Pretest", analysis.descriptive.experimentalPre.mean],
    ["GE Postest", analysis.descriptive.experimentalPost.mean],
    ...(hasSeg ? [["GE Seguimiento", analysis.descriptive.experimentalSeg.mean]] : []),
    ["GC Pretest", analysis.descriptive.controlPre.mean],
    ["GC Postest", analysis.descriptive.controlPost.mean],
    ...(hasSeg ? [["GC Seguimiento", analysis.descriptive.controlSeg.mean]] : []),
  ];
  sheet.range(startRow, 1, startRow, 2).merged(true).style(SECTION_STYLE);
  sheet.cell(startRow, 1).value("Medias por grupo y medición");
  entries.forEach(([label, mean], index) => {
    const row = startRow + 1 + index;
    sheet.cell(row, 1).value(label).style(ST_STATS_LABEL);
    sheet.cell(row, 2).value(mean).style(NUMBER_STYLE);
  });
  const sheetRef = quoteSheet(sheet.name());
  const chart = {
    title: `Medias de ${analysis.variable}: mediciones por grupo`,
    seriesName: "Media",
    catRef: `${sheetRef}!$A$${startRow + 1}:$A$${startRow + entries.length}`,
    valRef: `${sheetRef}!$B$${startRow + 1}:$B$${startRow + entries.length}`,
    numFmt: FMT_2DEC,
    varyColors: true,
    points: entries.length,
    preview: {
      categories: entries.map(([label]) => label),
      values: entries.map(([, mean]) => mean ?? 0),
    },
    anchor: {
      fromCol: 3,
      fromRow: startRow - 1,
      toCol: 3 + 7,
      toRow: startRow - 1 + 14,
    },
  };
  return { endRow: Math.max(startRow + entries.length + 1, startRow - 1 + 15), chart };
};

// Todas las pruebas de normalidad usadas, sin duplicados (los grupos del
// postest/seguimiento aparecen en más de una comparación independiente).
const allNormalityRows = (analysis) => {
  const seen = new Set();
  const rows = [];
  [analysis.primaryEffect, analysis.ancova, analysis.baseline, ...analysis.comparisons]
    .filter(Boolean)
    .forEach((comparison) => {
    comparison.normality.forEach((result) => {
      if (seen.has(result.target)) return;
      seen.add(result.target);
      rows.push(result);
    });
  });
  return rows;
};

const writeNormalityTable = (sheet, startRow, analysis) => {
  const headers = ["Datos evaluados", "Prueba", "Estadístico", "Sig.", "Decisión"];
  sheet.range(startRow, 1, startRow, headers.length).merged(true).style(SECTION_STYLE);
  sheet.cell(startRow, 1).value(`Pruebas de normalidad (α = ${analysis.alpha})`);
  headers.forEach((header, index) => sheet.cell(startRow + 1, index + 1).value(header).style(ST_HEADER));
  const rows = allNormalityRows(analysis);
  rows.forEach((result, index) => {
    const row = startRow + 2 + index;
    const values = [
      result.target,
      result.method,
      result.statistic,
      result.p,
      result.normal ? "Distribución normal" : "Distribución no normal",
    ];
    values.forEach((value, colIndex) => sheet.cell(row, colIndex + 1).value(value));
    sheet.range(row, 1, row, headers.length).style(index % 2 ? { ...ST_CELL, fill: COLOR_ALT_ROW } : ST_CELL);
    sheet.range(row, 1, row, 2).style(ST_CELL_LEFT);
    sheet.cell(row, 3).style(NUMBER_STYLE);
    sheet.cell(row, 4).style(P_STYLE);
    sheet.cell(row, 5).style(ST_CELL_LEFT);
  });
  sheet.cell(startRow + 2 + rows.length, 1)
    .value("En las comparaciones relacionadas se evalúa la normalidad de las diferencias postest − pretest, no la de cada medición por separado.")
    .style(ST_NOTE);
  sheet.range(startRow + 2 + rows.length, 1, startRow + 2 + rows.length, headers.length).merged(true);
  return startRow + 3 + rows.length;
};

const statisticLabel = (comparison) => {
  if (comparison.statisticLabel) return comparison.statisticLabel;
  if (comparison.test === "wilcoxon") return "W";
  if (comparison.test === "mann_whitney") return "U";
  return "t";
};

const effectLabel = (comparison) => {
  if (comparison.effectMeasure) return comparison.effectMeasure;
  if (comparison.test === "t_pareada") return "dᶻ de Cohen";
  if (comparison.test === "t_independiente_welch") return "d de Cohen";
  return "Correlación biserial por rangos";
};

const formatNumber = (value, decimals = 3) => (
  typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(decimals)) : "—"
);

const writeSummaryTable = (sheet, startRow, analysis) => {
  const headers = ["Comparación", "Prueba seleccionada", "Est.", "Valor", "gl", "Sig. bilateral", "Tamaño del efecto", "Decisión"];
  sheet.range(startRow, 1, startRow, headers.length).merged(true).style(SECTION_STYLE);
  sheet.cell(startRow, 1).value(`Contraste de hipótesis (α = ${analysis.alpha})`);
  headers.forEach((header, index) => sheet.cell(startRow + 1, index + 1).value(header).style(ST_HEADER));

  const rows = [analysis.primaryEffect, analysis.ancova, analysis.baseline, ...analysis.comparisons].filter(Boolean);
  rows.forEach((comparison, index) => {
    const row = startRow + 2 + index;
    const values = [
      comparison.name,
      comparison.testLabel,
      statisticLabel(comparison),
      formatNumber(comparison.statistic),
      typeof comparison.df === "number" ? formatNumber(comparison.df, 2) : "—",
      formatNumber(comparison.p),
      formatNumber(comparison.effectSize),
      comparison.decision,
    ];
    values.forEach((value, colIndex) => sheet.cell(row, colIndex + 1).value(value));
    sheet.range(row, 1, row, headers.length).style(index % 2 ? { ...ST_CELL, fill: COLOR_ALT_ROW } : ST_CELL);
    sheet.cell(row, 1).style(ST_CELL_LEFT);
    sheet.cell(row, 2).style(ST_CELL_LEFT);
    sheet.cell(row, 6).style(P_STYLE);
    sheet.cell(row, 8).style(ST_CELL_LEFT);
  });
  return startRow + 2 + rows.length;
};

// Ficha completa por comparación: hipótesis, normalidad usada, prueba
// seleccionada, decisión, tamaño del efecto e interpretación narrativa.
const writeComparisonDetail = (sheet, startRow, comparison, index) => {
  const width = 8;
  let row = startRow;
  sheet.range(row, 1, row, width).merged(true).style(ST_BLOCK);
  sheet.cell(row, 1).value(`Comparación ${index + 1}: ${comparison.name}`);
  row += 1;

  const normalitySummary = comparison.normality
    .map((n) => `${n.target}: ${n.method}${n.statistic === null ? "" : ` = ${formatNumber(n.statistic)}`}, Sig. = ${n.p === null ? "—" : formatNumber(n.p)} → ${n.normal ? "normal" : "no normal"}`)
    .join(" | ");

  const entries = [
    ["Hipótesis nula (H₀)", comparison.hypotheses.nula],
    ["Hipótesis alterna (H₁)", comparison.hypotheses.alterna],
    ["Prueba de normalidad", normalitySummary],
    ["Prueba estadística seleccionada", comparison.selectedByNormality === "adjusted_model"
      ? `${comparison.testLabel} (modelo ajustado por el valor pretest)`
      : `${comparison.testLabel} (${comparison.selectedByNormality === "parametric" ? "datos con distribución normal" : "datos sin distribución normal"})`],
    [`Estadístico de prueba (${statisticLabel(comparison)})`, formatNumber(comparison.statistic)],
    ["Grados de libertad (gl)", typeof comparison.df === "number" ? formatNumber(comparison.df, 2) : "No aplica"],
    ["Valor p (bilateral)", formatNumber(comparison.p)],
    ["Nivel de significancia (α)", comparison.alpha],
    ["Decisión", comparison.decision],
    [`Tamaño del efecto (${effectLabel(comparison)})`, `${formatNumber(comparison.effectSize)} (${comparison.effectMagnitude})`],
    ["Intervalo de confianza", Array.isArray(comparison.confidenceInterval)
      ? `${Math.round((comparison.confidenceLevel ?? 0.95) * 100)}%: [${formatNumber(comparison.confidenceInterval[0])}, ${formatNumber(comparison.confidenceInterval[1])}]`
      : "No estimable"],
    ["Interpretación", comparison.interpretation],
  ];

  entries.forEach(([label, value]) => {
    sheet.cell(row, 1).value(label).style({ ...ST_STATS_LABEL, wrapText: true, verticalAlignment: "top" });
    sheet.range(row, 1, row, 2).merged(true);
    sheet.range(row, 3, row, width).merged(true).style({
      ...ST_CELL_LEFT,
      wrapText: true,
      verticalAlignment: "top",
    });
    sheet.cell(row, 3).value(value);
    const isLong = typeof value === "string" && value.length > 90;
    sheet.row(row).height(isLong ? 42 : 20);
    row += 1;
  });
  return row + 1;
};

const addComparisonsSheet = (sheet, cfg, data) => {
  sheet.range(1, 1, 1, 8).merged(true).style(TITLE_STYLE);
  sheet.cell(1, 1).value("Análisis cuasiexperimental: pretest-postest con grupo experimental y control");
  sheet.row(1).height(28);

  if (!data?.analysis) {
    sheet.range(3, 1, 6, 8).merged(true).style({ ...ST_CELL_LEFT, wrapText: true, verticalAlignment: "top" });
    sheet.cell(3, 1).value(
      "La plantilla fue generada sin registros. Ingresa los puntajes en las hojas de medición y vuelve a generar el archivo para calcular automáticamente normalidad, pruebas de hipótesis e interpretaciones.",
    );
    return [];
  }

  let row = 3;
  row = writeDescriptiveTable(sheet, row, data.analysis) + 2;
  const means = writeMeansBlock(sheet, row, data.analysis);
  row = means.endRow + 2;
  row = writeNormalityTable(sheet, row, data.analysis) + 2;
  row = writeSummaryTable(sheet, row, data.analysis) + 2;

  const details = [
    data.analysis.primaryEffect,
    data.analysis.ancova,
    data.analysis.baseline,
    ...data.analysis.comparisons,
  ].filter(Boolean);
  details.forEach((comparison, index) => {
    row = writeComparisonDetail(sheet, row, comparison, index);
  });

  sheet.range(row, 1, row, 8).merged(true);
  sheet.cell(row, 1)
    .value("Criterio de selección: prueba paramétrica cuando la normalidad requerida presenta Sig. ≥ α (en pares, sobre las diferencias post − pre); en caso contrario, su alternativa no paramétrica.")
    .style(ST_NOTE);

  [30, 14, 12, 13, 10, 15, 18, 14].forEach((width, index) => { sheet.column(index + 1).width(width); });
  return [means.chart];
};

const addInformationSheet = (sheet, cfg, data) => {
  const q = cfg.cuasiexperimental;
  const dimensions = computeDimensionLayout(cfg);
  sheet.range(1, 1, 1, 4).merged(true).style(TITLE_STYLE);
  sheet.cell(1, 1).value("Información del diseño cuasiexperimental");
  sheet.row(1).height(25);

  const escala = cfg.escala.map((o) => `${o.valor} = ${o.etiqueta}`).join(" | ");
  const rows = [
    ["Título", cfg.titulo || "No especificado"],
    ["Investigador(a)", cfg.investigador || "No especificado"],
    ["Diseño", "Cuasiexperimental: pretest-postest con grupo experimental y grupo control"],
    ["Mediciones", q.mediciones >= 3 ? "3 (Pretest, Postest y Seguimiento)" : "2 (Pretest y Postest)"],
    ["Variable dependiente", cfg.variables[0].nombre],
    ["Dimensiones", dimensions.map((d) => `${d.nombre} (${d.items} ítems)`).join("; ")],
    ["Total de ítems", cfg.variables[0].totalItems],
    ["Escala de respuesta", escala],
    ["Grupo experimental (n)", q.nExperimental],
    ["Grupo control (n)", q.nControl],
    ["Muestra total", q.nExperimental + q.nControl],
    ["Nivel de significancia (α)", q.alpha],
    ["Efecto configurado", `${q.efectoEtiqueta} (dirección: ${q.direccionEtiqueta})`],
    // "Activado" a secas no informaba de nada. Lo que hay detrás es una
    // aproximación por intentos: se simulan varias muestras y se conserva la
    // que más se acerca al patrón pedido. Quien lea el archivo tiene que poder
    // saberlo sin leer el código.
    ["Control del patrón de resultados", q.controlarResultados
      ? "Activado — se evalúan varias bases y se conserva la que mejor se aproxima al patrón solicitado."
      : "Desactivado — se genera una sola base, sin selección adicional."],
    ["Datos incluidos", cfg.conDatos ? "Sí, base completa" : "No, plantilla vacía"],
  ];
  rows.forEach(([label, value], index) => {
    const row = index + 3;
    sheet.cell(row, 1).value(label).style(ST_STATS_LABEL);
    sheet.range(row, 2, row, 4).merged(true).style({ ...ST_CELL_LEFT, wrapText: true });
    sheet.cell(row, 2).value(value);
  });

  let row = rows.length + 5;
  sheet.range(row, 1, row, 4).merged(true).style(ST_BLOCK);
  sheet.cell(row, 1).value("Pruebas incluidas");
  const notes = [
    "Efecto principal: comparación del cambio postest − pretest entre grupos (t de Welch o U de Mann-Whitney, según normalidad).",
    "Comparación inicial: puntajes pretest entre grupos. Un resultado no significativo no demuestra equivalencia.",
    "Pretest vs. postest del grupo experimental: t pareada o Wilcoxon, según la normalidad de las diferencias post − pre.",
    "Pretest vs. postest del grupo control: t pareada o Wilcoxon, según la normalidad de las diferencias post − pre.",
    "Postest experimental vs. control: t de Welch o U de Mann-Whitney, según la normalidad de ambos grupos.",
    ...(q.mediciones >= 3 ? [
      "Postest vs. seguimiento de cada grupo: t pareada o Wilcoxon, según la normalidad de las diferencias seg − post (evalúa la persistencia del efecto).",
      "Seguimiento experimental vs. control: t de Welch o U de Mann-Whitney, según la normalidad de ambos grupos.",
    ] : []),
  ];
  notes.forEach((note, index) => {
    sheet.range(row + 1 + index, 1, row + 1 + index, 4).merged(true).style({ ...ST_CELL_LEFT, wrapText: true });
    sheet.cell(row + 1 + index, 1).value(`• ${note}`);
    sheet.row(row + 1 + index).height(28);
  });
  row += notes.length + 1;

  if (data?.warnings?.length) {
    row += 2;
    sheet.range(row, 1, row, 4).merged(true).style(ST_BLOCK);
    sheet.cell(row, 1).value("Advertencias de generación");
    data.warnings.forEach((warning, index) => {
      sheet.range(row + 1 + index, 1, row + 1 + index, 4).merged(true).style({ ...ST_CELL_LEFT, wrapText: true });
      sheet.cell(row + 1 + index, 1).value(`• ${warning}`);
    });
  }

  sheet.column(1).width(28);
  sheet.column(2).width(40);
  sheet.column(3).width(24);
  sheet.column(4).width(24);
};

export const buildQuasiExperimentalWorkbook = async (cfg, data) => {
  resetAxisIds(); // ids de ejes deterministas por archivo
  const hasSeg = cfg.cuasiexperimental.mediciones >= 3;
  const workbook = await XlsxPopulate.fromBlankAsync();
  const gePre = workbook.sheet(0).name(SHEET_NAMES.gePre);
  const gePost = workbook.addSheet(SHEET_NAMES.gePost);
  const geSeg = hasSeg ? workbook.addSheet(SHEET_NAMES.geSeg) : null;
  const gcPre = workbook.addSheet(SHEET_NAMES.gcPre);
  const gcPost = workbook.addSheet(SHEET_NAMES.gcPost);
  const gcSeg = hasSeg ? workbook.addSheet(SHEET_NAMES.gcSeg) : null;
  const consolidated = workbook.addSheet("Consolidado");
  const comparisons = workbook.addSheet("Comparaciones");
  const information = workbook.addSheet("Información");

  const hasData = Boolean(data);
  addMeasurementSheet({ sheet: gePre, cfg, rows: data?.experimental, group: "Experimental", moment: "Pretest", hasData });
  addMeasurementSheet({ sheet: gePost, cfg, rows: data?.experimental, group: "Experimental", moment: "Postest", hasData });
  if (geSeg) addMeasurementSheet({ sheet: geSeg, cfg, rows: data?.experimental, group: "Experimental", moment: "Seguimiento", hasData });
  addMeasurementSheet({ sheet: gcPre, cfg, rows: data?.control, group: "Control", moment: "Pretest", hasData });
  addMeasurementSheet({ sheet: gcPost, cfg, rows: data?.control, group: "Control", moment: "Postest", hasData });
  if (gcSeg) addMeasurementSheet({ sheet: gcSeg, cfg, rows: data?.control, group: "Control", moment: "Seguimiento", hasData });
  addConsolidatedSheet(consolidated, cfg);
  const comparisonCharts = addComparisonsSheet(comparisons, cfg, data);
  addInformationSheet(information, cfg, data);

  const sheetCharts = comparisonCharts.length > 0
    ? [{ sheetName: comparisons.name(), charts: comparisonCharts }]
    : [];
  return { workbook, sheetCharts };
};
