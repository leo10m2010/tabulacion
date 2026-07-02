// Construccion de las hojas del workbook.
//
// Hojas generadas por variable:
//   1. "[Variable]"              base de datos + estadisticos + frecuencias por escala
//   2. "Ítems [Variable]"        tabla frec/% + grafico + Figura + interpretacion por item
//   3. "Dimensiones [Variable]"  tabla ancha Suma/Nivel/Codigo por dimension y
//                                consolidado (sin repetir la base), ficha de baremo,
//                                frecuencia baremada, grafico e interpretacion por dimension
//   4. "Conteo [Variable]"       respuestas agregadas por dimension + grafico + interpretacion
// Mas "Relaciones" (normalidad calculada sobre V1 total, V2 total y las
// dimensiones de V1; correlaciones Pearson o Rho de Spearman segun los Sig.:
// general V1-V2 y cada dimension de V1 contra V2), "Correlación" (r/rho vivo
// + criterio) e "Información".
import XlsxPopulate from "xlsx-populate";
import {
  COLOR_ALT_ROW,
  COLOR_STATS,
  FMT_2DEC,
  FMT_PCT,
  FMT_PCT_NUM,
  FONT,
  ST_BLOCK,
  ST_CELL,
  ST_CELL_LEFT,
  ST_HEADER,
  ST_LABEL_BOLD,
  ST_NOTE,
  ST_STATS_LABEL,
  ST_STATS_VALUE,
  ST_SUBHEADER,
  codigoFormula,
  colLetter,
  computeNiveles,
  countByValue,
  paintFrame,
  quoteSheet,
  sanitizeSheetName,
  valoracionFormula,
  writeFuente,
  writeNarrative,
} from "./sheet-style.js";
import {
  narrativeConteo,
  narrativeDimension,
  narrativeItem,
  narrativeNormalidadAuto,
  narrativeNormalidadManual,
} from "./narratives.js";
import {
  lillieforsTest,
  shapiroWilkTest,
  sumPerRow,
  sumRangePerRow,
} from "./stats.js";
import { resetAxisIds } from "./ooxml.js";

// ── Hoja base de variable ────────────────────────────────────────────────────
const addVariableSheet = (sheet, cfg, variable, varIndex, firstItemNumber, base) => {
  const N = cfg.encuestados;
  const escala = cfg.escala;
  const dataStart = 5;
  const dataEnd = dataStart + N - 1;

  const dims = [];
  let col = 2;
  let itemNumber = firstItemNumber;
  let itemIndexInVar = 0;
  variable.dimensiones.forEach((dim) => {
    const dimStartCol = col;
    const indicadores = dim.indicadores.map((ind) => {
      const indStartCol = col;
      const items = [];
      for (let k = 0; k < ind.items; k += 1) {
        itemIndexInVar += 1;
        items.push({ code: `P${itemNumber}`, col, indexInVar: itemIndexInVar });
        itemNumber += 1;
        col += 1;
      }
      return { nombre: ind.nombre, startCol: indStartCol, endCol: col - 1, items };
    });
    dims.push({ nombre: dim.nombre, startCol: dimStartCol, endCol: col - 1, indicadores });
  });
  const lastCol = col - 1;
  const totalCol = lastCol + 1;
  const valCol = lastCol + 2;
  const escalaMin = Math.min(...escala.map((o) => o.valor));
  const escalaMax = Math.max(...escala.map((o) => o.valor));
  const nivelesVar = variable.baremoVariable
    ?? computeNiveles(lastCol - 1, escalaMin, escalaMax, variable.niveles);

  // Filas 1-4: variable, dimensiones, indicadores, codigos de item y
  // columnas Total / Valoracion por encuestado.
  sheet.range(1, 1, 1, valCol).merged(true).style({ ...ST_HEADER, fontSize: 12 });
  sheet.cell(1, 1).value(`Variable ${varIndex + 1}: ${variable.nombre}`);
  sheet.row(1).height(22);
  sheet.range(2, 1, 4, 1).merged(true).style(ST_HEADER);
  sheet.cell(2, 1).value("ID");
  sheet.range(2, totalCol, 4, totalCol).merged(true).style(ST_HEADER);
  sheet.cell(2, totalCol).value("Total");
  sheet.range(2, valCol, 4, valCol).merged(true).style(ST_HEADER);
  sheet.cell(2, valCol).value("Valoración");
  dims.forEach((dim) => {
    sheet.range(2, dim.startCol, 2, dim.endCol).merged(true).style(ST_HEADER);
    sheet.cell(2, dim.startCol).value(dim.nombre);
    dim.indicadores.forEach((ind) => {
      sheet.range(3, ind.startCol, 3, ind.endCol).merged(true).style(ST_SUBHEADER);
      sheet.cell(3, ind.startCol).value(ind.nombre);
      ind.items.forEach((item) => {
        sheet.cell(4, item.col).value(item.code).style(ST_HEADER);
      });
    });
  });
  sheet.row(2).height(28);
  sheet.row(3).height(28);

  // Base de datos: IDs 1..N; con datos simulados o vacia para ingreso manual.
  // Total y Valoracion por encuestado (baremo de la variable completa).
  const flatItems = dims.flatMap((d) => d.indicadores.flatMap((ind) => ind.items));
  const firstItemL = colLetter(2);
  const lastItemL = colLetter(lastCol);
  const totalL = colLetter(totalCol);
  for (let i = 0; i < N; i += 1) {
    const r = dataStart + i;
    const alt = i % 2 === 1 ? { fill: COLOR_ALT_ROW } : {};
    sheet.cell(r, 1).value(i + 1).style({ ...ST_CELL, ...alt });
    sheet.range(r, 2, r, lastCol).style({ ...ST_CELL, ...alt });
    if (base) {
      flatItems.forEach((item) => {
        sheet.cell(r, item.col).value(base[`V${varIndex + 1}_${item.indexInVar}`][i]);
      });
    }
    sheet.cell(r, totalCol).style({ ...ST_CELL, ...alt, bold: true })
      .formula(`IF(COUNT(${firstItemL}${r}:${lastItemL}${r})=0,"",SUM(${firstItemL}${r}:${lastItemL}${r}))`);
    sheet.cell(r, valCol).style({ ...ST_CELL, ...alt })
      .formula(valoracionFormula(nivelesVar, `${totalL}${r}`));
  }

  // Estadisticos por item.
  const statsStart = dataEnd + 1;
  const statsRows = [
    { label: "TOTAL", fn: (rg) => `SUM(${rg})` },
    { label: "MODA", fn: (rg) => `IFERROR(_xlfn.MODE.SNGL(${rg}),"")` },
    { label: "MEDIA", fn: (rg) => `IFERROR(AVERAGE(${rg}),"")`, fmt: FMT_2DEC },
    { label: "MEDIANA", fn: (rg) => `IFERROR(MEDIAN(${rg}),"")` },
    { label: "DESVIACIÓN ESTÁNDAR", fn: (rg) => `IFERROR(_xlfn.STDEV.S(${rg}),"")`, fmt: FMT_2DEC },
    { label: "COEFICIENTE DE VARIACIÓN", fn: (rg) => `IFERROR(_xlfn.STDEV.S(${rg})/AVERAGE(${rg})*100,"")`, fmt: FMT_PCT_NUM },
  ];
  statsRows.forEach((spec, i) => {
    const r = statsStart + i;
    sheet.cell(r, 1).value(spec.label).style(ST_STATS_LABEL);
    for (let c = 2; c <= lastCol; c += 1) {
      const L = colLetter(c);
      const rg = `${L}${dataStart}:${L}${dataEnd}`;
      const cell = sheet.cell(r, c).style(ST_STATS_VALUE);
      if (spec.fmt) cell.style("numberFormat", spec.fmt);
      cell.formula(spec.fn(rg));
    }
  });

  // Frecuencias absolutas por escala.
  const freqTitleRow = statsStart + statsRows.length + 1;
  sheet.range(freqTitleRow, 1, freqTitleRow, lastCol).merged(true).style(ST_HEADER);
  sheet.cell(freqTitleRow, 1).value("FRECUENCIAS ABSOLUTAS POR ESCALA");
  const freqStart = freqTitleRow + 1;
  escala.forEach((opt, i) => {
    const r = freqStart + i;
    sheet.cell(r, 1).value(`${opt.valor} = ${opt.etiqueta}`).style(ST_CELL_LEFT);
    for (let c = 2; c <= lastCol; c += 1) {
      const L = colLetter(c);
      sheet.cell(r, c).style(ST_CELL).formula(`COUNTIF(${L}${dataStart}:${L}${dataEnd},${opt.valor})`);
    }
  });
  const freqTotalRow = freqStart + escala.length;
  sheet.cell(freqTotalRow, 1).value("Total").style(ST_STATS_LABEL);
  for (let c = 2; c <= lastCol; c += 1) {
    const L = colLetter(c);
    sheet.cell(freqTotalRow, c).style(ST_STATS_VALUE)
      .formula(`SUM(${L}${freqStart}:${L}${freqTotalRow - 1})`);
  }

  // Porcentajes por escala.
  const pctTitleRow = freqTotalRow + 2;
  sheet.range(pctTitleRow, 1, pctTitleRow, lastCol).merged(true).style(ST_HEADER);
  sheet.cell(pctTitleRow, 1).value("PORCENTAJES POR ESCALA (%)");
  const pctStart = pctTitleRow + 1;
  escala.forEach((opt, i) => {
    const r = pctStart + i;
    sheet.cell(r, 1).value(`${opt.valor} = ${opt.etiqueta}`).style(ST_CELL_LEFT);
    for (let c = 2; c <= lastCol; c += 1) {
      const L = colLetter(c);
      sheet.cell(r, c).style({ ...ST_CELL, numberFormat: FMT_2DEC })
        .formula(`${L}${freqStart + i}/${N}*100`);
    }
  });
  const pctTotalRow = pctStart + escala.length;
  sheet.cell(pctTotalRow, 1).value("Total %").style(ST_STATS_LABEL);
  for (let c = 2; c <= lastCol; c += 1) {
    const L = colLetter(c);
    sheet.cell(pctTotalRow, c).style({ ...ST_STATS_VALUE, numberFormat: FMT_2DEC })
      .formula(`SUM(${L}${pctStart}:${L}${pctTotalRow - 1})`);
  }

  sheet.column("A").width(28);
  for (let c = 2; c <= lastCol; c += 1) sheet.column(colLetter(c)).width(9);
  sheet.column(totalL).width(12);
  sheet.column(colLetter(valCol)).width(14);

  return {
    dims, dataStart, dataEnd, lastCol, freqStart, nextItemNumber: itemNumber,
  };
};

