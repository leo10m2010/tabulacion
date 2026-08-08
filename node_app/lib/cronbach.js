// Prueba de confiabilidad (Alfa de Cronbach): normalizacion de la
// configuracion, simulacion de respuestas con alta consistencia interna y
// construccion del Excel de una sola hoja con las formulas vivas
// (VARP, COUNT y el alfa calculado en celda, no valores pegados).
//
// La prueba se hace por variable: recibe el nombre de la variable, sus
// dimensiones con la cantidad de items y el N de encuestados, y genera datos
// simulados donde cada encuestado responde de forma consistente entre items
// (poca variacion intra-sujeto, variacion normal entre sujetos) para que el
// alfa caiga en el nivel elegido.
import XlsxPopulate from "xlsx-populate";
import crypto from "node:crypto";
import { MAX_ITEMS_POR_VARIABLE, MAX_MUESTRA, toInt } from "./config.js";
import { createNormalRandom, createRandom, normalizeSeed } from "./random.js";
import { colLetter } from "./sheet-style.js";
import { postProcessWorkbook } from "./ooxml.js";

// Niveles de alfa que el usuario puede pedir a la simulacion. Los rangos
// siguen la escala de George y Mallery (2003); "excelente" no llega a 1.0
// para que los datos no sean identicos (alfa perfecto es sospechoso).
export const NIVELES_ALFA = {
  excelente: { etiqueta: "Excelente", min: 0.9, max: 0.97 },
  bueno: { etiqueta: "Bueno", min: 0.8, max: 0.89 },
  aceptable: { etiqueta: "Aceptable", min: 0.7, max: 0.79 },
};

const LIKERT5 = ["Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre"];

export const normalizeCronbachConfig = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Debes enviar una configuracion valida (objeto JSON).");
  }
  const warnings = [];

  const encuestados = toInt(raw.encuestados ?? raw.muestra, 0);
  if (encuestados < 5) {
    throw new Error("La prueba de confiabilidad necesita al menos 5 encuestados.");
  }
  if (encuestados > MAX_MUESTRA) {
    throw new Error(`La muestra maxima soportada es ${MAX_MUESTRA} (configuraste ${encuestados}).`);
  }

  const opciones = toInt(raw.respuesta ?? raw.opciones, 5);
  if (opciones < 2 || opciones > 10) {
    throw new Error("La escala de respuesta debe tener entre 2 y 10 opciones.");
  }
  const labels = Array.isArray(raw.nombre_respuesta) ? raw.nombre_respuesta.map(String) : [];
  const escala = Array.from({ length: opciones }, (_, i) => ({
    valor: i + 1,
    etiqueta: labels[i]?.trim() || (opciones === 5 ? LIKERT5[i] : `Opción ${i + 1}`),
  }));

  const dimsRaw = Array.isArray(raw.dimensiones) ? raw.dimensiones : [];
  let dimensiones = dimsRaw
    .map((d, i) => ({
      nombre: String(d?.nombre ?? "").trim() || `Dimensión ${i + 1}`,
      items: toInt(d?.items, 0),
    }))
    .filter((d) => d.items > 0);
  if (dimensiones.length === 0) {
    const fallbackItems = toInt(raw.items ?? raw.item, 0);
    if (fallbackItems > 0) {
      dimensiones = [{ nombre: "Dimensión única", items: fallbackItems }];
    }
  }
  const totalItems = dimensiones.reduce((acc, d) => acc + d.items, 0);
  if (totalItems < 2) {
    throw new Error("La prueba necesita al menos 2 items (define las dimensiones y sus items).");
  }
  if (totalItems > MAX_ITEMS_POR_VARIABLE) {
    throw new Error(
      `El sistema soporta como maximo ${MAX_ITEMS_POR_VARIABLE} items por variable (configuraste ${totalItems}).`,
    );
  }

  const nivelRaw = String(raw.nivelAlfa ?? "excelente").trim().toLowerCase();
  if (nivelRaw && !NIVELES_ALFA[nivelRaw]) {
    warnings.push(`El nivel de alfa "${nivelRaw}" no existe; se uso "excelente".`);
  }

  return {
    warnings,
    variable: String(raw.variable ?? raw.nombre_variable ?? "").trim() || "Variable",
    etiquetaMuestra: String(raw.nommuestra ?? raw.etiquetaMuestra ?? "").trim() || "Encuestado",
    encuestados,
    escala,
    dimensiones,
    totalItems,
    nivelAlfa: NIVELES_ALFA[nivelRaw] ? nivelRaw : "excelente",
    seed: normalizeSeed(raw.seed ?? raw.semilla),
  };
};

