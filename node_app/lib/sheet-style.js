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

// Nombre de hoja valido para Excel.
//
// Dos fallos que corrige el orden de las operaciones y el juego de caracteres:
//
//  1. El trim() iba ANTES del slice(0,31), asi que cortar un nombre largo
//     podia dejar un espacio al final. Dos hojas se veian identicas en las
//     pestanas y la referencia no se podia escribir a mano.
//  2. El apostrofo no se saneaba. Excel prohibe que un nombre empiece o
//     termine con apostrofo, y el corte a 31 podia CREAR uno final a partir de
//     un nombre legitimo ("Gestion educativas' del sector publico" ->
//     "Gestion educativas'"). Las formulas quedaban con triple apostrofo y el
//     recalculo devolvia cientos de #REF!.
const limpiarNombreHoja = (name) => String(name)
  .replace(/[[\]*?:/\\']/g, " ")
  .slice(0, 31)
  .trim() || "Hoja";

export const sanitizeSheetName = (name, used) => {
  const base = limpiarNombreHoja(name);
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    // El trim tambien aqui: al recortar para hacer sitio al sufijo puede
    // quedar un espacio antes del parentesis.
    candidate = base.slice(0, 31 - suffix.length).trim() + suffix;
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
    // El maximo nunca puede quedar por debajo del minimo de su propio nivel.
    //
    // Con amplitud < 1 (mas niveles de baremo que puntajes posibles: una
    // dimension de 1 item con escala 1-5 y 5 niveles), Math.round repetia el
    // mismo corte entre iteraciones y salian filas con "Desde 3, Hasta 2" en
    // la ficha de baremo que el tesista pega en su tesis, mas umbrales muertos
    // en el IF anidado (IF(C5<=2,...) dos veces seguidas). El clamp evita el
    // rango invertido; que la configuracion sea razonable se valida ademas en
    // config.js, que es donde se le puede decir al usuario.
    const upper = i === nombresNiveles.length - 1
      // El ultimo nivel llega al maximo, salvo que los anteriores ya se lo
      // hayan comido: entonces manda su propio minimo (nunca invertido).
      ? Math.max(lower, pMax)
      : Math.max(lower, Math.min(pMax, pMin + Math.round(amplitud * (i + 1)) - 1));
    const nivel = { nombre, min: lower, max: upper };
    lower = upper + 1;
    return nivel;
  });
};

// Alto de fila necesario para que un texto ajustado (wrapText) no se corte.
//
// Se detecto abriendo el PDF que produce LibreOffice: los encabezados con el
// nombre completo del item ("Realiza trazos controlados" en una columna de
// ancho 8) se partian en cuatro lineas dentro de una fila que solo mostraba
// tres, y el texto salia cortado a media palabra en el documento que el
// tesista pega en su tesis. La validacion del XML y el recalculo de formulas
// no ven este defecto: solo se ve al imprimir.
//
// Se simula el ajuste por palabras, que es como envuelve Excel: una palabra
// mas larga que la columna ocupa ella sola varias lineas.
export const altoParaTextoAjustado = (textos, anchoColumna, opciones = {}) => {
  const { min = 20, max = 120, altoLinea = 11, margen = 8 } = opciones;
  // Ancho util en caracteres. Se descuenta un poco: la fuente en negrita de
  // los encabezados es mas ancha que la de referencia de Excel.
  const porLinea = Math.max(1, Math.floor(anchoColumna * 0.95));

  const lineasDe = (texto) => {
    const palabras = String(texto ?? "").trim().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return 1;
    let lineas = 1;
    let actual = 0;
    for (const palabra of palabras) {
      if (palabra.length > porLinea) {
        // Palabra que no cabe: se parte en tantas lineas como haga falta.
        // Si la linea en curso ya tenia algo, esa palabra empieza en la
        // siguiente (no hace falta poner `actual` a cero: se reasigna abajo).
        if (actual > 0) lineas += 1;
        lineas += Math.ceil(palabra.length / porLinea) - 1;
        actual = palabra.length % porLinea;
        continue;
      }
      const necesario = actual === 0 ? palabra.length : actual + 1 + palabra.length;
      if (necesario > porLinea) { lineas += 1; actual = palabra.length; } else { actual = necesario; }
    }
    return lineas;
  };

  const maxLineas = Math.max(1, ...textos.map(lineasDe));
  return Math.min(max, Math.max(min, maxLineas * altoLinea + margen));
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