// ── Hoja de tabulacion por item ──────────────────────────────────────────────
const addItemsSheet = (sheet, cfg, variable, baseInfo, baseSheetName, base, varIndex) => {
  const N = cfg.encuestados;
  const escala = cfg.escala;
  const baseRef = quoteSheet(baseSheetName);
  const sheetRef = quoteSheet(sheet.name());
  const C0 = 2; // col B: la A es el marco
  const charts = [];
  const CHART_H = 14;
  const CHART_W = 6;
  let row = 2;
  let tabla = 0;

  const flatItems = baseInfo.dims.flatMap((d) => d.indicadores.flatMap((ind) => ind.items));
  flatItems.forEach((item) => {
    tabla += 1;
    const texto = String(variable.itemNames[item.indexInVar - 1] ?? "").trim();

    sheet.range(row, C0, row, C0 + 3).merged(true).style(ST_BLOCK);
    sheet.cell(row, C0).value(`Ítem ${item.code.slice(1)}`);
    row += 1;
    sheet.cell(row, C0).value(`Tabla ${tabla}`).style(ST_LABEL_BOLD);
    sheet.cell(row + 1, C0).value(texto || item.code).style(FONT);
    row += 2;

    // Tabla de frecuencias del item, referenciando la hoja base.
    sheet.cell(row, C0).value("").style(ST_HEADER);
    sheet.cell(row, C0 + 1).value("Frec.").style(ST_HEADER);
    sheet.cell(row, C0 + 2).value("%").style(ST_HEADER);
    const tStart = row + 1;
    const L = colLetter(item.col);
    escala.forEach((opt, i) => {
      const r = tStart + i;
      sheet.cell(r, C0).value(opt.etiqueta).style(ST_CELL_LEFT);
      sheet.cell(r, C0 + 1).style(ST_CELL).formula(`${baseRef}!${L}${baseInfo.freqStart + i}`);
      sheet.cell(r, C0 + 2).style({ ...ST_CELL, numberFormat: FMT_PCT })
        .formula(`${colLetter(C0 + 1)}${r}/${N}`);
    });
    const tTotal = tStart + escala.length;
    sheet.cell(tTotal, C0).value("Total").style(ST_STATS_LABEL);
    sheet.cell(tTotal, C0 + 1).style(ST_STATS_VALUE)
      .formula(`SUM(${colLetter(C0 + 1)}${tStart}:${colLetter(C0 + 1)}${tTotal - 1})`);
    sheet.cell(tTotal, C0 + 2).style({ ...ST_STATS_VALUE, numberFormat: FMT_PCT })
      .formula(`SUM(${colLetter(C0 + 2)}${tStart}:${colLetter(C0 + 2)}${tTotal - 1})`);
    row = writeFuente(sheet, tTotal + 1, C0) + 1;

    // Grafico del item (proporciones, como el original).
    const counts = base ? countByValue(base[`V${varIndex + 1}_${item.indexInVar}`], escala) : null;
    const chartTop = row;
    charts.push({
      title: item.code,
      seriesName: "%",
      catRef: `${sheetRef}!$${colLetter(C0)}$${tStart}:$${colLetter(C0)}$${tTotal - 1}`,
      valRef: `${sheetRef}!$${colLetter(C0 + 2)}$${tStart}:$${colLetter(C0 + 2)}$${tTotal - 1}`,
      numFmt: FMT_PCT,
      varyColors: false,
      points: escala.length,
      preview: counts
        ? { categories: escala.map((o) => o.etiqueta), values: counts.map((c) => c / N) }
        : null,
      anchor: {
        fromCol: C0 - 1,
        fromRow: chartTop - 1,
        toCol: C0 - 1 + CHART_W,
        toRow: chartTop - 1 + CHART_H,
      },
    });
    row = chartTop + CHART_H + 1;

    sheet.cell(row, C0).value(`Figura ${tabla}`).style(ST_LABEL_BOLD);
    sheet.cell(row + 1, C0).value(texto || item.code).style(FONT);
    row += 3;

    row = writeNarrative(sheet, row, C0, 7, 5, narrativeItem(cfg, tabla, item.code, texto, counts)) + 2;
  });

  sheet.column("B").width(30);
  ["C", "D", "E", "F", "G", "H"].forEach((c) => sheet.column(c).width(13));
  paintFrame(sheet, row, C0 + 8);
  return { charts };
};

