// Estilos compartidos y utilidades de construccion de hojas (letras de
// columna, baremos, marcos, fuentes y narrativas).

// ── Estilos ──────────────────────────────────────────────────────────────────
export const COLOR_HEADER = "1F3864"; // azul oscuro
export const COLOR_SUBHEADER = "2F5597"; // azul medio (indicadores)
export const COLOR_STATS = "DDEBF7"; // azul muy claro
export const COLOR_ALT_ROW = "F2F2F2"; // gris claro
export const COLOR_FRAME = "6AA84F"; // marco verde de las hojas de presentacion
export const COLOR_BLOCK = "FFD966"; // amarillo de los encabezados de bloque

export const FONT = { fontFamily: "Arial", fontSize: 10 };
export const ST_HEADER = {
  ...FONT,
  bold: true,
  fontColor: "FFFFFF",
  fill: COLOR_HEADER,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  border: true,
};
export const ST_SUBHEADER = { ...ST_HEADER, fill: COLOR_SUBHEADER };
export const ST_BLOCK = {
  ...FONT,
  bold: true,
  fill: COLOR_BLOCK,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  border: true,
};
export const ST_CELL = { ...FONT, border: true, horizontalAlignment: "center" };
export const ST_CELL_LEFT = { ...FONT, border: true, horizontalAlignment: "left" };
export const ST_STATS_LABEL = { ...FONT, bold: true, fill: COLOR_STATS, border: true, horizontalAlignment: "left" };
export const ST_STATS_VALUE = { ...FONT, fill: COLOR_STATS, border: true, horizontalAlignment: "center" };
export const ST_LABEL_BOLD = { ...FONT, bold: true };
export const ST_NOTE = { ...FONT, fontSize: 9, italic: true };
export const ST_NARRATIVE = { ...FONT, wrapText: true, verticalAlignment: "top", horizontalAlignment: "left" };
export const FMT_2DEC = "0.00";
export const FMT_PCT_NUM = '0.00"%"'; // numero 0-100 mostrado con simbolo
export const FMT_PCT = "0.00%"; // proporcion 0-1 formateada como porcentaje

// ── Helpers ──────────────────────────────────────────────────────────────────
export const colLetter = (n) => {
  let s = "";
  let c = n;
  while (c > 0) {
    const r = (c - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
};

export const quoteSheet = (name) => `'${String(name).replace(/'/g, "''")}'`;

export const sanitizeSheetName = (name, used) => {
  const base = String(name).replace(/[[\]*?:/\\]/g, " ").trim().slice(0, 31) || "Hoja";
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
};

// Rangos de baremo: cortes enteros con amplitud = rango / niveles
// (p.ej. 9 items, escala 1-5, 3 niveles => 9-20 / 21-32 / 33-45).
export const computeNiveles = (nItems, escalaMin, escalaMax, nombresNiveles) => {
  const pMin = nItems * escalaMin;
  const pMax = nItems * escalaMax;
  const amplitud = (pMax - pMin) / nombresNiveles.length;
  let lower = pMin;
  return nombresNiveles.map((nombre, i) => {
    const upper = i === nombresNiveles.length - 1
      ? pMax
      : pMin + Math.round(amplitud * (i + 1)) - 1;
    const nivel = { nombre, min: lower, max: upper };
    lower = upper + 1;
    return nivel;
  });
};

// IF anidado que clasifica un puntaje segun los niveles del baremo.
export const valoracionFormula = (niveles, ref) => {
  let f = `"${niveles[niveles.length - 1].nombre}"`;
  for (let i = niveles.length - 2; i >= 0; i -= 1) {
    f = `IF(${ref}<=${niveles[i].max},"${niveles[i].nombre}",${f})`;
  }
  return `IF(${ref}="","",${f})`;
};

// Codigo numerico del nivel (1, 2, 3, ...) segun la suma alcanzada.
export const codigoFormula = (niveles, ref) => {
  let f = `${niveles.length}`;
  for (let i = niveles.length - 2; i >= 0; i -= 1) {
    f = `IF(${ref}<=${niveles[i].max},${i + 1},${f})`;
  }
  return `IF(${ref}="","",${f})`;
};

// Marco verde alrededor del contenido (hojas de presentacion).
export const paintFrame = (sheet, lastRow, lastCol) => {
  const frame = { fill: COLOR_FRAME };
  for (let c = 1; c <= lastCol; c += 1) {
    sheet.cell(1, c).style(frame);
    sheet.cell(lastRow, c).style(frame);
  }
  for (let r = 1; r <= lastRow; r += 1) {
    sheet.cell(r, 1).style(frame);
    sheet.cell(r, lastCol).style(frame);
  }
  sheet.column("A").width(3);
  sheet.column(colLetter(lastCol)).width(3);
};

export const writeFuente = (sheet, row, col) => {
  sheet.cell(row, col).value("Elaboración: Propia").style(ST_NOTE);
  sheet.cell(row + 1, col).value("Fuente: Encuesta aplicada").style(ST_NOTE);
  return row + 2;
};

export const writeNarrative = (sheet, row, col, widthCols, heightRows, text) => {
  sheet.range(row, col, row + heightRows - 1, col + widthCols - 1)
    .merged(true)
    .style(ST_NARRATIVE);
  sheet.cell(row, col).value(text);
  return row + heightRows;
};

export const countByValue = (values, escala) => escala.map((opt) => values.filter((v) => v === opt.valor).length);