// Alfa de Cronbach con varianza poblacional (VARP), igual que las formulas de
// la hoja: alfa = (K/(K-1)) * (1 - suma(Si^2)/St^2).
export const computeCronbachAlpha = (matrix) => {
  const k = matrix[0].length;
  const varp = (values) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  };
  let sumItemVar = 0;
  for (let j = 0; j < k; j += 1) {
    sumItemVar += varp(matrix.map((row) => row[j]));
  }
  const totalVar = varp(matrix.map((row) => row.reduce((a, b) => a + b, 0)));
  if (totalVar === 0) return Number.NaN;
  return (k / (k - 1)) * (1 - sumItemVar / totalVar);
};

// Simulacion adaptativa: rasgo latente por encuestado (variacion normal entre
// sujetos) + sesgo leve por item + ruido intra-sujeto. El ruido se ajusta
// hasta que el alfa cae en el rango del nivel pedido.
export const generateCronbachData = (cfg) => {
  const random = createRandom(cfg.seed);
  const normal = createNormalRandom(random);
  const nivel = NIVELES_ALFA[cfg.nivelAlfa];
  const escalaMin = 1;
  const escalaMax = cfg.escala.length;
  const centro = (escalaMin + escalaMax) / 2;
  const spread = (escalaMax - escalaMin) / 4;
  const clampRound = (v) => Math.min(escalaMax, Math.max(escalaMin, Math.round(v)));

  const buildMatrix = (noise) => {
    const biases = Array.from({ length: cfg.totalItems }, () => (random() - 0.5) * 0.5);
    return Array.from({ length: cfg.encuestados }, () => {
      const trait = centro + normal() * spread * 1.1;
      return biases.map((b) => clampRound(trait + b + normal() * noise));
    });
  };

  let noise = { excelente: 0.55, bueno: 1.0, aceptable: 1.35 }[cfg.nivelAlfa];
  let best = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const matrix = buildMatrix(noise);
    const alpha = computeCronbachAlpha(matrix);
    if (!Number.isFinite(alpha)) continue;
    const dist = alpha < nivel.min ? nivel.min - alpha : alpha > nivel.max ? alpha - nivel.max : 0;
    if (!best || dist < best.dist) best = { matrix, alpha, dist };
    if (dist === 0) break;
    if (alpha > nivel.max) noise *= 1.2;
    else noise *= 0.85;
  }
  if (!best) {
    throw new Error("No se pudo simular una base con varianza suficiente; intenta con mas encuestados.");
  }
  return { matrix: best.matrix, alpha: best.alpha, cumple: best.dist === 0 };
};

// ── Hoja "Alfa de Cronbach" ──────────────────────────────────────────────────
// Estilo propio de la prueba (Calibri, titulo azul marino, subtitulo celeste,
// bandas alternadas, varianzas en naranja claro y panel de resultados en
// tarjetas), distinto del formato Arial de las hojas de tabulacion.
const NAVY = "1F3864";
const BLUE_MED = "2F5597";
const CELESTE = "BDD7EE";
const CELESTE_SOFT = "DDEBF7";
const ALT_ROW = "F2F2F2";
const ORANGE_SOFT = "FCE4D6";