// ── Hoja de conteo por dimension ─────────────────────────────────────────────
const addConteoSheet = (sheet, cfg, variable, baseInfo, baseSheetName, base, varIndex) => {
  const N = cfg.encuestados;
  const escala = cfg.escala;
  const baseRef = quoteSheet(baseSheetName);
  const sheetRef = quoteSheet(sheet.name());
  const C0 = 2;
  const charts = [];
  const CHART_H = 14;
  const CHART_W = 6;
  let row = 2;
  let tabla = 0;

  baseInfo.dims.forEach((dim) => {
    tabla += 1;
    const items = dim.indicadores.flatMap((ind) => ind.items);
    const nItems = items.length;
    const totalResp = N * nItems;
    const rangeRef = `${baseRef}!${colLetter(dim.startCol)}${baseInfo.dataStart}:${colLetter(dim.endCol)}${baseInfo.dataEnd}`;

    sheet.range(row, C0, row, C0 + 3).merged(true).style(ST_BLOCK);
    sheet.cell(row, C0).value(`Dimensión ${tabla}: ${dim.nombre}`);
    row += 1;
    sheet.cell(row, C0).value(`Tabla ${tabla}`).style(ST_LABEL_BOLD);
    sheet.cell(row + 1, C0).value(dim.nombre).style(FONT);
    row += 2;

    sheet.cell(row, C0).value("").style(ST_HEADER);
    sheet.cell(row, C0 + 1).value("Frec.").style(ST_HEADER);
    sheet.cell(row, C0 + 2).value("%").style(ST_HEADER);
    const tStart = row + 1;
    escala.forEach((opt, i) => {
      const r = tStart + i;
      sheet.cell(r, C0).value(opt.etiqueta).style(ST_CELL_LEFT);
      sheet.cell(r, C0 + 1).style(ST_CELL).formula(`COUNTIF(${rangeRef},${opt.valor})`);
      sheet.cell(r, C0 + 2).style({ ...ST_CELL, numberFormat: FMT_PCT })
        .formula(`${colLetter(C0 + 1)}${r}/${totalResp}`);
    });
    const tTotal = tStart + escala.length;
    sheet.cell(tTotal, C0).value("Total").style(ST_STATS_LABEL);
    sheet.cell(tTotal, C0 + 1).style(ST_STATS_VALUE)
      .formula(`SUM(${colLetter(C0 + 1)}${tStart}:${colLetter(C0 + 1)}${tTotal - 1})`);
    sheet.cell(tTotal, C0 + 2).style({ ...ST_STATS_VALUE, numberFormat: FMT_PCT })
      .formula(`SUM(${colLetter(C0 + 2)}${tStart}:${colLetter(C0 + 2)}${tTotal - 1})`);
    row = writeFuente(sheet, tTotal + 1, C0) + 1;

    let counts = null;
    if (base) {
      counts = escala.map(() => 0);
      items.forEach((item) => {
        countByValue(base[`V${varIndex + 1}_${item.indexInVar}`], escala)
          .forEach((c, i) => { counts[i] += c; });
      });
    }

    const chartTop = row;
    charts.push({
      title: dim.nombre,
      seriesName: "%",
      catRef: `${sheetRef}!$${colLetter(C0)}$${tStart}:$${colLetter(C0)}$${tTotal - 1}`,
      valRef: `${sheetRef}!$${colLetter(C0 + 2)}$${tStart}:$${colLetter(C0 + 2)}$${tTotal - 1}`,
      numFmt: FMT_PCT,
      varyColors: false,
      points: escala.length,
      preview: counts
        ? { categories: escala.map((o) => o.etiqueta), values: counts.map((c) => c / totalResp) }
        : null,
      anchor: {
        fromCol: C0 - 1,
        fromRow: chartTop - 1,
        toCol: C0 - 1 + CHART_W,
        toRow: chartTop - 1 + CHART_H,
      },
    });
    row = chartTop + CHART_H + 1;

    sheet.cell(row, C0).value(`Figura ${tabla}`).style(ST_LABEL_BOLD);
    sheet.cell(row + 1, C0).value(dim.nombre).style(FONT);
    row += 3;

    row = writeNarrative(sheet, row, C0, 7, 5, narrativeConteo(cfg, tabla, dim.nombre, nItems, counts)) + 2;
  });

  sheet.column("B").width(30);
  ["C", "D", "E", "F", "G", "H"].forEach((c) => sheet.column(c).width(13));
  paintFrame(sheet, row, C0 + 8);
  return { charts };
};

