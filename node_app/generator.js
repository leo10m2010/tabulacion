// Generador de tabulaciones 100% por codigo: construye el .xlsx completo
// (estructura, formulas reales, graficos e interpretaciones) sin depender de
// ninguna plantilla.
//
// Hojas generadas por variable:
//   1. "[Variable]"              base de datos + estadisticos + frecuencias por escala
//   2. "Ítems [Variable]"        tabla frec/% + grafico + Figura + interpretacion por item
//   3. "Dimensiones [Variable]"  ficha de baremo, niveles, valoracion automatica,
//                                frecuencia baremada, grafico e interpretacion por dimension
//   4. "Conteo [Variable]"       respuestas agregadas por dimension + grafico + interpretacion
// Mas "Relaciones" (normalidad calculada sobre V1 total, V2 total y las
// dimensiones de V1; correlaciones Pearson o Rho de Spearman segun los Sig.:
// general V1-V2 y cada dimension de V1 contra V2), "Correlación" (r/rho vivo
// + criterio) e "Información".
//
// Los graficos se inyectan como XML OOXML (charts + drawings) porque
// xlsx-populate no los soporta de forma nativa.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XlsxPopulate from "xlsx-populate";
import JSZip from "jszip";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
export const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "Tabulacion.json");
export const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "Tabulacion_generada.xlsx");
export const DEFAULT_BASE_CSV_PATH = path.join(ROOT_DIR, "Tabulacion_base.csv");

export const MAX_MUESTRA = 2000;
export const MAX_ITEMS_POR_VARIABLE = 60;

// ── Estilos ──────────────────────────────────────────────────────────────────
const COLOR_HEADER = "1F3864"; // azul oscuro
const COLOR_SUBHEADER = "2F5597"; // azul medio (indicadores)
const COLOR_STATS = "DDEBF7"; // azul muy claro
const COLOR_ALT_ROW = "F2F2F2"; // gris claro
const COLOR_FRAME = "6AA84F"; // marco verde de las hojas de presentacion
const COLOR_BLOCK = "FFD966"; // amarillo de los encabezados de bloque
const CHART_COLOR = "2F5597";

const FONT = { fontFamily: "Arial", fontSize: 10 };
const ST_HEADER = {
  ...FONT,
  bold: true,
  fontColor: "FFFFFF",
  fill: COLOR_HEADER,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  border: true,
};
const ST_SUBHEADER = { ...ST_HEADER, fill: COLOR_SUBHEADER };
const ST_BLOCK = {
  ...FONT,
  bold: true,
  fill: COLOR_BLOCK,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  border: true,
};
const ST_CELL = { ...FONT, border: true, horizontalAlignment: "center" };
const ST_CELL_LEFT = { ...FONT, border: true, horizontalAlignment: "left" };
const ST_STATS_LABEL = { ...FONT, bold: true, fill: COLOR_STATS, border: true, horizontalAlignment: "left" };
const ST_STATS_VALUE = { ...FONT, fill: COLOR_STATS, border: true, horizontalAlignment: "center" };
const ST_LABEL_BOLD = { ...FONT, bold: true };
const ST_NOTE = { ...FONT, fontSize: 9, italic: true };
const ST_NARRATIVE = { ...FONT, wrapText: true, verticalAlignment: "top", horizontalAlignment: "left" };
const FMT_2DEC = "0.00";
const FMT_PCT_NUM = '0.00"%"'; // numero 0-100 mostrado con simbolo
const FMT_PCT = "0.00%"; // proporcion 0-1 formateada como porcentaje

// ── Helpers ──────────────────────────────────────────────────────────────────
const toInt = (value, fallback = 0) => {
  const n = parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
};

