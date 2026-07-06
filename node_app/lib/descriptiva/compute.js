// Estadistica descriptiva calculada por el sistema a partir de las filas
// crudas de datos_simulados. Nunca se usan agregados que venga a inventar la
// IA (ni puntaje_total ni clasificacion de las filas): todo se recalcula aqui
// para que el Excel sea internamente consistente si o si.
import { computeNiveles } from "../sheet-style.js";
import { fmtPct, joinShares, sortShares } from "../narratives.js";
import { multiColumnsOf } from "./validate.js";

// Slug comparable: minusculas, sin tildes, no-alfanumerico -> _ (mismo espiritu
// que la abreviacion {id}__{opcion_abreviada} que pide el prompt).
const slugify = (text) => String(text).toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Empareja cada opcion de multirrespuesta con su columna binaria por similitud
// de slug: el orden de las claves del JSON de la IA NO esta garantizado, asi
// que confiar en la posicion puede cruzar etiquetas con conteos ajenos. Las
// opciones que no logran match caen al orden posicional restante.
export const pairMultiColumns = (pregunta, firstRow) => {
  const cols = multiColumnsOf(pregunta, firstRow);
  const sufijos = cols.map((c) => slugify(c.slice(pregunta.id.length + 2)));
  const usadas = new Set();
  const pareadas = pregunta.opciones.map((op) => {
    const slug = slugify(op);
    let mejor = -1;
    let mejorScore = 0;
    sufijos.forEach((suf, i) => {
      if (usadas.has(i) || !suf) return;
      let score = 0;
      if (suf === slug) score = 3;
      else if (slug.startsWith(suf) || suf.startsWith(slug)) score = 2;
      else if (slug.includes(suf) || suf.includes(slug)) score = 1;
      if (score > mejorScore) { mejorScore = score; mejor = i; }
    });
    if (mejor >= 0) { usadas.add(mejor); return cols[mejor]; }
    return null;
  });
  const restantes = cols.filter((_, i) => !usadas.has(i));
  let r = 0;
  return pareadas.map((c) => c ?? restantes[r++]);
};

// ── Distribuciones por pregunta ──────────────────────────────────────────────

// Numerica: valores distintos si son pocos; si no, intervalos iguales.
const numericDistribution = (pregunta, rows) => {
  const values = rows.map((r) => Number(r[pregunta.id]));
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length <= 12) {
    return {
      labels: distinct.map(String),
      counts: distinct.map((v) => values.filter((x) => x === v).length),
      criteria: distinct.map((v) => ({ min: v, max: v })),
    };
  }
  const min = distinct[0];
  const max = distinct[distinct.length - 1];
  const bins = 5;
  const width = Math.max(1, Math.ceil((max - min + 1) / bins));
  const labels = [];
  const counts = [];
  const criteria = [];
  for (let lo = min; lo <= max; lo += width) {
    const hi = Math.min(max, lo + width - 1);
    labels.push(lo === hi ? String(lo) : `${lo} – ${hi}`);
    counts.push(values.filter((x) => x >= lo && x <= hi).length);
    criteria.push({ min: lo, max: hi });
  }
  return { labels, counts, criteria };
};

// Distribucion de una pregunta: labels (en el orden del instrumento), counts
// y el porcentaje sobre N. En multirrespuesta el % es sobre encuestados (las
// marcas no suman 100%) y cada opcion cuenta sus 1s en su columna binaria.
export const distributionFor = (pregunta, rows) => {
  const N = rows.length;
  if (pregunta.tipo === "numerica") {
    const d = numericDistribution(pregunta, rows);
    return { ...d, N, multi: false, totalPct: 1 };
  }
  if (pregunta.tipo === "multirrespuesta") {
    const cols = pairMultiColumns(pregunta, rows[0]);
    const counts = cols.map((col) => rows.filter((r) => Number(r[col]) === 1).length);
    return {
      labels: pregunta.opciones.map(String),
      counts,
      columns: cols,
      N,
      multi: true,
      totalPct: null, // no aplica: cada encuestado puede marcar varias
    };
  }
  const labels = pregunta.opciones.map(String);
  return {
    labels,
    counts: labels.map((opt) => rows.filter((r) => String(r[pregunta.id]) === opt).length),
    N,
    multi: false,
    totalPct: 1,
  };
};