// ── Hoja de dimensiones (baremos / valoracion) ───────────────────────────────
const buildBaremoBlock = (sheet, ctx) => {
  const {
    cfg, titulo, variableName, dimensionName, nItems, niveles, nivelRange, startRow,
    tablaN, nivelCounts,
  } = ctx;
  const N = cfg.encuestados;
  const escalaMin = Math.min(...cfg.escala.map((o) => o.valor));
  const escalaMax = Math.max(...cfg.escala.map((o) => o.valor));
  const pMin = nItems * escalaMin;
  const pMax = nItems * escalaMax;
  const C0 = 2; // col B: la A es el marco
  const blockCols = 10;
  let row = startRow;

  sheet.range(row, C0, row, C0 + blockCols - 1).merged(true).style({ ...ST_HEADER, fontSize: 11 });
  sheet.cell(row, C0).value(titulo);
  row += 1;

  // Ficha de baremo (B:C) y tabla de niveles (E:H).
  const fichaHeaderRow = row;
  sheet.cell(row, C0).value("Campo").style(ST_HEADER);
  sheet.cell(row, C0 + 1).value("Valor").style(ST_HEADER);
  const amplitud = (pMax - pMin) / niveles.length;
  const ficha = [
    ["Variable", variableName],
    ["Dimensión", dimensionName],
    ["Cantidad de escalas valorativas", cfg.escala.length],
    ["N.° de preguntas", nItems],
    ["Valor mínimo por ítem", escalaMin],
    ["Valor máximo por ítem", escalaMax],
    ["Puntaje mínimo", pMin],
    ["Puntaje máximo", pMax],
    ["Rango", pMax - pMin],
    ["Cantidad de niveles", niveles.length],
    ["Amplitud del intervalo", Number.isInteger(amplitud) ? amplitud : Number(amplitud.toFixed(2))],
  ];
  ficha.forEach(([campo, valor], i) => {
    sheet.cell(fichaHeaderRow + 1 + i, C0).value(campo).style(ST_CELL_LEFT);
    sheet.cell(fichaHeaderRow + 1 + i, C0 + 1).value(valor).style(ST_CELL);
  });
  ["Nivel", "Rango mínimo", "Rango máximo", "Valoración"].forEach((h, i) => {
    sheet.cell(fichaHeaderRow, C0 + 3 + i).value(h).style(ST_HEADER);
  });
  niveles.forEach((nivel, i) => {
    const r = fichaHeaderRow + 1 + i;
    sheet.cell(r, C0 + 3).value(`Nivel ${i + 1}`).style(ST_CELL);
    sheet.cell(r, C0 + 4).value(nivel.min).style(ST_CELL);
    sheet.cell(r, C0 + 5).value(nivel.max).style(ST_CELL);
    sheet.cell(r, C0 + 6).value(nivel.nombre).style(ST_CELL);
  });
  row = fichaHeaderRow + ficha.length + 2;

  // Tabla de frecuencia baremada (Calificacion | Desde | Hasta | f | %):
  // cuenta la columna Nivel de la tabla resumen (la base no se repite aqui).
  let r2 = row;
  sheet.cell(r2, C0).value(`Tabla ${tablaN}`).style(ST_LABEL_BOLD);
  sheet.cell(r2 + 1, C0).value(dimensionName).style(FONT);
  r2 += 2;
  const fbHeaderRow = r2;
  ["Calificación", "Desde", "Hasta", "f", "%"].forEach((h, i) => {
    sheet.cell(fbHeaderRow, C0 + i).value(h).style(ST_HEADER);
  });
  const fL = colLetter(C0 + 3);
  niveles.forEach((nivel, i) => {
    const r = fbHeaderRow + 1 + i;
    sheet.cell(r, C0).value(nivel.nombre).style(ST_CELL_LEFT);
    sheet.cell(r, C0 + 1).value(nivel.min).style(ST_CELL);
    sheet.cell(r, C0 + 2).value(nivel.max).style(ST_CELL);
    sheet.cell(r, C0 + 3).style(ST_CELL)
      .formula(`COUNTIF(${nivelRange},"${nivel.nombre}")`);
    sheet.cell(r, C0 + 4).style({ ...ST_CELL, numberFormat: FMT_PCT })
      .formula(`${fL}${r}/${N}`);
  });
  const fbTotalRow = fbHeaderRow + 1 + niveles.length;
  sheet.cell(fbTotalRow, C0).value("Total").style(ST_STATS_LABEL);
  sheet.range(fbTotalRow, C0 + 1, fbTotalRow, C0 + 2).style(ST_STATS_VALUE);
  sheet.cell(fbTotalRow, C0 + 3).style(ST_STATS_VALUE)
    .formula(`SUM(${fL}${fbHeaderRow + 1}:${fL}${fbTotalRow - 1})`);
  sheet.cell(fbTotalRow, C0 + 4).style({ ...ST_STATS_VALUE, numberFormat: FMT_PCT })
    .formula(`SUM(${colLetter(C0 + 4)}${fbHeaderRow + 1}:${colLetter(C0 + 4)}${fbTotalRow - 1})`);
  const fuenteEnd = writeFuente(sheet, fbTotalRow + 1, C0);

  // Grafico al costado derecho de la tabla baremada.
  const sheetRef = quoteSheet(sheet.name());
  const CHART_H = 14;
  const chart = {
    title: dimensionName,
    seriesName: "%",
    catRef: `${sheetRef}!$${colLetter(C0)}$${fbHeaderRow + 1}:$${colLetter(C0)}$${fbTotalRow - 1}`,
    valRef: `${sheetRef}!$${colLetter(C0 + 4)}$${fbHeaderRow + 1}:$${colLetter(C0 + 4)}$${fbTotalRow - 1}`,
    numFmt: FMT_PCT,
    varyColors: true,
    points: niveles.length,
    preview: nivelCounts
      ? { categories: niveles.map((n) => n.nombre), values: nivelCounts.map((c) => c / N) }
      : null,
    anchor: {
      fromCol: C0 + 5,
      fromRow: fbHeaderRow - 1,
      toCol: C0 + 5 + 6,
      toRow: fbHeaderRow - 1 + CHART_H,
    },
  };

  let r3 = Math.max(fuenteEnd, fbHeaderRow + CHART_H) + 1;
  sheet.cell(r3, C0).value(`Figura ${tablaN}`).style(ST_LABEL_BOLD);
  sheet.cell(r3 + 1, C0).value(dimensionName).style(FONT);
  r3 += 3;
  r3 = writeNarrative(
    sheet, r3, C0, 9, 5,
    narrativeDimension(cfg, tablaN, variableName, dimensionName, nivelCounts, niveles),
  );

  return { endRow: r3 + 2, chart };
};

const classifyCounts = (base, varIndex, items, niveles, N) => {
  if (!base) return null;
  const counts = niveles.map(() => 0);
  for (let i = 0; i < N; i += 1) {
    let sum = 0;
    items.forEach((item) => { sum += base[`V${varIndex + 1}_${item.indexInVar}`][i]; });
    let idx = niveles.length - 1;
    for (let k = 0; k < niveles.length; k += 1) {
      if (sum <= niveles[k].max) { idx = k; break; }
    }
    counts[idx] += 1;
  }
  return counts;
};