const FONT_C = { fontFamily: "Calibri", fontSize: 11 };
const ST_TITLE = {
  ...FONT_C, fontSize: 14, bold: true, fontColor: "FFFFFF", fill: NAVY,
  horizontalAlignment: "center", verticalAlignment: "center",
};
const ST_SUBTITLE = {
  ...FONT_C, bold: true, fontColor: NAVY, fill: CELESTE,
  horizontalAlignment: "center", verticalAlignment: "center",
};
const ST_HEAD = {
  ...FONT_C, bold: true, fontColor: "FFFFFF", fill: NAVY, border: true,
  horizontalAlignment: "center", verticalAlignment: "center", wrapText: true,
};
const ST_HEAD_MED = { ...ST_HEAD, fill: BLUE_MED };
const ST_DATA = { ...FONT_C, border: true, horizontalAlignment: "center" };
const ST_DATA_LEFT = { ...FONT_C, border: true, horizontalAlignment: "left" };
const ST_SUMA = { ...ST_DATA, bold: true, fill: CELESTE_SOFT };
const ST_VARIANZA = { ...ST_DATA, bold: true, fill: ORANGE_SOFT, numberFormat: "0.000" };
const ST_CARD_LABEL = { ...ST_HEAD, fill: BLUE_MED, fontSize: 10 };
const ST_CARD_VALUE = {
  ...FONT_C, fontSize: 18, bold: true, fontColor: NAVY, border: true,
  horizontalAlignment: "center", verticalAlignment: "center",
};
const ST_NOTE_C = { ...FONT_C, fontSize: 9, italic: true };

// Escala de interpretacion (George y Mallery, 2003) con semaforo de colores.
const ESCALA_INTERPRETACION = [
  ["α ≥ 0.90", "Excelente", "63BE7B"],
  ["0.80 ≤ α < 0.90", "Bueno", "A9D08E"],
  ["0.70 ≤ α < 0.80", "Aceptable", "FFE699"],
  ["0.60 ≤ α < 0.70", "Cuestionable", "FFD966"],
  ["0.50 ≤ α < 0.60", "Pobre", "F4B084"],
  ["α < 0.50", "Inaceptable", "FF7C80"],
];

