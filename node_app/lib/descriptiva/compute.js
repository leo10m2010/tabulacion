// Estadistica descriptiva calculada por el sistema a partir de las filas
// crudas de datos_simulados. Nunca se usan agregados que venga a inventar la
// IA (ni puntaje_total ni clasificacion de las filas): todo se recalcula aqui
// para que el Excel sea internamente consistente si o si.
import { computeNiveles } from "../sheet-style.js";
import { multiColumnsOf } from "./validate.js";

const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

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
    const cols = multiColumnsOf(pregunta, rows[0]);
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
  };
};

// Puntaje por encuestado del baremo Likert: suma de los codigos 1..k de la
// opcion marcada en cada item del grupo, clasificada por los cortes.
export const computeLikertPuntajes = (likert, rows) => rows.map((row) => {
  let total = 0;
  for (const id of likert.itemIds) {
    total += likert.escala.indexOf(String(row[id])) + 1;
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

// ── Interpretaciones por plantilla (estilo lib/narratives.js) ────────────────

const sortShares = (labels, counts, total) => labels
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

export const narrativePregunta = (tablaN, texto, dist) => {
  const shares = sortShares(dist.labels, dist.counts, dist.N);
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
  const shares = sortShares(dist.labels, dist.counts, dist.N);
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