const colLetter = (n) => {
  let s = "";
  let c = n;
  while (c > 0) {
    const r = (c - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
};

const quoteSheet = (name) => `'${String(name).replace(/'/g, "''")}'`;

const escXml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const sanitizeSheetName = (name, used) => {
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

const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

// Rangos de baremo: cortes enteros con amplitud = rango / niveles
// (p.ej. 9 items, escala 1-5, 3 niveles => 9-20 / 21-32 / 33-45).
const computeNiveles = (nItems, escalaMin, escalaMax, nombresNiveles) => {
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
const valoracionFormula = (niveles, ref) => {
  let f = `"${niveles[niveles.length - 1].nombre}"`;
  for (let i = niveles.length - 2; i >= 0; i -= 1) {
    f = `IF(${ref}<=${niveles[i].max},"${niveles[i].nombre}",${f})`;
  }
  return `IF(${ref}="","",${f})`;
};

// Marco verde alrededor del contenido (hojas de presentacion).
const paintFrame = (sheet, lastRow, lastCol) => {
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

const writeFuente = (sheet, row, col) => {
  sheet.cell(row, col).value("Elaboración: Propia").style(ST_NOTE);
  sheet.cell(row + 1, col).value("Fuente: Encuesta aplicada").style(ST_NOTE);
  return row + 2;
};

const writeNarrative = (sheet, row, col, widthCols, heightRows, text) => {
  sheet.range(row, col, row + heightRows - 1, col + widthCols - 1)
    .merged(true)
    .style(ST_NARRATIVE);
  sheet.cell(row, col).value(text);
  return row + heightRows;
};

// ── Normalizacion de configuracion ───────────────────────────────────────────
// Acepta tanto el formato del frontend (muestra, nombre_respuesta,
// estructura_v1, nombre_dims_v1, ...) como un formato anidado directo
// ({ encuestados, escala: [...], variables: [{ dimensiones: [...] }] }).
const buildVariableFromFlat = (raw, varNum, fallbackItems) => {
  const estructura = raw[`estructura_v${varNum}`];
  if (Array.isArray(estructura) && estructura.length > 0) {
    return estructura.map((d) => ({
      nombre: String(d.nombre ?? "").trim() || "Dimensión",
      indicadores: (Array.isArray(d.indicadores) && d.indicadores.length > 0
        ? d.indicadores
        : [{ nombre: d.nombre, items: d.items }]
      ).map((ind) => ({
        nombre: String(ind.nombre ?? "").trim() || String(d.nombre ?? "Indicador"),
        items: toInt(Array.isArray(ind.items) ? ind.items.length : ind.items, 0),
      })),
    }));
  }

  const dimNames = Array.isArray(raw[`nombre_dims_v${varNum}`]) ? raw[`nombre_dims_v${varNum}`] : [];
  const itemsPerDim = Array.isArray(raw[`items_por_dim_v${varNum}`])
    ? raw[`items_por_dim_v${varNum}`].map((v) => toInt(v, 0))
    : [];
  if (dimNames.length > 0 && itemsPerDim.length === dimNames.length) {
    return dimNames.map((nombre, i) => ({
      nombre: String(nombre).trim() || `Dimensión ${i + 1}`,
      indicadores: [{ nombre: String(nombre).trim() || `Dimensión ${i + 1}`, items: itemsPerDim[i] }],
    }));
  }

  if (fallbackItems > 0) {
    return [{
      nombre: "Dimensión única",
      indicadores: [{ nombre: "Dimensión única", items: fallbackItems }],
    }];
  }
  return [];
};

const parseBaremoOverride = (raw, suffix, nivelNames) => {
  const desde = Array.isArray(raw[`desde${suffix}`]) ? raw[`desde${suffix}`].map((v) => toInt(v, NaN)) : [];
  const hasta = Array.isArray(raw[`hasta${suffix}`]) ? raw[`hasta${suffix}`].map((v) => toInt(v, NaN)) : [];
  if (desde.length !== nivelNames.length || hasta.length !== nivelNames.length) return undefined;
  if (desde.some((v) => !Number.isFinite(v)) || hasta.some((v) => !Number.isFinite(v))) return undefined;
  return nivelNames.map((nombre, i) => ({ nombre, min: desde[i], max: hasta[i] }));
};

const DEFAULT_NIVEL_NAMES = {
  2: ["Bajo", "Alto"],
  3: ["Bajo", "Medio", "Alto"],
  4: ["Muy bajo", "Bajo", "Alto", "Muy alto"],
  5: ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"],
};

export const normalizeConfig = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Debes enviar una configuracion valida (objeto JSON).");
  }

  const encuestados = toInt(raw.encuestados ?? raw.muestra, 0);
  if (encuestados < 2) {
    throw new Error("N° de muestra debe ser mayor o igual a 2.");
  }
  if (encuestados > MAX_MUESTRA) {
    throw new Error(`La muestra maxima soportada es ${MAX_MUESTRA} (configuraste ${encuestados}).`);
  }

  // Escala de respuesta (opciones por item).
  let escala;
  if (Array.isArray(raw.escala) && raw.escala.some((o) => typeof o === "object" || typeof o === "string")) {
    escala = raw.escala.map((opt, i) => (typeof opt === "string"
      ? { valor: i + 1, etiqueta: opt }
      : { valor: toInt(opt.valor, i + 1), etiqueta: String(opt.etiqueta ?? opt.valor) }));
  } else {
    const labels = Array.isArray(raw.nombre_respuesta) ? raw.nombre_respuesta.map(String) : [];
    const count = labels.length > 0 ? labels.length : Math.max(toInt(raw.respuesta, 5), 2);
    escala = Array.from({ length: count }, (_, i) => ({
      valor: i + 1,
      etiqueta: labels[i] ?? `Opción ${i + 1}`,
    }));
  }
  if (escala.length < 2) throw new Error("La escala necesita al menos 2 opciones.");

  // Niveles de baremo por variable.
  const nivelesPorDefecto = (countHint) => {
    const count = Math.max(countHint, 2);
    return DEFAULT_NIVEL_NAMES[count] ?? Array.from({ length: count }, (_, i) => `Nivel ${i + 1}`);
  };
  const nivelesV1 = (Array.isArray(raw.niveles) && raw.niveles.length >= 2 && raw.niveles.map(String))
    || (Array.isArray(raw.nombre_escala) && raw.nombre_escala.length >= 2 && raw.nombre_escala.map(String))
    || nivelesPorDefecto(toInt(raw.escala, 3));
  const nivelesV2 = (Array.isArray(raw.nombre_escala_v2) && raw.nombre_escala_v2.length >= 2 && raw.nombre_escala_v2.map(String))
    || nivelesV1;

  // Variables y su estructura.
  let variables;
  if (Array.isArray(raw.variables) && raw.variables.length > 0) {
    variables = raw.variables.map((v, vi) => ({
      nombre: String(v.nombre ?? "").trim() || `Variable ${vi + 1}`,
      niveles: (Array.isArray(v.niveles) && v.niveles.length >= 2 && v.niveles.map(String)) || (vi === 0 ? nivelesV1 : nivelesV2),
      baremoVariable: undefined,
      itemNames: Array.isArray(v.nombre_items) ? v.nombre_items.map(String) : [],
      dimensiones: (v.dimensiones ?? []).map((d, di) => ({
        nombre: String(d.nombre ?? "").trim() || `Dimensión ${di + 1}`,
        indicadores: (d.indicadores ?? []).map((ind) => ({
          nombre: String(ind.nombre ?? "").trim() || "Indicador",
          items: toInt(ind.items, 0),
        })),
      })),
    }));
  } else {
    const numVars = Math.max(1, Math.min(toInt(raw.variable, 2), 2));
    const varNames = Array.isArray(raw.nombre_dimension) ? raw.nombre_dimension.map(String) : [];
    const hasContent = (v) => Array.isArray(v) && v.length > 0;
    variables = [];
    for (let vi = 0; vi < numVars; vi += 1) {
      const fallbackItems = toInt(vi === 0 ? raw.item : raw.itemv2, 0);
      if (vi === 1 && fallbackItems <= 0 && !hasContent(raw.estructura_v2) && !hasContent(raw.nombre_dims_v2)) break;
      const niveles = vi === 0 ? nivelesV1 : nivelesV2;
      variables.push({
        nombre: varNames[vi]?.trim() || `Variable ${vi + 1}`,
        niveles,
        baremoVariable: parseBaremoOverride(raw, vi === 0 ? "" : "_v2", niveles),
        itemNames: Array.isArray(raw[`nombre_items_v${vi + 1}`]) ? raw[`nombre_items_v${vi + 1}`].map(String) : [],
        dimensiones: buildVariableFromFlat(raw, vi + 1, fallbackItems),
      });
    }
  }

  variables.forEach((variable, vi) => {
    const total = variable.dimensiones.reduce(
      (acc, d) => acc + d.indicadores.reduce((a, ind) => a + ind.items, 0),
      0,
    );
    if (total <= 0) {
      throw new Error(`Define el numero de items de la Variable ${vi + 1} antes de generar.`);
    }
    if (total > MAX_ITEMS_POR_VARIABLE) {
      throw new Error(
        `El sistema soporta como maximo ${MAX_ITEMS_POR_VARIABLE} items para la Variable ${vi + 1} (configuraste ${total}).`,
      );
    }
    variable.totalItems = total;
  });
  if (variables.length === 0) {
    throw new Error("Define el numero de items V1 antes de generar.");
  }

  // Aviso si el numero de items declarado no coincide con la estructura
  // jerarquica: la estructura manda, pero el usuario debe saberlo.
  const warnings = [];
  if (!Array.isArray(raw.variables)) {
    variables.forEach((variable, vi) => {
      const declared = toInt(vi === 0 ? raw.item : raw.itemv2, 0);
      if (declared > 0 && declared !== variable.totalItems) {
        warnings.push(
          `La Variable ${vi + 1} declara ${declared} items pero su estructura define ${variable.totalItems}; se uso la estructura.`,
        );
      }
    });
  }

  const relacion = String(raw.relacionversa ?? "0").trim().toLowerCase();
  const conDatosRaw = String(raw.conDatos ?? raw.con_datos ?? "1").trim().toLowerCase();

  return {
    warnings,
    titulo: String(raw.titulo ?? "").trim(),
    investigador: String(raw.investigador ?? "").trim(),
    etiquetaMuestra: String(raw.nommuestra ?? raw.etiquetaMuestra ?? "").trim() || "Encuestados",
    encuestados,
    escala,
    variables,
    relacionInversa: new Set(["1", "si", "sí", "true", "inversa"]).has(relacion),
    conDatos: !new Set(["0", "false", "no", "off"]).has(conDatosRaw),
  };
};

// ── Simulacion de base de datos ──────────────────────────────────────────────
const randn = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const pearson = (x, y) => {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return Number.NaN;
  return num / den;
};

const sumPerRow = (base, varNum, count, rows) => Array.from({ length: rows }, (_, i) => {
  let sum = 0;
  for (let c = 1; c <= count; c += 1) sum += base[`V${varNum}_${c}`][i];
  return sum;
});

const sumRangePerRow = (base, varNum, from, to, rows) => Array.from({ length: rows }, (_, i) => {
  let sum = 0;
  for (let c = from; c <= to; c += 1) sum += base[`V${varNum}_${c}`][i];
  return sum;
});

// ── Pruebas de normalidad ────────────────────────────────────────────────────
const normCdf = (z) => {
  // Abramowitz & Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
};

const normInv = (p) => {
  // Algoritmo de Acklam para la inversa de la normal estandar.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p <= 0 || p >= 1) return Number.NaN;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q)
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
};

// Kolmogorov-Smirnov con correccion de Lilliefors (p-valor de Dallal-Wilkinson
// 1986 y polinomios de Stephens, igual que nortest::lillie.test de R).
export const lillieforsTest = (values) => {
  const n = values.length;
  if (n < 4) return null;
  const x = [...values].sort((p, q) => p - q);
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  if (sd === 0) return null;
  let dPlus = 0;
  let dMinus = 0;
  for (let i = 0; i < n; i += 1) {
    const F = normCdf((x[i] - mean) / sd);
    dPlus = Math.max(dPlus, (i + 1) / n - F);
    dMinus = Math.max(dMinus, F - i / n);
  }
  const D = Math.max(dPlus, dMinus);
  let p = Math.exp(
    -7.01256 * D * D * (n + 2.78019) + 2.99587 * D * Math.sqrt(n + 2.78019)
    - 0.122119 + 0.974598 / Math.sqrt(n) + 1.67997 / n,
  );
  if (p > 0.1) {
    const kk = (Math.sqrt(n) - 0.01 + 0.85 / Math.sqrt(n)) * D;
    if (kk <= 0.302) p = 1;
    else if (kk <= 0.5) p = 2.76773 - 19.828315 * kk + 80.709644 * kk ** 2 - 138.55152 * kk ** 3 + 81.218052 * kk ** 4;
    else if (kk <= 0.9) p = -4.901232 + 40.662806 * kk - 97.490286 * kk ** 2 + 94.029866 * kk ** 3 - 32.355711 * kk ** 4;
    else if (kk <= 1.31) p = 6.198765 - 19.558097 * kk + 23.186922 * kk ** 2 - 12.234627 * kk ** 3 + 2.423045 * kk ** 4;
    else p = 0;
  }
  return { stat: D, p: Math.min(Math.max(p, 0), 1) };
};

// Shapiro-Wilk segun Royston (1995, algoritmo AS R94).
export const shapiroWilkTest = (values) => {
  const n = values.length;
  if (n < 3 || n > 5000) return null;
  const x = [...values].sort((p, q) => p - q);
  if (x[0] === x[n - 1]) return null;
  const m = x.map((_, i) => normInv((i + 1 - 0.375) / (n + 0.25)));
  const ssm = m.reduce((s, v) => s + v * v, 0);
  const rsn = 1 / Math.sqrt(n);
  const a = new Array(n).fill(0);
  if (n === 3) {
    a[0] = -Math.SQRT1_2;
    a[2] = Math.SQRT1_2;
  } else if (n <= 5) {
    const an = -2.706056 * rsn ** 5 + 4.434685 * rsn ** 4 - 2.07119 * rsn ** 3
      - 0.147981 * rsn ** 2 + 0.221157 * rsn + m[n - 1] / Math.sqrt(ssm);
    const phi = (ssm - 2 * m[n - 1] ** 2) / (1 - 2 * an ** 2);
    a[n - 1] = an;
    a[0] = -an;
    for (let i = 1; i < n - 1; i += 1) a[i] = m[i] / Math.sqrt(phi);
  } else {
    const an = -2.706056 * rsn ** 5 + 4.434685 * rsn ** 4 - 2.07119 * rsn ** 3
      - 0.147981 * rsn ** 2 + 0.221157 * rsn + m[n - 1] / Math.sqrt(ssm);
    const an1 = -3.582633 * rsn ** 5 + 5.682633 * rsn ** 4 - 1.752461 * rsn ** 3
      - 0.293762 * rsn ** 2 + 0.042981 * rsn + m[n - 2] / Math.sqrt(ssm);
    const phi = (ssm - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * an ** 2 - 2 * an1 ** 2);
    a[n - 1] = an;
    a[0] = -an;
    a[n - 2] = an1;
    a[1] = -an1;
    for (let i = 2; i < n - 2; i += 1) a[i] = m[i] / Math.sqrt(phi);
  }
  const mean = x.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += a[i] * x[i];
    den += (x[i] - mean) ** 2;
  }
  if (den === 0) return null;
  const W = Math.min((num * num) / den, 1);
  let p;
  if (W >= 1) {
    p = 1;
  } else if (n === 3) {
    p = (6 / Math.PI) * (Math.asin(Math.sqrt(W)) - Math.asin(Math.sqrt(0.75)));
  } else if (n <= 11) {
    const g = -2.273 + 0.459 * n;
    const mu = 0.544 - 0.39978 * n + 0.025054 * n ** 2 - 0.0006714 * n ** 3;
    const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n ** 2 - 0.0020322 * n ** 3);
    const z = (-Math.log(g - Math.log(1 - W)) - mu) / sigma;
    p = 1 - normCdf(z);
  } else {
    const ln = Math.log(n);
    const mu = 0.0038915 * ln ** 3 - 0.083751 * ln ** 2 - 0.31082 * ln - 1.5861;
    const sigma = Math.exp(0.0030302 * ln ** 2 - 0.082676 * ln - 0.4803);
    const z = (Math.log(1 - W) - mu) / sigma;
    p = 1 - normCdf(z);
  }
  return { stat: W, p: Math.min(Math.max(p, 0), 1) };
};

export const computeCorrelation = (base, cfg) => {
  const rows = cfg.encuestados;
  if (cfg.variables.length < 2) return null;
  const v1 = sumPerRow(base, 1, cfg.variables[0].totalItems, rows);
  const v2 = sumPerRow(base, 2, cfg.variables[1].totalItems, rows);
  const r = pearson(v1, v2);
  if (!Number.isFinite(r)) {
    throw new Error("No se pudo calcular una correlacion valida con la base generada.");
  }
  return r;
};

export const generateBaseData = (cfg) => {
  const rows = cfg.encuestados;
  const v1Count = cfg.variables[0].totalItems;
  const v2Count = cfg.variables[1]?.totalItems ?? 0;
  const minResponse = Math.min(...cfg.escala.map((o) => o.valor));
  const maxResponse = Math.max(...cfg.escala.map((o) => o.valor));
  const sign = cfg.relacionInversa ? -1 : 1;

  const targetCorr = 0.95;
  let noiseStd = Math.sqrt(1 / (targetCorr ** 2) - 1);

  const scaleToRange = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const mid = Math.floor((minResponse + maxResponse) / 2);
      return values.map(() => mid);
    }
    return values.map((v) => {
      const norm = (v - min) / (max - min);
      const mapped = minResponse + norm * (maxResponse - minResponse);
      const val = Math.round(mapped);
      return Math.max(minResponse, Math.min(maxResponse, val));
    });
  };

  const buildOnce = (std) => {
    const z = Array.from({ length: rows }, () => randn());
    const cols = {};
    for (let i = 1; i <= v1Count; i += 1) {
      cols[`V1_${i}`] = z.map((v) => v + randn() * std);
    }
    for (let i = 1; i <= v2Count; i += 1) {
      cols[`V2_${i}`] = z.map((v) => sign * v + randn() * std);
    }
    const data = {};
    Object.entries(cols).forEach(([k, values]) => {
      data[k] = scaleToRange(values);
    });
    return data;
  };

  if (v2Count === 0) return buildOnce(noiseStd);

  let best = null;
  let bestCorr = 0;
  for (let i = 0; i < 6; i += 1) {
    const data = buildOnce(noiseStd);
    const r = computeCorrelation(data, cfg);
    if (Math.abs(r) > Math.abs(bestCorr)) {
      bestCorr = r;
      best = data;
    }
    if (Math.abs(r) >= 0.9) return data;
    noiseStd = Math.max(0.05, noiseStd * 0.7);
  }
  return best ?? buildOnce(0.05);
};