export const buildCronbachWorkbook = async (cfg, matrix) => {
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet(0).name("Alfa de Cronbach");
  sheet.gridLinesVisible(false);

  const N = cfg.encuestados;
  const K = cfg.totalItems;
  const firstItemCol = 2;
  const lastItemCol = firstItemCol + K - 1;
  const sumaCol = lastItemCol + 1;
  const firstL = colLetter(firstItemCol);
  const lastL = colLetter(lastItemCol);
  const sumaL = colLetter(sumaCol);

  // Titulo (azul marino) y subtitulo (celeste).
  sheet.range(1, 1, 1, sumaCol).merged(true).style(ST_TITLE);
  sheet.cell(1, 1).value("ANÁLISIS DE CONFIABILIDAD — ALFA DE CRONBACH");
  sheet.row(1).height(26);
  sheet.range(2, 1, 2, sumaCol).merged(true).style(ST_SUBTITLE);
  sheet.cell(2, 1).value(
    `Variable: ${cfg.variable}  ·  ${N} encuestados  ·  ${K} ítems  ·  Escala Likert 1–${cfg.escala.length}`,
  );
  sheet.row(2).height(18);

  // Encabezado de la tabla: dimensiones (fila 4) e items (fila 5) + SUMA.
  sheet.range(4, 1, 5, 1).merged(true).style(ST_HEAD);
  sheet.cell(4, 1).value("N°");
  sheet.range(4, sumaCol, 5, sumaCol).merged(true).style(ST_HEAD);
  sheet.cell(4, sumaCol).value("SUMA");
  let col = firstItemCol;
  let itemNumber = 1;
  cfg.dimensiones.forEach((dim) => {
    sheet.range(4, col, 4, col + dim.items - 1).merged(true).style(ST_HEAD_MED);
    sheet.cell(4, col).value(dim.nombre);
    for (let k = 0; k < dim.items; k += 1) {
      sheet.cell(5, col).value(`P${itemNumber}`).style(ST_HEAD);
      itemNumber += 1;
      col += 1;
    }
  });
  sheet.row(4).height(24);
  sheet.freezePanes(1, 5); // encabezados congelados (columna N° y filas 1-5)

  // Datos: bandas alternadas gris/blanco y columna SUMA resaltada.
  const dataStart = 6;
  const dataEnd = dataStart + N - 1;
  for (let i = 0; i < N; i += 1) {
    const r = dataStart + i;
    const alt = i % 2 === 1 ? { fill: ALT_ROW } : {};
    sheet.cell(r, 1).value(i + 1).style({ ...ST_DATA, ...alt });
    for (let j = 0; j < K; j += 1) {
      sheet.cell(r, firstItemCol + j).value(matrix[i][j]).style({ ...ST_DATA, ...alt });
    }
    sheet.cell(r, sumaCol).style(ST_SUMA).formula(`SUM(${firstL}${r}:${lastL}${r})`);
  }

  // Fila de varianza por item (VARP); bajo SUMA queda St².
  const varRow = dataEnd + 1;
  sheet.cell(varRow, 1).value("VARIANZA (Si²)").style({ ...ST_DATA_LEFT, bold: true, fill: ORANGE_SOFT });
  for (let j = 0; j < K; j += 1) {
    const L = colLetter(firstItemCol + j);
    sheet.cell(varRow, firstItemCol + j).style(ST_VARIANZA)
      .formula(`VARP(${L}${dataStart}:${L}${dataEnd})`);
  }
  sheet.cell(varRow, sumaCol).style(ST_VARIANZA)
    .formula(`VARP(${sumaL}${dataStart}:${sumaL}${dataEnd})`);

  // Leyenda de la escala Likert, a la derecha de la tabla de datos.
  const legendCol = sumaCol + 2;
  sheet.range(4, legendCol, 4, legendCol + 1).merged(true).style(ST_HEAD);
  sheet.cell(4, legendCol).value("ESCALA LIKERT");
  cfg.escala.forEach((opt, i) => {
    sheet.cell(5 + i, legendCol).value(opt.valor).style(ST_DATA);
    sheet.cell(5 + i, legendCol + 1).value(opt.etiqueta).style(ST_DATA_LEFT);
  });

  // Panel de resultados en tarjetas grandes centradas. K se calcula con
  // COUNT sobre la fila de varianzas (nunca un numero fijo).
  const panelTop = varRow + 2;
  sheet.range(panelTop, 2, panelTop, 13).merged(true).style({ ...ST_HEAD, fontSize: 12 });
  sheet.cell(panelTop, 2).value("RESULTADOS DEL ANÁLISIS DE FIABILIDAD");
  sheet.row(panelTop).height(22);
  const labelRow = panelTop + 1;
  const valueRow = panelTop + 2;
  sheet.row(valueRow).height(34);
  const cards = [
    { col: 2, label: "K (N° de ítems)", formula: `COUNT(${firstL}${varRow}:${lastL}${varRow})`, fmt: "0" },
    { col: 5, label: "ΣSi² (suma de varianzas)", formula: `SUM(${firstL}${varRow}:${lastL}${varRow})`, fmt: "0.000" },
    { col: 8, label: "St² (varianza del total)", formula: `${sumaL}${varRow}`, fmt: "0.000" },
    { col: 11, label: "α de Cronbach", formula: `(B${valueRow}/(B${valueRow}-1))*(1-(E${valueRow}/H${valueRow}))`, fmt: "0.000" },
  ];
  cards.forEach((card) => {
    sheet.range(labelRow, card.col, labelRow, card.col + 2).merged(true).style(ST_CARD_LABEL);
    sheet.cell(labelRow, card.col).value(card.label);
    sheet.range(valueRow, card.col, valueRow, card.col + 2).merged(true)
      .style({ ...ST_CARD_VALUE, numberFormat: card.fmt });
    sheet.cell(valueRow, card.col).formula(card.formula);
  });
  // La tarjeta del alfa se resalta (es el resultado principal).
  sheet.range(valueRow, 11, valueRow, 13).style({ fill: "E2EFDA", fontSize: 20 });
  const alphaRef = `$K$${valueRow}`;

  // Interpretacion automatica con SI anidado (nunca texto fijo).
  const interpRow = valueRow + 2;
  sheet.range(interpRow, 2, interpRow + 1, 13).merged(true)
    .style({ ...FONT_C, italic: true, wrapText: true, verticalAlignment: "center", horizontalAlignment: "left", border: true });
  sheet.cell(interpRow, 2).formula(
    `"El coeficiente Alfa de Cronbach del instrumento es α = "&TEXT(${alphaRef},"0.000")`
    + `&", que corresponde a una confiabilidad "`
    + `&IF(${alphaRef}>=0.9,"EXCELENTE",IF(${alphaRef}>=0.8,"BUENA",IF(${alphaRef}>=0.7,"ACEPTABLE",`
    + `IF(${alphaRef}>=0.6,"CUESTIONABLE",IF(${alphaRef}>=0.5,"POBRE","INACEPTABLE")))))`
    + `&" según la escala de George y Mallery (2003)."`,
  );

  // Escala de interpretacion con semaforo de colores.
  const escTop = interpRow + 3;
  sheet.range(escTop, 2, escTop, 5).merged(true).style(ST_HEAD);
  sheet.cell(escTop, 2).value("ESCALA DE INTERPRETACIÓN DE CONFIABILIDAD");
  sheet.cell(escTop + 1, 2).value("Rango de α").style(ST_HEAD_MED);
  sheet.range(escTop + 1, 3, escTop + 1, 5).merged(true).style(ST_HEAD_MED);
  sheet.cell(escTop + 1, 3).value("Interpretación");
  ESCALA_INTERPRETACION.forEach(([rango, texto, color], i) => {
    const r = escTop + 2 + i;
    sheet.cell(r, 2).value(rango).style({ ...ST_DATA, fill: color });
    sheet.range(r, 3, r, 5).merged(true).style({ ...ST_DATA_LEFT, bold: true, fill: color });
    sheet.cell(r, 3).value(texto);
  });
  const notaRow = escTop + 2 + ESCALA_INTERPRETACION.length;
  sheet.cell(notaRow, 2).value("Fuente: George y Mallery (2003).").style(ST_NOTE_C);
  // Anchos de columna: N° ancho para "VARIANZA (Si²)", items compactos.
  sheet.column("A").width(16);
  for (let c = firstItemCol; c <= lastItemCol; c += 1) sheet.column(colLetter(c)).width(6.5);
  sheet.column(sumaL).width(10);
  sheet.column(colLetter(legendCol)).width(7);
  sheet.column(colLetter(legendCol + 1)).width(20);

  return workbook;
};

