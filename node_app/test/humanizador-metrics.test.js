// Pruebas del post-procesamiento programatico del Humanizador (metrics.js)
// y del troceo por parrafos (index.js). Modulos puros, sin IA ni red.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  splitSentences, computeBurstiness, evaluateBurstiness, countDelatoras,
  countConectoresRepetidos, checkFidelity, extractCitations, analyzeText,
  evaluateTexto, countWords,
} from "../lib/humanizador/metrics.js";
import { splitIntoBloques, normalizeHumanizadorInput } from "../lib/humanizador/index.js";

// ── splitSentences ──────────────────────────────────────────────────────────
test("splitSentences no corta en abreviaturas, decimales ni citas", () => {
  const texto = "El Dr. García demostró un incremento de 3.5% (p. ej., en obreros). "
    + "Según García et al. (2020), la brecha persiste. Fin del análisis.";
  const sentences = splitSentences(texto);
  assert.equal(sentences.length, 3);
  assert.ok(sentences[0].includes("Dr. García"));
  assert.ok(sentences[0].includes("3.5%"));
  assert.ok(sentences[0].includes("(p. ej., en obreros)"));
  assert.ok(sentences[1].includes("et al. (2020)"));
});

test("splitSentences corta en saltos de parrafo y signos ?!", () => {
  const texto = "¿Cuál es la relación?\n\nNo se sabe. Hay indicios claros.";
  const sentences = splitSentences(texto);
  assert.equal(sentences.length, 3);
});

test("splitSentences protege el punto de una cita parentetica con pagina", () => {
  const texto = "La gestión mejora la calidad (García, 2020, p. 45). Otra oración cierra el párrafo.";
  const sentences = splitSentences(texto);
  assert.equal(sentences.length, 2);
  assert.ok(sentences[0].endsWith("(García, 2020, p. 45)."));
});

// ── burstiness ──────────────────────────────────────────────────────────────
const oracionDe = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");

test("computeBurstiness detecta uniformidad (10 oraciones de 18 palabras)", () => {
  const sentences = Array.from({ length: 10 }, () => oracionDe(18));
  const m = computeBurstiness(sentences);
  assert.equal(m.oraciones, 10);
  assert.equal(m.media, 18);
  assert.ok(m.cv < 0.1);
  assert.equal(m.pctBanda1522, 100);
  assert.equal(m.cortas, 0);
  assert.equal(m.largas, 0);
});

test("evaluateBurstiness falla el texto uniforme y lista oraciones de la banda", () => {
  const sentences = Array.from({ length: 10 }, () => oracionDe(18));
  const { fallas, oracionesUniformes } = evaluateBurstiness(sentences);
  assert.ok(fallas.includes("cv_bajo"));
  assert.ok(fallas.includes("banda_uniforme"));
  assert.ok(fallas.includes("sin_extremos"));
  assert.equal(oracionesUniformes.length, 10);
});

test("evaluateBurstiness aprueba texto con ritmo variado", () => {
  const sentences = [
    oracionDe(4), oracionDe(30), oracionDe(9), oracionDe(28), oracionDe(5),
    oracionDe(24), oracionDe(12), oracionDe(33), oracionDe(6), oracionDe(17),
  ];
  const { fallas } = evaluateBurstiness(sentences);
  assert.deepEqual(fallas, []);
});

// ── delatoras y conectores ──────────────────────────────────────────────────
test("countDelatoras encuentra frases con tildes y sin ellas", () => {
  const texto = "Cabe destacar que hoy en día el panorama educativo cambió. "
    + "En conclusión, cabe destacar la brecha.";
  const { total, detalle } = countDelatoras(texto);
  assert.equal(total, 5);
  const cabeDestacar = detalle.find((d) => d.frase === "cabe destacar");
  assert.equal(cabeDestacar.veces, 2);
});

test("countDelatoras no marca palabras contenidas en otras", () => {
  // "panorama" delatora, pero "panoramas" es otra palabra (lookahead \p{L}).
  const { total } = countDelatoras("Los panoramas amplios no cuentan.");
  assert.equal(total, 0);
});

test("countConectoresRepetidos marca un conector inicial usado mas de 3 veces", () => {
  const sentences = [
    "Además, el primer punto.", "Además, el segundo punto.",
    "Además, el tercer punto.", "Además, el cuarto punto.",
    "Sin embargo, algo distinto.",
  ];
  const repetidos = countConectoresRepetidos(sentences);
  assert.equal(repetidos.length, 1);
  assert.equal(repetidos[0].frase, "además");
  assert.equal(repetidos[0].veces, 4);
});