const buildBaseCsv = (base, cfg) => {
  const headers = [];
  cfg.variables.forEach((variable, vi) => {
    for (let i = 1; i <= variable.totalItems; i += 1) headers.push(`V${vi + 1}_${i}`);
  });
  const lines = [headers.join(",")];
  if (base) {
    for (let r = 0; r < cfg.encuestados; r += 1) {
      lines.push(headers.map((h) => base[h][r]).join(","));
    }
  }
  return lines.join("\n");
};

// ── Narrativas (interpretaciones automaticas) ────────────────────────────────
const sortShares = (counts, labels, total) => labels
  .map((label, i) => ({ label, count: counts[i], share: total > 0 ? counts[i] / total : 0 }))
  .sort((a, b) => b.share - a.share);

const joinShares = (shares, verb, max = 3) => {
  const top = shares.slice(0, max).filter((s) => s.count > 0);
  const parts = top.map((s, i) => `el ${fmtPct(s.share)}${i === 0 ? ` ${verb}` : ""} "${s.label}"`);
  if (parts.length > 1) {
    const last = parts.pop();
    return `${parts.join(", ")} y ${last}`;
  }
  return parts[0] ?? "";
};

const countByValue = (values, escala) => escala.map((opt) => values.filter((v) => v === opt.valor).length);