// ── Aspecto organico de la base ──────────────────────────────────────────────
// La IA genera filas con patrones mecanicos (alterna Masculino/Femenino fila
// por fila, cicla grados...) y repartos exactamente parejos (30/30), que es lo
// primero que delata una base inventada. Se baraja el orden de las filas y se
// rompen los empates perfectos en preguntas independientes re-sorteando una
// fraccion pequeña segun los pesos declarados. Nunca se tocan: el ancla, las
// preguntas con dependencias (en cualquier direccion), ni las que tienen
// puntos o respuesta correcta (cambiarian puntajes/aciertos).

const esIndependientePura = (p, preguntas) => (p.tipo === "nominal_unica" || p.tipo === "ordinal_unica")
  && Array.isArray(p.opciones) && p.opciones.length >= 2
  && !p.es_ancla && !p.depende_de
  && !preguntas.some((q) => q.depende_de === p.id)
  && !Array.isArray(p.puntos_por_opcion)
  && (p.respuesta_correcta === undefined || p.respuesta_correcta === null || p.respuesta_correcta === "");

const pickWeighted = (opciones, pesos) => {
  const w = Array.isArray(pesos) && pesos.length === opciones.length ? pesos.map(Number) : opciones.map(() => 1);
  const total = w.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
  let r = Math.random() * (total || opciones.length);
  for (let i = 0; i < opciones.length; i += 1) {
    r -= Number.isFinite(w[i]) && w[i] > 0 ? w[i] : 1;
    if (r <= 0) return String(opciones[i]);
  }
  return String(opciones[opciones.length - 1]);
};

export const organicizeRows = (data) => {
  const rows = data.datos_simulados;

  // 1) Barajar las filas (Fisher-Yates): rompe la alternacion visible y
  // dispersa los perfiles duplicados que agrega la reconciliacion.
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  // 2) Romper repartos sospechosamente parejos (max-min <= 1 entre todas las
  // categorias) en las preguntas independientes puras.
  for (const p of data.preguntas) {
    if (!esIndependientePura(p, data.preguntas)) continue;
    const counts = () => p.opciones.map((op) => rows.filter((r) => String(r[p.id]) === String(op)).length);
    let c = counts();
    if (Math.max(...c) - Math.min(...c) > 1) continue;

    const rerolls = Math.max(2, Math.round(rows.length * 0.08));
    for (let k = 0; k < rerolls; k += 1) {
      const row = rows[Math.floor(Math.random() * rows.length)];
      row[p.id] = pickWeighted(p.opciones, p.pesos);
    }
    // Garantia: si el azar volvio a dejarlo parejo, mueve una respuesta.
    c = counts();
    if (Math.max(...c) - Math.min(...c) <= 1) {
      const desde = String(p.opciones[c.indexOf(Math.max(...c))]);
      const hacia = p.opciones.map(String).find((op) => op !== desde);
      const row = rows.find((r) => String(r[p.id]) === desde);
      if (row && hacia) row[p.id] = hacia;
    }
  }
};

// ── Capa condicional (baremo) ────────────────────────────────────────────────

export const classify = (baremo, value) => {
  const rango = baremo.rangos.find((r) => value >= Number(r.min) && value <= Number(r.max));
  return rango ? String(rango.categoria) : "Sin clasificar";
};