// ── fidelidad ───────────────────────────────────────────────────────────────
const original = "La gestión administrativa incide en la satisfacción (García, 2020, p. 45). "
  + "Pérez y Díaz (2021) hallaron un 45,3% de aprobación en 120 trabajadores. "
  + "El efecto se confirmó (MINSA, 2023).";

test("extractCitations reconoce citas parenteticas y narrativas", () => {
  const citas = extractCitations(original);
  assert.ok(citas.includes("(García, 2020, p. 45)"));
  assert.ok(citas.includes("(MINSA, 2023)"));
  assert.ok(citas.includes("Pérez y Díaz (2021)"));
});

test("checkFidelity aprueba una reescritura fiel", () => {
  const reescrito = "En la satisfacción incide, de manera directa, la gestión administrativa "
    + "(García, 2020, p. 45). Un 45,3% de aprobación hallaron Pérez y Díaz (2021) entre 120 "
    + "trabajadores. Se confirmó el efecto (MINSA, 2023).";
  const f = checkFidelity(original, reescrito);
  assert.equal(f.ok, true);
  assert.deepEqual(f.citasPerdidas, []);
  assert.deepEqual(f.cifrasPerdidas, []);
});

test("checkFidelity detecta cita perdida y cifra perdida", () => {
  const infiel = "La gestión administrativa incide en la satisfacción. "
    + "Pérez y Díaz (2021) hallaron una alta aprobación en 120 trabajadores. "
    + "El efecto se confirmó (MINSA, 2023).";
  const f = checkFidelity(original, infiel);
  assert.equal(f.ok, false);
  assert.ok(f.citasPerdidas.includes("(García, 2020, p. 45)"));
  assert.ok(f.cifrasPerdidas.includes("45,3%"));
});

test("checkFidelity falla si la extension colapsa (resumen)", () => {
  const resumen = "La gestión incide (García, 2020, p. 45). Pérez y Díaz (2021): 45,3% en 120. Confirmado (MINSA, 2023).";
  const f = checkFidelity(original, resumen);
  assert.equal(f.ok, false);
  assert.ok(f.ratioPalabras < 0.7);
});

// ── analyzeText / evaluateTexto ─────────────────────────────────────────────
test("analyzeText devuelve el resumen serializable", () => {
  const a = analyzeText(original);
  assert.equal(typeof a.palabras, "number");
  assert.equal(typeof a.cv, "number");
  assert.ok(Array.isArray(a.topDelatoras));
});

test("evaluateTexto reporta delatoras cuando la densidad supera el umbral", () => {
  const texto = "Cabe destacar el punto. Es importante señalar el detalle. "
    + "Hoy en día todo cambió. En resumen, nada quedó igual.";
  const { problemCount, problemas } = evaluateTexto(texto);
  assert.ok(problemCount >= 1);
  assert.ok(problemas.delatoras.length > 0);
});

// ── splitIntoBloques / normalize ────────────────────────────────────────────
test("splitIntoBloques agrupa parrafos sin partirlos (~1000 palabras)", () => {
  const parrafo400 = oracionDe(400);
  const texto = [parrafo400, parrafo400, parrafo400, parrafo400, parrafo400, parrafo400].join("\n\n");
  const bloques = splitIntoBloques(texto);
  assert.equal(bloques.length, 3); // 2 parrafos de 400 por bloque (800 ≤ 1000 < 1200)
  for (const bloque of bloques) {
    assert.equal(countWords(bloque), 800);
  }
});

test("splitIntoBloques deja solo un parrafo gigante en su propio bloque", () => {
  const texto = [oracionDe(1500), oracionDe(100)].join("\n\n");
  const bloques = splitIntoBloques(texto);
  assert.equal(bloques.length, 2);
});

test("normalizeHumanizadorInput exige texto XOR docx", () => {
  assert.throws(() => normalizeHumanizadorInput({}), /Pega tu texto/);
  assert.throws(() => normalizeHumanizadorInput({ texto: "a", docxBase64: "b" }), /no ambos/);
  assert.deepEqual(normalizeHumanizadorInput({ texto: " hola " }), { texto: "hola", docxBase64: "" });
});