const narrativeItem = (cfg, tablaN, code, texto, counts) => {
  const ref = texto ? `${code} (${texto})` : code;
  if (!counts) {
    return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan los resultados del ítem ${ref}. `
      + `Ingrese las respuestas en la hoja base: la tabla, el gráfico y los porcentajes se actualizarán automáticamente y podrá completar esta interpretación.`;
  }
  const shares = sortShares(counts, cfg.escala.map((o) => o.etiqueta), cfg.encuestados);
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan los resultados del ítem ${ref}, `
    + `aplicado a los ${cfg.encuestados} ${cfg.etiquetaMuestra.toLowerCase()}: ${joinShares(shares, "respondió")}. `
    + `Por todo ello, la tendencia predominante del ítem es "${shares[0].label}".`;
};

const narrativeDimension = (cfg, tablaN, variableName, dimName, nivelCounts, niveles) => {
  if (!nivelCounts) {
    return `En la Tabla ${tablaN} y la Figura ${tablaN} se observa la calificación de la variable ${variableName} en base a su dimensión ${dimName}. `
      + `Ingrese las respuestas en la hoja base para que la valoración, la tabla y el gráfico se calculen automáticamente.`;
  }
  const shares = sortShares(nivelCounts, niveles.map((n) => n.nombre), cfg.encuestados);
  const seguido = shares.slice(1).filter((s) => s.count > 0)
    .map((s) => `"${s.label}" con el ${fmtPct(s.share)}`)
    .join(" y ");
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se puede observar que la variable ${variableName}, en base a su dimensión ${dimName}, `
    + `tiene una calificación de "${shares[0].label}" por el ${fmtPct(shares[0].share)} de los resultados`
    + `${seguido ? `, seguida de ${seguido}` : ""}. `
    + `Estos resultados fueron extraídos de las encuestas ejecutadas a los ${cfg.encuestados} ${cfg.etiquetaMuestra.toLowerCase()}; `
    + `por todo ello, la dimensión ${dimName} es "${shares[0].label}".`;
};

const narrativeConteo = (cfg, tablaN, dimName, nItems, counts) => {
  if (!counts) {
    return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan las respuestas agregadas de los ${nItems} ítems de la dimensión ${dimName}. `
      + `Ingrese las respuestas en la hoja base para completar esta interpretación.`;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const shares = sortShares(counts, cfg.escala.map((o) => o.etiqueta), total);
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan las ${total} respuestas agregadas de los ${nItems} ítems de la dimensión ${dimName}: `
    + `${joinShares(shares, "corresponde a")}. La opción predominante de la dimensión es "${shares[0].label}".`;
};

const narrativeNormalidadAuto = (tablaN, v1Name, v2Name, useSW, method) => {
  const prueba = useSW
    ? "Shapiro-Wilk (muestra ≤ 50)"
    : "Kolmogorov-Smirnov con corrección de Lilliefors (muestra > 50)";
  if (method === "pearson") {
    return `En la Tabla ${tablaN}, y basándose en la prueba de ${prueba}, se puede observar que los valores de significancia (Sig.) de la variable ${v1Name}, `
      + `de la variable ${v2Name} y de las dimensiones de ${v1Name} son todos mayores o iguales a 0.05; es decir, los datos se encuentran normalmente `
      + `distribuidos. Por tal motivo se procederá a utilizar la prueba paramétrica de correlación de Pearson.`;
  }
  return `En la Tabla ${tablaN}, y basándose en la prueba de ${prueba}, se puede observar que al menos uno de los valores de significancia (Sig.) de la variable ${v1Name}, `
    + `de la variable ${v2Name} y de las dimensiones de ${v1Name} es menor que 0.05; es decir, los datos no se encuentran normalmente distribuidos. `
    + `Por tal motivo se procederá a utilizar la prueba no paramétrica Rho de Spearman.`;
};

const narrativeNormalidadManual = (tablaN, v1Name, v2Name) => (
  `En la Tabla ${tablaN} se presentan las pruebas de normalidad de la variable ${v1Name}, de la variable ${v2Name} y de las dimensiones de ${v1Name} `
  + `(la normalidad no se aplica a las dimensiones de la variable 2). Complete los valores con los resultados de SPSS y revise las significancias: `
  + `si todos los Sig. son mayores o iguales a 0.05, utilice la correlación de Pearson; si uno o más son menores que 0.05, utilice Rho de Spearman. `
  + `Las tablas de correlación de este archivo se generaron con Pearson por defecto.`
);

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
    const chartTop = row;
    charts.push({
      title: item.code,
      seriesName: "%",
      catRef: `${sheetRef}!$${colLetter(C0)}$${tStart}:$${colLetter(C0)}$${tTotal - 1}`,
      valRef: `${sheetRef}!$${colLetter(C0 + 2)}$${tStart}:$${colLetter(C0 + 2)}$${tTotal - 1}`,
      numFmt: FMT_PCT,
      varyColors: false,
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

    const counts = base ? countByValue(base[`V${varIndex + 1}_${item.indexInVar}`], escala) : null;
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

    const chartTop = row;
    charts.push({
      title: dim.nombre,
      seriesName: "%",
      catRef: `${sheetRef}!$${colLetter(C0)}$${tStart}:$${colLetter(C0)}$${tTotal - 1}`,
      valRef: `${sheetRef}!$${colLetter(C0 + 2)}$${tStart}:$${colLetter(C0 + 2)}$${tTotal - 1}`,
      numFmt: FMT_PCT,
      varyColors: false,
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

    let counts = null;
    if (base) {
      counts = escala.map(() => 0);
      items.forEach((item) => {
        countByValue(base[`V${varIndex + 1}_${item.indexInVar}`], escala)
          .forEach((c, i) => { counts[i] += c; });
      });
    }
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
    cfg, titulo, variableName, dimensionName, items, niveles, baseRef, baseDataStart, startRow,
    tablaN, nivelCounts,
  } = ctx;
  const N = cfg.encuestados;
  const escalaMin = Math.min(...cfg.escala.map((o) => o.valor));
  const escalaMax = Math.max(...cfg.escala.map((o) => o.valor));
  const nItems = items.length;
  const pMin = nItems * escalaMin;
  const pMax = nItems * escalaMax;
  const C0 = 2; // col B: la A es el marco
  // El titulo cubre exactamente el ancho de la tabla de datos (ID + items +
  // Suma + Valoracion), con un minimo para bloques de pocas columnas.
  const blockCols = Math.max(10, nItems + 3);
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

  // Base de la dimension: referencia las celdas de la hoja base.
  const headerRow = row;
  sheet.cell(headerRow, C0).value("ID").style(ST_HEADER);
  items.forEach((item, j) => {
    sheet.cell(headerRow, C0 + 1 + j).value(item.code).style(ST_HEADER);
  });
  const sumaCol = C0 + 1 + nItems;
  const valCol = sumaCol + 1;
  sheet.cell(headerRow, sumaCol).value("Suma Total").style(ST_HEADER);
  sheet.cell(headerRow, valCol).value("Valoración").style(ST_HEADER);

  const dStart = headerRow + 1;
  const dEnd = dStart + N - 1;
  const sumaL = colLetter(sumaCol);
  const firstL = colLetter(C0 + 1);
  const lastL = colLetter(C0 + nItems);
  for (let i = 0; i < N; i += 1) {
    const r = dStart + i;
    const alt = i % 2 === 1 ? { fill: COLOR_ALT_ROW } : {};
    sheet.cell(r, C0).value(i + 1).style({ ...ST_CELL, ...alt });
    items.forEach((item, j) => {
      const src = `${baseRef}!${colLetter(item.col)}${baseDataStart + i}`;
      sheet.cell(r, C0 + 1 + j).style({ ...ST_CELL, ...alt }).formula(`IF(${src}="","",${src})`);
    });
    sheet.cell(r, sumaCol).style({ ...ST_CELL, ...alt, bold: true })
      .formula(`IF(COUNT(${firstL}${r}:${lastL}${r})=0,"",SUM(${firstL}${r}:${lastL}${r}))`);
    sheet.cell(r, valCol).style({ ...ST_CELL, ...alt })
      .formula(valoracionFormula(niveles, `${sumaL}${r}`));
  }

  // Tabla de frecuencia baremada (Calificacion | Desde | Hasta | f | %).
  const valL = colLetter(valCol);
  let r2 = dEnd + 2;
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
      .formula(`COUNTIF(${valL}${dStart}:${valL}${dEnd},"${nivel.nombre}")`);
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

  return {
    endRow: r3 + 2,
    chart,
    sumaRef: { sheetName: sheet.name(), col: sumaL, start: dStart, end: dEnd },
  };
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
  const escalaMin = Math.min(...cfg.escala.map((o) => o.valor));
  const escalaMax = Math.max(...cfg.escala.map((o) => o.valor));
  const charts = [];
  const dimSumaRefs = [];
  let row = 2;
  let tabla = 0;

  baseInfo.dims.forEach((dim, dimIdx) => {
    tabla += 1;
    const items = dim.indicadores.flatMap((ind) => ind.items);
    const niveles = computeNiveles(items.length, escalaMin, escalaMax, variable.niveles);
    const block = buildBaremoBlock(sheet, {
      cfg,
      titulo: `DIMENSIÓN ${dimIdx + 1}: ${dim.nombre}`,
      variableName: variable.nombre,
      dimensionName: dim.nombre,
      items,
      niveles,
      baseRef,
      baseDataStart: baseInfo.dataStart,
      startRow: row,
      tablaN: tabla,
      nivelCounts: classifyCounts(base, varIndex, items, niveles, cfg.encuestados),
    });
    charts.push(block.chart);
    dimSumaRefs.push({ nombre: dim.nombre, ...block.sumaRef });
    row = block.endRow;
  });

  // Bloque consolidado de la variable completa (baremo de la variable).
  tabla += 1;
  const allItems = baseInfo.dims.flatMap((d) => d.indicadores.flatMap((ind) => ind.items));
  const nivelesVar = variable.baremoVariable
    ?? computeNiveles(allItems.length, escalaMin, escalaMax, variable.niveles);
  const block = buildBaremoBlock(sheet, {
    cfg,
    titulo: `VARIABLE (CONSOLIDADO): ${variable.nombre}`,
    variableName: variable.nombre,
    dimensionName: "Todas las dimensiones",
    items: allItems,
    niveles: nivelesVar,
    baseRef,
    baseDataStart: baseInfo.dataStart,
    startRow: row,
    tablaN: tabla,
    nivelCounts: classifyCounts(base, varIndex, allItems, nivelesVar, cfg.encuestados),
  });
  charts.push({ ...block.chart, title: variable.nombre });
  row = block.endRow;

  sheet.column("B").width(30);
  ["C", "D", "E", "F", "G", "H"].forEach((L) => sheet.column(L).width(13));
  paintFrame(sheet, row, Math.max(15, allItems.length + 5));
  return { charts, dimSumaRefs, globalSumaRef: block.sumaRef };
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

// ── Optimizacion de estilos ──────────────────────────────────────────────────
// xlsx-populate crea una entrada de estilo por celda; con miles de celdas el
// styles.xml crece sin control. Se deduplican fonts/fills/borders/cellXfs y se
// remapean los indices s="n" de cada hoja.
const dedupeSection = (xml, sectionTag, itemTag) => {
  const re = new RegExp(`<${sectionTag}\\b[^>]*>([\\s\\S]*?)</${sectionTag}>`);
  const m = xml.match(re);
  if (!m) return { xml, map: null };
  const itemRe = new RegExp(`<${itemTag}\\b[^>]*/>|<${itemTag}\\b[^>]*>[\\s\\S]*?</${itemTag}>`, "g");
  const items = m[1].match(itemRe) ?? [];
  const seen = new Map();
  const map = items.map((item) => {
    if (!seen.has(item)) seen.set(item, seen.size);
    return seen.get(item);
  });
  const unique = [...seen.keys()].join("");
  return {
    xml: xml.replace(re, `<${sectionTag} count="${seen.size}">${unique}</${sectionTag}>`),
    map,
  };
};

const remapXfAttr = (xml, attr, map) => {
  if (!map) return xml;
  return xml.replace(/<xf\b[^>]*\/?>/g, (tag) => tag.replace(
    new RegExp(`${attr}="(\\d+)"`),
    (full, idx) => `${attr}="${map[Number(idx)] ?? idx}"`,
  ));
};

const optimizeStyles = async (zip) => {
  const stylesFile = zip.file("xl/styles.xml");
  if (!stylesFile) return;
  let styles = await stylesFile.async("string");

  // Fills vacios (<fill/>) no son validos para varios lectores.
  styles = styles.replaceAll("<fill/>", '<fill><patternFill patternType="none"/></fill>');

  let fontMap;
  let fillMap;
  let borderMap;
  ({ xml: styles, map: fontMap } = dedupeSection(styles, "fonts", "font"));
  ({ xml: styles, map: fillMap } = dedupeSection(styles, "fills", "fill"));
  ({ xml: styles, map: borderMap } = dedupeSection(styles, "borders", "border"));
  styles = remapXfAttr(styles, "fontId", fontMap);
  styles = remapXfAttr(styles, "fillId", fillMap);
  styles = remapXfAttr(styles, "borderId", borderMap);

  let xfMap;
  ({ xml: styles, map: xfMap } = dedupeSection(styles, "cellXfs", "xf"));
  zip.file("xl/styles.xml", styles);

  if (!xfMap) return;
  const sheetPaths = Object.keys(zip.files).filter(
    (p) => p.startsWith("xl/worksheets/") && p.endsWith(".xml"),
  );
  for (const p of sheetPaths) {
    const xml = await zip.file(p).async("string");
    zip.file(p, xml.replace(/\bs="(\d+)"/g, (full, idx) => `s="${xfMap[Number(idx)] ?? idx}"`));
  }
};

// ── Graficos OOXML ───────────────────────────────────────────────────────────
let axisIdCounter = 100000000;

const buildChartXml = (chart) => {
  const ax1 = (axisIdCounter += 2);
  const ax2 = axisIdCounter + 1;
  const dLbls = '<c:dLbls>'
    + `<c:numFmt formatCode="${escXml(chart.numFmt ?? "General")}" sourceLinked="0"/>`
    + '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>'
    + '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>'
    + '</c:dLbls>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<c:roundedCorners val="0"/>'
    + '<c:chart>'
    + '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>'
    + '<a:rPr lang="es-ES" b="1" sz="1000"><a:latin typeface="Arial"/></a:rPr>'
    + `<a:t>${escXml(chart.title)}</a:t>`
    + '</a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>'
    + '<c:autoTitleDeleted val="0"/>'
    + '<c:plotArea><c:layout/>'
    + '<c:barChart>'
    + '<c:barDir val="col"/><c:grouping val="clustered"/>'
    + `<c:varyColors val="${chart.varyColors ? 1 : 0}"/>`
    + '<c:ser>'
    + '<c:idx val="0"/><c:order val="0"/>'
    + `<c:tx><c:v>${escXml(chart.seriesName ?? "Serie 1")}</c:v></c:tx>`
    + `<c:spPr><a:solidFill><a:srgbClr val="${CHART_COLOR}"/></a:solidFill></c:spPr>`
    + '<c:invertIfNegative val="0"/>'
    + dLbls
    + `<c:cat><c:strRef><c:f>${escXml(chart.catRef)}</c:f></c:strRef></c:cat>`
    + `<c:val><c:numRef><c:f>${escXml(chart.valRef)}</c:f></c:numRef></c:val>`
    + '</c:ser>'
    + '<c:gapWidth val="60"/>'
    + `<c:axId val="${ax1}"/><c:axId val="${ax2}"/>`
    + '</c:barChart>'
    + `<c:catAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling>`
    + '<c:delete val="0"/><c:axPos val="b"/>'
    + '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr>'
    + `<c:crossAx val="${ax2}"/><c:crosses val="autoZero"/><c:auto val="1"/>`
    + '<c:lblAlgn val="ctr"/><c:lblOffset val="100"/>'
    + '</c:catAx>'
    + `<c:valAx><c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/></c:scaling>`
    + '<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>'
    + '<c:numFmt formatCode="General" sourceLinked="1"/>'
    + '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr>'
    + `<c:crossAx val="${ax1}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>`
    + '</c:valAx>'
    + '</c:plotArea>'
    + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>'
    + '</c:chart>'
    + '</c:chartSpace>';
};

const buildDrawingXml = (charts) => {
  const anchors = charts.map((chart, i) => {
    const a = chart.anchor;
    return '<xdr:twoCellAnchor>'
      + `<xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>`
      + `<xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff>`
      + `<xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + '<xdr:graphicFrame macro="">'
      + `<xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/>`
      + '<xdr:cNvGraphicFramePr><a:graphicFrameLocks/></xdr:cNvGraphicFramePr></xdr:nvGraphicFramePr>'
      + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
      + '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
      + ` r:id="rId${i + 1}"/>`
      + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + anchors
    + '</xdr:wsDr>';
};

const getAttr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};

const unescapeXml = (value) => String(value)
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");

// Inyecta los graficos en el zip del xlsx: charts/*.xml, drawings/*.xml,
// rels y content types. sheetCharts: [{ sheetName, charts: [...] }].
const injectCharts = async (zip, sheetCharts) => {
  const plans = sheetCharts.filter((p) => p.charts.length > 0);
  if (plans.length === 0) return;

  const readText = (p) => zip.file(p).async("string");

  const wbXml = await readText("xl/workbook.xml");
  const wbRels = await readText("xl/_rels/workbook.xml.rels");

  const nameToRid = new Map();
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = getAttr(m[0], "name");
    const rid = getAttr(m[0], "r:id");
    if (name && rid) nameToRid.set(unescapeXml(name), rid);
  }
  const ridToTarget = new Map();
  for (const m of wbRels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = getAttr(m[0], "Id");
    const target = getAttr(m[0], "Target");
    if (id && target) ridToTarget.set(id, target);
  }

  let chartIndex = 0;
  let drawingIndex = 0;
  const contentTypeOverrides = [];

  for (const plan of plans) {
    const rid = nameToRid.get(plan.sheetName);
    if (!rid) throw new Error(`No se encontro la hoja "${plan.sheetName}" en workbook.xml.`);
    const target = ridToTarget.get(rid).replace(/^\//, "").replace(/^xl\//, "");
    const sheetPath = `xl/${target}`;
    const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf("/"));
    const sheetFile = sheetPath.slice(sheetPath.lastIndexOf("/") + 1);
    const sheetRelsPath = `${sheetDir}/_rels/${sheetFile}.rels`;

    drawingIndex += 1;
    const drawingName = `drawing${drawingIndex}.xml`;

    // Charts de esta hoja.
    const chartRels = [];
    for (const chart of plan.charts) {
      chartIndex += 1;
      const chartName = `chart${chartIndex}.xml`;
      zip.file(`xl/charts/${chartName}`, buildChartXml(chart));
      contentTypeOverrides.push(
        `<Override PartName="/xl/charts/${chartName}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      );
      chartRels.push(
        `<Relationship Id="rId${chartRels.length + 1}"`
        + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"'
        + ` Target="../charts/${chartName}"/>`,
      );
    }

    // Drawing + rels del drawing.
    zip.file(`xl/drawings/${drawingName}`, buildDrawingXml(plan.charts));
    zip.file(
      `xl/drawings/_rels/${drawingName}.rels`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + chartRels.join("")
      + "</Relationships>",
    );
    contentTypeOverrides.push(
      `<Override PartName="/xl/drawings/${drawingName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    );

    // Rels de la hoja: agregar la relacion al drawing.
    const relsFile = zip.file(sheetRelsPath);
    let nextRelNum = 1;
    let relsXml;
    if (relsFile) {
      relsXml = await relsFile.async("string");
      for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
        nextRelNum = Math.max(nextRelNum, parseInt(m[1], 10) + 1);
      }
    } else {
      relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    }
    const drawingRelId = `rId${nextRelNum}`;
    relsXml = relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${drawingRelId}"`
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"'
      + ` Target="../drawings/${drawingName}"/></Relationships>`,
    );
    zip.file(sheetRelsPath, relsXml);

    // Referencia al drawing dentro de la hoja.
    let sheetXml = await readText(sheetPath);
    if (!/<worksheet[^>]*xmlns:r=/.test(sheetXml)) {
      sheetXml = sheetXml.replace(
        /<worksheet /,
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
      );
    }
    sheetXml = sheetXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`);
    zip.file(sheetPath, sheetXml);
  }

  const contentTypes = await readText("[Content_Types].xml");
  zip.file("[Content_Types].xml", contentTypes.replace("</Types>", contentTypeOverrides.join("") + "</Types>"));
};

// Post-procesado del paquete xlsx: deduplicar estilos e inyectar graficos.
export const postProcessWorkbook = async (xlsxBuffer, sheetCharts) => {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  await optimizeStyles(zip);
  await injectCharts(zip, sheetCharts);
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
};

// ── Orquestacion ─────────────────────────────────────────────────────────────
export const buildWorkbook = async (cfg, base) => {
  axisIdCounter = 100000000; // ids de ejes deterministas por archivo
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

export const generateArtifacts = async (rawConfig) => {
  const cfg = normalizeConfig(rawConfig);
  const warnings = [...cfg.warnings];

  let base = null;
  let correlation = null;
  if (cfg.conDatos) {
    base = generateBaseData(cfg);
    correlation = computeCorrelation(base, cfg);
  }
  if (cfg.variables.length < 2) {
    warnings.push("Se genero con 1 sola variable: no aplica correlacion entre variables.");
  }

  // Liberar el DOM del workbook antes del post-procesado reduce el pico de
  // memoria (importante en contenedores de 512 MB).
  let built = await buildWorkbook(cfg, base);
  const { sheetCharts } = built;
  const plainBuffer = await built.workbook.outputAsync({ type: "nodebuffer" });
  built = null;
  const excelBuffer = await postProcessWorkbook(plainBuffer, sheetCharts);
  const baseCsv = buildBaseCsv(base, cfg);

  return { correlation, excelBuffer, baseCsv, warnings };
};

export const generateAndWriteFiles = async (config, opts = {}) => {
  const outputPath = opts.outputPath ? path.resolve(opts.outputPath) : DEFAULT_OUTPUT_PATH;
  const baseCsvPath = opts.baseCsvPath ? path.resolve(opts.baseCsvPath) : DEFAULT_BASE_CSV_PATH;

  const result = await generateArtifacts(config);
  fs.writeFileSync(outputPath, result.excelBuffer);
  fs.writeFileSync(baseCsvPath, result.baseCsv, "utf-8");

  return {
    correlation: result.correlation,
    warnings: result.warnings,
    outputPath,
    baseCsvPath,
  };
};