// Recalcula por encuestado el puntaje total (suma de puntos de la opcion
// marcada en cada pregunta con puntos_por_opcion) y su categoria de baremo.
export const computePuntajes = (preguntas, rows, baremo) => {
  const conPuntos = preguntas.filter(
    (p) => Array.isArray(p.puntos_por_opcion) && p.opciones && p.tipo !== "multirrespuesta",
  );
  return rows.map((row) => {
    let total = 0;
    for (const p of conPuntos) {
      const idx = p.opciones.map(String).indexOf(String(row[p.id]));
      if (idx >= 0) total += Number(p.puntos_por_opcion[idx]) || 0;
    }
    return { puntaje_total: total, clasificacion: classify(baremo, total) };
  });
};

// Recalcula aciertos y % de aciertos comparando contra respuesta_correcta.
export const computeAciertos = (preguntas, rows, baremo) => {
  const conCorrecta = preguntas.filter(
    (p) => p.respuesta_correcta !== undefined && p.respuesta_correcta !== null && p.respuesta_correcta !== "",
  );
  const total = conCorrecta.length;
  return rows.map((row) => {
    const aciertos = conCorrecta.filter((p) => String(row[p.id]) === String(p.respuesta_correcta)).length;
    const pct = total > 0 ? Math.round((aciertos / total) * 100) : 0;
    return { aciertos, porcentaje_aciertos: pct, clasificacion: classify(baremo, pct) };
  });
};

// ── Baremo generado por el sistema (EXCLUSIVO para escala Likert) ────────────

export const NIVELES_LIKERT = ["Bajo", "Medio", "Alto"];
const MIN_ITEMS_LIKERT = 3;
const MIN_CATEGORIAS_LIKERT = 3;

// El baremo propio del sistema va UNICAMENTE cuando el cuestionario es
// medible con una escala ordinal tipo Likert:
// - Si el instrumento ya trae su propia escala de medicion (puntaje_sumado o
//   conocimiento), NO se genera baremo: manda la del instrumento.
// - Se exige un grupo de items ordinales que compartan la MISMA escala, con
//   3 o mas categorias. Con escalas dicotomicas (Si/No, 2 opciones),
//   nominales o items sueltos esta prohibido generar baremo.
// Devuelve null cuando no corresponde.
export const detectLikertBaremo = (data) => {
  if (data.metadata.tipo_instrumento !== "independiente" || data.baremo) return null;
  const traePropia = data.preguntas.some(
    (p) => Array.isArray(p.puntos_por_opcion)
      || (p.respuesta_correcta !== undefined && p.respuesta_correcta !== null && p.respuesta_correcta !== ""),
  );
  if (traePropia) return null;

  const ordinales = data.preguntas.filter(
    (p) => p.tipo === "ordinal_unica" && Array.isArray(p.opciones) && p.opciones.length >= MIN_CATEGORIAS_LIKERT,
  );
  if (ordinales.length < MIN_ITEMS_LIKERT) return null;

  // Grupo mayoritario de items con escala identica (misma lista de opciones).
  const grupos = new Map();
  for (const p of ordinales) {
    const key = p.opciones.map(String).join("¦");
    grupos.set(key, [...(grupos.get(key) ?? []), p]);
  }
  const items = [...grupos.values()].sort((a, b) => b.length - a.length)[0];
  if (items.length < MIN_ITEMS_LIKERT) return null;

  const escala = items[0].opciones.map(String);
  const niveles = computeNiveles(items.length, 1, escala.length, NIVELES_LIKERT);
  return {
    variable_base: "puntaje_total",
    rangos: niveles.map((n) => ({ min: n.min, max: n.max, categoria: n.nombre })),
    generado: true,
    itemIds: items.map((p) => p.id),
    escala,
    invertida: esEscalaDescendente(escala),
  };
};