const addDimensionesSheet = (sheet, cfg, variable, baseInfo, baseSheetName, base, varIndex) => {
  const baseRef = quoteSheet(baseSheetName);
  const N = cfg.encuestados;
  const escalaMin = Math.min(...cfg.escala.map((o) => o.valor));
  const escalaMax = Math.max(...cfg.escala.map((o) => o.valor));
  const charts = [];
  const C0 = 2; // col B: la A es el marco

  // La base de datos vive solo en la hoja base: aqui una unica tabla ancha con
  // 3 columnas por dimension (Suma referenciando la hoja base, Nivel y Codigo
  // 1..n segun el baremo) mas el consolidado de la variable.
  const allItems = baseInfo.dims.flatMap((d) => d.indicadores.flatMap((ind) => ind.items));
  const nivelesVar = variable.baremoVariable
    ?? computeNiveles(allItems.length, escalaMin, escalaMax, variable.niveles);
  const totalL = colLetter(baseInfo.lastCol + 1);
  const groups = baseInfo.dims.map((dim) => {
    const items = dim.indicadores.flatMap((ind) => ind.items);
    return {
      nombre: dim.nombre,
      items,
      niveles: computeNiveles(items.length, escalaMin, escalaMax, variable.niveles),
      startCol: dim.startCol,
      endCol: dim.endCol,
    };
  });
  const gVar = { nombre: `${variable.nombre} (consolidado)`, items: allItems, niveles: nivelesVar, total: true };
  const groupsAll = [...groups, gVar];
  const wideCols = 1 + groupsAll.length * 3;

  sheet.range(2, C0, 2, C0 + wideCols - 1).merged(true).style({ ...ST_HEADER, fontSize: 11 });
  sheet.cell(2, C0).value("SUMA, NIVEL Y CÓDIGO POR DIMENSIÓN");
  const gHeaderRow = 3;
  const subHeaderRow = 4;
  sheet.cell(gHeaderRow, C0).value("").style(ST_HEADER);
  sheet.cell(subHeaderRow, C0).value("ID").style(ST_HEADER);
  const dStart = subHeaderRow + 1;
  const dEnd = dStart + N - 1;
  groupsAll.forEach((g, j) => {
    const c = C0 + 1 + j * 3;
    g.sumaCol = c;
    g.sumaL = colLetter(c);
    g.nivelL = colLetter(c + 1);
    sheet.range(gHeaderRow, c, gHeaderRow, c + 2).merged(true).style(ST_HEADER);
    sheet.cell(gHeaderRow, c).value(g.nombre);
    ["Suma", "Nivel", "Código"].forEach((h, k) => {
      sheet.cell(subHeaderRow, c + k).value(h).style(ST_HEADER);
    });
  });
  for (let i = 0; i < N; i += 1) {
    const r = dStart + i;
    const baseRow = baseInfo.dataStart + i;
    const alt = i % 2 === 1 ? { fill: COLOR_ALT_ROW } : {};
    sheet.cell(r, C0).value(i + 1).style({ ...ST_CELL, ...alt });
    groupsAll.forEach((g) => {
      const sumaRef = `${g.sumaL}${r}`;
      const f = g.total
        ? `IF(${baseRef}!${totalL}${baseRow}="","",${baseRef}!${totalL}${baseRow})`
        : `IF(COUNT(${baseRef}!${colLetter(g.startCol)}${baseRow}:${colLetter(g.endCol)}${baseRow})=0,"",`
          + `SUM(${baseRef}!${colLetter(g.startCol)}${baseRow}:${colLetter(g.endCol)}${baseRow}))`;
      sheet.cell(r, g.sumaCol).style({ ...ST_CELL, ...alt, bold: true }).formula(f);
      sheet.cell(r, g.sumaCol + 1).style({ ...ST_CELL, ...alt })
        .formula(valoracionFormula(g.niveles, sumaRef));
      sheet.cell(r, g.sumaCol + 2).style({ ...ST_CELL, ...alt })
        .formula(codigoFormula(g.niveles, sumaRef));
    });
  }

  // Bloques de presentacion: ficha de baremo + tabla baremada por dimension y
  // el consolidado de la variable, contando la columna Nivel de la tabla ancha.
  const dimSumaRefs = [];
  let row = dEnd + 2;
  let tabla = 0;
  groups.forEach((g, dimIdx) => {
    tabla += 1;
    const block = buildBaremoBlock(sheet, {
      cfg,
      titulo: `DIMENSIÓN ${dimIdx + 1}: ${g.nombre}`,
      variableName: variable.nombre,
      dimensionName: g.nombre,
      nItems: g.items.length,
      niveles: g.niveles,
      nivelRange: `${g.nivelL}$${dStart}:${g.nivelL}$${dEnd}`,
      startRow: row,
      tablaN: tabla,
      nivelCounts: classifyCounts(base, varIndex, g.items, g.niveles, N),
    });
    charts.push(block.chart);
    dimSumaRefs.push({ nombre: g.nombre, sheetName: sheet.name(), col: g.sumaL, start: dStart, end: dEnd });
    row = block.endRow;
  });

  tabla += 1;
  const block = buildBaremoBlock(sheet, {
    cfg,
    titulo: `VARIABLE (CONSOLIDADO): ${variable.nombre}`,
    variableName: variable.nombre,
    dimensionName: "Todas las dimensiones",
    nItems: allItems.length,
    niveles: nivelesVar,
    nivelRange: `${gVar.nivelL}$${dStart}:${gVar.nivelL}$${dEnd}`,
    startRow: row,
    tablaN: tabla,
    nivelCounts: classifyCounts(base, varIndex, allItems, nivelesVar, N),
  });
  charts.push({ ...block.chart, title: variable.nombre });
  row = block.endRow;

  sheet.column("B").width(30);
  const lastCol = Math.max(15, C0 + wideCols);
  for (let c = C0 + 1; c < lastCol; c += 1) sheet.column(colLetter(c)).width(13);
  paintFrame(sheet, row, lastCol);
  return {
    charts,
    dimSumaRefs,
    globalSumaRef: { sheetName: sheet.name(), col: gVar.sumaL, start: dStart, end: dEnd },
  };
};