// Orquestador: normaliza, simula, construye la hoja y devuelve el buffer con
// los estilos deduplicados (mismo post-procesado que el generador principal).
export const generateCronbach = async (rawConfig) => {
  const cfg = normalizeCronbachConfig(rawConfig);
  if (!cfg.seed) cfg.seed = crypto.randomBytes(16).toString("hex");
  const warnings = [...cfg.warnings];
  const { matrix, alpha, cumple } = generateCronbachData(cfg);
  if (!cumple) {
    warnings.push(
      `El alfa obtenido (${alpha.toFixed(3)}) quedo fuera del rango del nivel elegido; se entrego la mejor aproximacion.`,
    );
  }

  const workbook = await buildCronbachWorkbook(cfg, matrix);
  const plainBuffer = await workbook.outputAsync({ type: "nodebuffer" });
  const excelBuffer = await postProcessWorkbook(plainBuffer, []);

  const nivel = NIVELES_ALFA[cfg.nivelAlfa];
  return {
    alpha,
    cumple,
    nivel: cfg.nivelAlfa,
    etiqueta: nivel.etiqueta,
    esperadoMin: nivel.min,
    esperadoMax: nivel.max,
    K: cfg.totalItems,
    encuestados: cfg.encuestados,
    variable: cfg.variable,
    seed: cfg.seed,
    warnings,
    excelBuffer,
  };
};