// Anclas tipicas de intensidad para detectar la direccion de la escala. Si el
// instrumento lista las opciones de mayor a menor (Siempre -> Nunca), los
// codigos se invierten para que puntaje alto = mayor intensidad; si no, el
// baremo Bajo/Medio/Alto saldria al reves.
const ANCLAS_ALTAS = ["siempre", "totalmente de acuerdo", "muy de acuerdo", "mucho", "muy alto", "muy bueno", "excelente", "muy frecuentemente", "muy satisfecho"];
const ANCLAS_BAJAS = ["nunca", "jamas", "totalmente en desacuerdo", "muy en desacuerdo", "nada", "muy bajo", "muy malo", "deficiente", "muy insatisfecho"];
const esAncla = (opcion, anclas) => {
  const s = slugify(opcion).replace(/_/g, " ");
  return anclas.some((a) => s === a || s.startsWith(`${a} `));
};
const esEscalaDescendente = (escala) => esAncla(escala[0], ANCLAS_ALTAS) && esAncla(escala[escala.length - 1], ANCLAS_BAJAS);

// Puntaje por encuestado del baremo Likert: suma de los codigos 1..k de la
// opcion marcada en cada item del grupo (invertidos si la escala esta listada
// de mayor a menor), clasificada por los cortes.
export const computeLikertPuntajes = (likert, rows) => rows.map((row) => {
  let total = 0;
  for (const id of likert.itemIds) {
    const idx = likert.escala.indexOf(String(row[id]));
    total += likert.invertida ? likert.escala.length - idx : idx + 1;
  }
  return { puntaje_total: total, clasificacion: classify(likert, total) };
});

// Distribucion del baremo: frecuencia de cada categoria en el orden de los
// rangos declarados (asi el grafico respeta el orden bajo->alto).
export const baremoDistribution = (baremo, computedRows) => {
  const labels = baremo.rangos.map((r) => String(r.categoria));
  return {
    labels,
    counts: labels.map((cat) => computedRows.filter((c) => c.clasificacion === cat).length),
    N: computedRows.length,
  };
};

// ── Interpretaciones por plantilla (helpers compartidos de narratives.js) ────

export const narrativePregunta = (tablaN, texto, dist) => {
  const shares = sortShares(dist.counts, dist.labels, dist.N);
  if (dist.multi) {
    const top = shares.filter((s) => s.count > 0).slice(0, 3)
      .map((s) => `"${s.label}" (${fmtPct(s.share)})`).join(", ");
    return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan los resultados de la pregunta "${texto}", `
      + `de opcion multiple, aplicada a los ${dist.N} encuestados: las opciones mas marcadas fueron ${top}. `
      + `Los porcentajes se calculan sobre el total de encuestados, por lo que no suman 100%.`;
  }
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan los resultados de la pregunta "${texto}", `
    + `aplicada a los ${dist.N} encuestados: ${joinShares(shares, "respondió")}. `
    + `Por todo ello, la tendencia predominante es "${shares[0].label}".`;
};

export const narrativeBaremo = (tablaN, tipo, titulo, dist) => {
  const shares = sortShares(dist.counts, dist.labels, dist.N);
  const seguido = shares.slice(1).filter((s) => s.count > 0)
    .map((s) => `"${s.label}" con el ${fmtPct(s.share)}`)
    .join(" y ");
  const base = tipo === "conocimiento"
    ? `el nivel alcanzado segun el porcentaje de aciertos`
    : tipo === "likert"
      ? `el nivel general de la variable segun el puntaje sumado de la escala Likert`
      : `la clasificacion segun el puntaje total del instrumento`;
  const cierre = tipo === "likert"
    ? `El baremo fue construido por el sistema con intervalos equivalentes sobre la escala ordinal del instrumento.`
    : `La distribucion corresponde a los rangos definidos en el baremo del instrumento.`;
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se presenta ${base} (${titulo}): `
    + `predomina la categoria "${shares[0].label}" con el ${fmtPct(shares[0].share)} de los ${dist.N} encuestados`
    + `${seguido ? `, seguida de ${seguido}` : ""}. ${cierre}`;
};