// ── Hoja de relaciones (normalidad + correlaciones) ──────────────────────────
const addRelacionesSheet = (sheet, cfg, refsV1, refsV2, base) => {
  const N = cfg.encuestados;
  const C0 = 2;
  const v1 = cfg.variables[0];
  const v2 = cfg.variables[1];

  // Tabla por persona: sumas por dimension de V1, total V1 y total V2.
  const series = [
    ...refsV1.dimSumaRefs.map((ref) => ({ label: `D. ${ref.nombre}`, full: `Dimensión ${ref.nombre} (${v1.nombre})`, ref })),
    { label: `Total ${v1.nombre}`, full: `Variable ${v1.nombre}`, ref: refsV1.globalSumaRef },
    ...refsV2.dimSumaRefs.map((ref) => ({ label: `D. ${ref.nombre}`, full: `Dimensión ${ref.nombre} (${v2.nombre})`, ref })),
    { label: `Total ${v2.nombre}`, full: `Variable ${v2.nombre}`, ref: refsV2.globalSumaRef },
  ];

  sheet.range(2, C0, 2, C0 + series.length).merged(true).style({ ...ST_HEADER, fontSize: 12 });
  sheet.cell(2, C0).value("Relaciones entre dimensiones y variables");
  const headerRow = 4;
  sheet.cell(headerRow, C0).value("Encuestado").style(ST_HEADER);
  series.forEach((s, i) => {
    sheet.cell(headerRow, C0 + 1 + i).value(s.label).style(ST_HEADER);
  });
  const dStart = headerRow + 1;
  const dEnd = dStart + N - 1;
  for (let i = 0; i < N; i += 1) {
    const r = dStart + i;
    const alt = i % 2 === 1 ? { fill: COLOR_ALT_ROW } : {};
    sheet.cell(r, C0).value(`${cfg.etiquetaMuestra} ${i + 1}`).style({ ...ST_CELL_LEFT, ...alt });
    series.forEach((s, j) => {
      const src = `${quoteSheet(s.ref.sheetName)}!${s.ref.col}${s.ref.start + i}`;
      sheet.cell(r, C0 + 1 + j).style({ ...ST_CELL, ...alt }).formula(`IF(${src}="","",${src})`);
    });
  }
  series.forEach((s, j) => { s.localCol = colLetter(C0 + 1 + j); });

  const nDimsV1 = refsV1.dimSumaRefs.length;
  const dimsV1 = series.slice(0, nDimsV1);
  const totalV1 = series[nDimsV1];
  const totalV2 = series[series.length - 1];

  // Normalidad solo sobre el total de V1, el total de V2 y las dimensiones de
  // V1 (las dimensiones de V2 no participan). Con base simulada los valores se
  // calculan aqui; sin base la tabla queda en blanco para llenarla desde SPSS.
  const targets = [totalV1, totalV2, ...dimsV1];
  if (base) {
    let from = 1;
    dimsV1.forEach((s, i) => {
      const count = v1.dimensiones[i].indicadores.reduce((acc, ind) => acc + ind.items, 0);
      s.values = sumRangePerRow(base, 1, from, from + count - 1, N);
      from += count;
    });
    totalV1.values = sumPerRow(base, 1, v1.totalItems, N);
    totalV2.values = sumPerRow(base, 2, v2.totalItems, N);
    targets.forEach((s) => {
      s.ks = lillieforsTest(s.values);
      s.sw = shapiroWilkTest(s.values);
    });
  }

  // Decision Pearson/Spearman: Shapiro-Wilk si n <= 50, Kolmogorov-Smirnov si
  // n > 50. Todos los Sig. >= 0.05 -> Pearson; alguno < 0.05 -> Spearman.
  const useSW = N <= 50;
  const sigs = targets
    .map((s) => (useSW ? s.sw?.p : s.ks?.p))
    .filter((p) => Number.isFinite(p));
  const method = sigs.length > 0 && sigs.some((p) => p < 0.05) ? "spearman" : "pearson";
  const methodLabel = method === "spearman" ? "Rho de Spearman" : "Correlación de Pearson";

  // Pares a correlacionar: V1-V2 (general) y cada dimension de V1 contra V2.
  const pairs = [{ a: totalV1, b: totalV2 }];
  dimsV1.forEach((s) => pairs.push({ a: s, b: totalV2 }));

  // Para Spearman se agregan columnas de rangos (CORREL sobre rangos = Rho).
  const A0 = C0 + series.length + 2;
  const R0 = A0 + 9;
  const corrSeries = [totalV1, totalV2, ...dimsV1];
  if (method === "spearman") {
    sheet.range(2, R0, 2, R0 + corrSeries.length - 1).merged(true).style(ST_HEADER);
    sheet.cell(2, R0).value("Rangos (Rho de Spearman)");
    corrSeries.forEach((s, j) => {
      s.rankCol = colLetter(R0 + j);
      sheet.cell(headerRow, R0 + j).value(`Rango ${s.label}`).style(ST_HEADER);
      for (let i = 0; i < N; i += 1) {
        const r = dStart + i;
        const alt = i % 2 === 1 ? { fill: COLOR_ALT_ROW } : {};
        const cellRef = `${s.localCol}${r}`;
        sheet.cell(r, R0 + j).style({ ...ST_CELL, ...alt }).formula(
          `IF(${cellRef}="","",_xlfn.RANK.AVG(${cellRef},$${s.localCol}$${dStart}:$${s.localCol}$${dEnd},1))`,
        );
      }
    });
  }
  const corrRange = (s) => (method === "spearman"
    ? `$${s.rankCol}$${dStart}:$${s.rankCol}$${dEnd}`
    : `$${s.localCol}$${dStart}:$${s.localCol}$${dEnd}`);

  // Bloques de analisis a la derecha de la tabla por persona.
  let row = headerRow;
  let tabla = 1;

  // Tabla unica de normalidad.
  sheet.range(row, A0, row, A0 + 7).merged(true).style(ST_BLOCK);
  sheet.cell(row, A0).value(`Prueba de normalidad: ${v1.nombre}, ${v2.nombre} y dimensiones de ${v1.nombre}`);
  row += 1;
  sheet.cell(row, A0).value(`Tabla ${tabla}`).style(ST_LABEL_BOLD);
  row += 1;
  sheet.range(row, A0, row, A0 + 6).merged(true).style(ST_HEADER);
  sheet.cell(row, A0).value("Pruebas de normalidad");
  row += 1;
  sheet.cell(row, A0).value("").style(ST_HEADER);
  sheet.range(row, A0 + 1, row, A0 + 3).merged(true).style(ST_HEADER);
  sheet.cell(row, A0 + 1).value("Kolmogorov-Smirnov (a)");
  sheet.range(row, A0 + 4, row, A0 + 6).merged(true).style(ST_HEADER);
  sheet.cell(row, A0 + 4).value("Shapiro-Wilk");
  row += 1;
  ["", "Estadístico", "gl", "Sig.", "Estadístico", "gl", "Sig."].forEach((h, i) => {
    sheet.cell(row, A0 + i).value(h).style(ST_HEADER);
  });
  row += 1;
  targets.forEach((s) => {
    sheet.cell(row, A0).value(s.label).style(ST_CELL_LEFT);
    [1, 3, 4, 6].forEach((i) => sheet.cell(row, A0 + i).style({ ...ST_CELL, numberFormat: "0.000" }));
    [2, 5].forEach((i) => sheet.cell(row, A0 + i).style(ST_CELL));
    sheet.cell(row, A0 + 2).value(N);
    sheet.cell(row, A0 + 5).value(N);
    if (s.ks) {
      sheet.cell(row, A0 + 1).value(s.ks.stat);
      sheet.cell(row, A0 + 3).value(s.ks.p);
    }
    if (s.sw) {
      sheet.cell(row, A0 + 4).value(s.sw.stat);
      sheet.cell(row, A0 + 6).value(s.sw.p);
    }
    row += 1;
  });
  sheet.cell(row, A0).value("a. Corrección de significación de Lilliefors").style(ST_NOTE);
  row += 1;
  const narrativa = base
    ? narrativeNormalidadAuto(tabla, v1.nombre, v2.nombre, useSW, method)
    : narrativeNormalidadManual(tabla, v1.nombre, v2.nombre);
  row = writeNarrative(sheet, row, A0, 7, 5, narrativa) + 2;

  // Correlaciones (general y por dimension de V1) con significancia bilateral.
  pairs.forEach((pair) => {
    sheet.range(row, A0, row, A0 + 7).merged(true).style(ST_BLOCK);
    sheet.cell(row, A0).value(`${pair.a.full}  –  ${pair.b.full}`);
    row += 1;
    tabla += 1;
    sheet.cell(row, A0).value(`Tabla ${tabla}`).style(ST_LABEL_BOLD);
    row += 1;
    sheet.range(row, A0, row, A0 + 2).merged(true).style(ST_HEADER);
    sheet.cell(row, A0).value("Correlaciones");
    row += 1;
    const rCellRef = `${colLetter(A0 + 1)}${row}`;
    sheet.cell(row, A0).value(methodLabel).style(ST_CELL_LEFT);
    sheet.range(row, A0 + 1, row, A0 + 2).merged(true).style({ ...ST_CELL, numberFormat: "0.0000" });
    sheet.cell(row, A0 + 1).formula(`IFERROR(CORREL(${corrRange(pair.a)},${corrRange(pair.b)}),"")`);
    row += 1;
    sheet.cell(row, A0).value("Sig. (bilateral)").style(ST_CELL_LEFT);
    sheet.range(row, A0 + 1, row, A0 + 2).merged(true).style({ ...ST_CELL, numberFormat: "0.0000" });
    sheet.cell(row, A0 + 1).formula(
      `IF(${rCellRef}="","",IFERROR(_xlfn.T.DIST.2T(ABS(${rCellRef})*SQRT((${N}-2)/(1-${rCellRef}^2)),${N}-2),0))`,
    );
    row += 1;
    sheet.cell(row, A0).value("N").style(ST_CELL_LEFT);
    sheet.range(row, A0 + 1, row, A0 + 2).merged(true).style(ST_CELL);
    sheet.cell(row, A0 + 1).value(N);
    row += 1;
    sheet.cell(row, A0).value("**. La correlación es significativa en el nivel 0,01 (2 colas).").style(ST_NOTE);
    row += 3;
  });

  sheet.column("B").width(18);
  const lastCol = method === "spearman" ? R0 + corrSeries.length - 1 : A0 + 7;
  for (let c = C0 + 1; c <= lastCol; c += 1) sheet.column(colLetter(c)).width(14);
  paintFrame(sheet, Math.max(dEnd, row) + 1, lastCol + 2);

  return {
    method,
    v1Range: `${quoteSheet(sheet.name())}!${corrRange(totalV1)}`,
    v2Range: `${quoteSheet(sheet.name())}!${corrRange(totalV2)}`,
  };
};

// ── Hoja de correlacion (criterio para el valor r) ───────────────────────────
const CRITERIO_R = [
  ["±0.90 a ±1.00", "Correlación muy alta"],
  ["±0.70 a ±0.89", "Correlación alta"],
  ["±0.40 a ±0.69", "Correlación moderada"],
  ["±0.20 a ±0.39", "Correlación baja"],
  ["±0.01 a ±0.19", "Correlación muy baja"],
  ["0.00", "Correlación nula"],
];

const addCorrelacionSheet = (sheet, cfg, relInfo) => {
  const esSpearman = relInfo.method === "spearman";
  sheet.range(1, 1, 1, 4).merged(true).style({ ...ST_HEADER, fontSize: 12 });
  sheet.cell(1, 1).value(esSpearman
    ? "Correlación Rho de Spearman entre variables"
    : "Correlación de Pearson entre variables");
  sheet.row(1).height(22);

  const rows = [
    ["Variable 1", cfg.variables[0].nombre],
    ["Variable 2", cfg.variables[1].nombre],
    ["N (muestra)", cfg.encuestados],
  ];
  rows.forEach(([k, v], i) => {
    sheet.cell(3 + i, 1).value(k).style({ ...ST_CELL_LEFT, bold: true, fill: COLOR_STATS });
    sheet.range(3 + i, 2, 3 + i, 4).merged(true).style(ST_CELL_LEFT);
    sheet.cell(3 + i, 2).value(v);
  });

  sheet.cell(7, 1).value(esSpearman ? "Rho de Spearman" : "r de Pearson")
    .style({ ...ST_CELL_LEFT, bold: true, fill: COLOR_STATS });
  sheet.cell(7, 2).style({ ...ST_CELL, numberFormat: "0.0000" })
    .formula(`IFERROR(CORREL(${relInfo.v1Range},${relInfo.v2Range}),"")`);
  sheet.cell(8, 1).value(esSpearman ? "rho² (determinación)" : "r² (determinación)")
    .style({ ...ST_CELL_LEFT, bold: true, fill: COLOR_STATS });
  sheet.cell(8, 2).style({ ...ST_CELL, numberFormat: "0.0000" })
    .formula('IF(B7="","",B7^2)');
  sheet.cell(9, 1).value("Interpretación").style({ ...ST_CELL_LEFT, bold: true, fill: COLOR_STATS });
  sheet.cell(9, 2).style(ST_CELL).formula(
    'IF(B7="","",IF(ABS(B7)>=0.9,"Correlación muy alta",IF(ABS(B7)>=0.7,"Correlación alta",'
    + 'IF(ABS(B7)>=0.4,"Correlación moderada",IF(ABS(B7)>=0.2,"Correlación baja",'
    + 'IF(ABS(B7)>=0.01,"Correlación muy baja","Correlación nula"))))))',
  );

  sheet.range(11, 1, 11, 2).merged(true).style(ST_HEADER);
  sheet.cell(11, 1).value("Criterio para el valor de r");
  CRITERIO_R.forEach(([rango, texto], i) => {
    sheet.cell(12 + i, 1).value(rango).style(ST_CELL);
    sheet.cell(12 + i, 2).value(texto).style(ST_CELL_LEFT);
  });

  sheet.column("A").width(24);
  sheet.column("B").width(34);
  sheet.column("C").width(16);
  sheet.column("D").width(16);
};

// ── Hoja de informacion ──────────────────────────────────────────────────────
const addInfoSheet = (sheet, cfg, baseSheetNames) => {
  let row = 1;
  sheet.range(row, 1, row, 4).merged(true).style({ ...ST_HEADER, fontSize: 13 });
  sheet.cell(row, 1).value(cfg.titulo || "Instrumento de investigación");
  sheet.row(row).height(26);
  row += 2;

  const pairs = [
    ["Investigador / Institución", cfg.investigador || "—"],
    ["Muestra", cfg.etiquetaMuestra],
    ["Número de encuestados", cfg.encuestados],
    ["Variables", cfg.variables.map((v) => v.nombre).join("  |  ")],
  ];
  pairs.forEach(([k, v]) => {
    sheet.cell(row, 1).value(k).style({ ...ST_CELL_LEFT, bold: true, fill: COLOR_STATS });
    sheet.range(row, 2, row, 4).merged(true).style(ST_CELL_LEFT);
    sheet.cell(row, 2).value(v);
    row += 1;
  });
  row += 1;

  sheet.range(row, 1, row, 2).merged(true).style(ST_HEADER);
  sheet.cell(row, 1).value("Escala de valoración");
  row += 1;
  cfg.escala.forEach((opt) => {
    sheet.cell(row, 1).value(opt.valor).style(ST_CELL);
    sheet.cell(row, 2).value(opt.etiqueta).style(ST_CELL_LEFT);
    row += 1;
  });
  row += 1;

  cfg.variables.forEach((variable) => {
    sheet.range(row, 1, row, 2).merged(true).style(ST_HEADER);
    sheet.cell(row, 1).value(`Niveles de baremo — ${variable.nombre}`);
    row += 1;
    variable.niveles.forEach((nombre, i) => {
      sheet.cell(row, 1).value(`Nivel ${i + 1}`).style(ST_CELL);
      sheet.cell(row, 2).value(nombre).style(ST_CELL_LEFT);
      row += 1;
    });
    row += 1;
  });

  sheet.range(row, 1, row, 4).merged(true).style(ST_HEADER);
  sheet.cell(row, 1).value("Instrucciones");
  row += 1;
  const min = Math.min(...cfg.escala.map((o) => o.valor));
  const max = Math.max(...cfg.escala.map((o) => o.valor));
  const notes = [
    `Las respuestas (valores ${min} a ${max}) se ingresan o editan en las hojas: ${baseSheetNames.join(", ")}.`,
    "Estadísticos, frecuencias, porcentajes, baremos y gráficos se recalculan automáticamente.",
    "Las interpretaciones narrativas se redactan con los datos generados: revíselas y ajústelas a su estilo.",
    "No edite las celdas con fórmulas (estadísticos y hojas de análisis).",
  ];
  notes.forEach((t) => {
    sheet.range(row, 1, row, 4).merged(true).style({ ...FONT, horizontalAlignment: "left" });
    sheet.cell(row, 1).value(`• ${t}`);
    row += 1;
  });

  sheet.column("A").width(28);
  sheet.column("B").width(44);
  sheet.column("C").width(20);
  sheet.column("D").width(20);
};

// ── Orquestacion del workbook ────────────────────────────────────────────────
export const buildWorkbook = async (cfg, base) => {
  resetAxisIds(); // ids de ejes deterministas por archivo
  const workbook = await XlsxPopulate.fromBlankAsync();
  const usedNames = new Set();
  const sheetCharts = [];
  const baseSheetNames = [];
  const relRefs = [];
  let firstItemNumber = 1;

  const plans = cfg.variables.map((variable) => {
    const baseName = sanitizeSheetName(variable.nombre, usedNames);
    const itemsName = sanitizeSheetName(`Ítems ${variable.nombre}`, usedNames);
    const dimName = sanitizeSheetName(`Dimensiones ${variable.nombre}`, usedNames);
    const conteoName = sanitizeSheetName(`Conteo ${variable.nombre}`, usedNames);
    baseSheetNames.push(baseName);
    return { variable, baseName, itemsName, dimName, conteoName };
  });

  plans.forEach((plan, idx) => {
    const sheet = idx === 0
      ? workbook.sheet(0).name(plan.baseName)
      : workbook.addSheet(plan.baseName);
    const baseInfo = addVariableSheet(sheet, cfg, plan.variable, idx, firstItemNumber, base);
    firstItemNumber = baseInfo.nextItemNumber;

    const itemsSheet = workbook.addSheet(plan.itemsName);
    const itemsResult = addItemsSheet(itemsSheet, cfg, plan.variable, baseInfo, plan.baseName, base, idx);
    sheetCharts.push({ sheetName: plan.itemsName, charts: itemsResult.charts });

    const dimSheet = workbook.addSheet(plan.dimName);
    const dimResult = addDimensionesSheet(dimSheet, cfg, plan.variable, baseInfo, plan.baseName, base, idx);
    sheetCharts.push({ sheetName: plan.dimName, charts: dimResult.charts });
    relRefs.push(dimResult);

    const conteoSheet = workbook.addSheet(plan.conteoName);
    const conteoResult = addConteoSheet(conteoSheet, cfg, plan.variable, baseInfo, plan.baseName, base, idx);
    sheetCharts.push({ sheetName: plan.conteoName, charts: conteoResult.charts });
  });

  if (cfg.variables.length >= 2) {
    const relName = sanitizeSheetName("Relaciones", usedNames);
    const relInfo = addRelacionesSheet(workbook.addSheet(relName), cfg, relRefs[0], relRefs[1], base);
    const corrName = sanitizeSheetName("Correlación", usedNames);
    addCorrelacionSheet(workbook.addSheet(corrName), cfg, relInfo);
  }

  const infoName = sanitizeSheetName("Información", usedNames);
  addInfoSheet(workbook.addSheet(infoName), cfg, baseSheetNames);

  return { workbook, sheetCharts };
};
