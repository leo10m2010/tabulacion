// Post-procesamiento programatico del Humanizador: aqui vive lo que un
// prompt solo no puede garantizar. Modulo PURO (sin IO ni IA, 100%
// testeable): separa oraciones en español, mide burstiness (variabilidad de
// longitud de oracion), cuenta frases delatoras de LLM y verifica la
// fidelidad del output (citas APA, cifras, extension) respecto del input.

// ── Conteo de palabras ──────────────────────────────────────────────────────
export const countWords = (text) => {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
};

// ── Separador de oraciones ──────────────────────────────────────────────────
// Estrategia de enmascarado + corte: los puntos que NO terminan oracion
// (parentesis con citas, decimales, abreviaturas) se sustituyen por
// caracteres de uso privado antes de cortar, y se restauran despues.
const MASK_DOT = "\uE001"; // punto que no termina oracion

// Abreviaturas frecuentes en texto academico en español. Orden: las
// compuestas primero para que "p." no se coma "p. ej.".
const ABBREVIATIONS = [
  "et al.", "p. ej.", "e. g.", "i. e.", "EE. UU.", "a. C.", "d. C.", "s. f.",
  "Dra.", "Dr.", "Mtro.", "Mtra.", "Mg.", "Ing.", "Lic.", "Prof.", "Sr.", "Sra.",
  "etc.", "vs.", "cf.", "cap.", "art.", "núm.", "no.", "pág.", "págs.", "pp.",
  "párr.", "Ed.", "Eds.", "ed.", "Vol.", "vol.", "fig.", "tab.", "aprox.",
  "máx.", "mín.", "S.A.", "p.",
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Una sola regex alternada de abreviaturas; al reemplazar se cambian TODOS
// sus puntos por la mascara ("p. ej." tiene dos).
const ABBREV_RE = new RegExp(
  `(?:${ABBREVIATIONS.map(escapeRegExp).join("|")})`,
  "g",
);

const maskDots = (text) => text
  // Parentesis completos: "(García, 2020, p. 45)" no debe cortar oracion.
  .replace(/\([^()]*\)/g, (m) => m.replace(/\./g, MASK_DOT))
  // Decimales "3.5" y "p < 0.05".
  .replace(/(\d)\.(?=\d)/g, `$1${MASK_DOT}`)
  // Abreviaturas de la lista cerrada.
  .replace(ABBREV_RE, (m) => m.replace(/\./g, MASK_DOT));

const unmaskDots = (text) => text.replace(new RegExp(MASK_DOT, "g"), ".");

// Separa el texto en oraciones. Los saltos de parrafo tambien cortan.
export const splitSentences = (text) => {
  const masked = maskDots(String(text ?? ""));
  const parts = masked
    // Corte por fin de oracion seguido de mayuscula/apertura/numero.
    .split(/(?<=[.?!…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“«(0-9])/u)
    // Los saltos de linea separan parrafos (y por lo tanto oraciones).
    .flatMap((part) => part.split(/\n+/));
  return parts
    .map((s) => unmaskDots(s).trim())
    .filter((s) => countWords(s) > 0);
};

// ── Burstiness ──────────────────────────────────────────────────────────────
export const CORTA_MAX = 8; // ≤8 palabras = frase corta
export const LARGA_MIN = 28; // ≥28 palabras = oracion larga
const BANDA_MIN = 15;
const BANDA_MAX = 22;

const round2 = (n) => Math.round(n * 100) / 100;

export const computeBurstiness = (sentences) => {
  const longitudes = sentences.map((s) => countWords(s));
  const n = longitudes.length;
  if (n === 0) {
    return {
      oraciones: 0, longitudes: [], media: 0, desviacion: 0, cv: 0,
      pctBanda1522: 0, cortas: 0, largas: 0,
    };
  }
  const media = longitudes.reduce((a, b) => a + b, 0) / n;
  const varianza = longitudes.reduce((acc, l) => acc + (l - media) ** 2, 0) / n;
  const desviacion = Math.sqrt(varianza);
  const enBanda = longitudes.filter((l) => l >= BANDA_MIN && l <= BANDA_MAX).length;
  return {
    oraciones: n,
    longitudes,
    media: round2(media),
    desviacion: round2(desviacion),
    cv: media > 0 ? round2(desviacion / media) : 0,
    pctBanda1522: round2((enBanda / n) * 100),
    cortas: longitudes.filter((l) => l <= CORTA_MAX).length,
    largas: longitudes.filter((l) => l >= LARGA_MIN).length,
  };
};

// Umbrales "sigue sonando a IA". Justificacion:
// - CV < 0.35: el texto LLM academico en español produce oraciones de 18-25
//   palabras con CV ~0.15-0.30 (la señal que explotan los detectores); la
//   prosa academica humana mezcla frases cortas asertivas con subordinadas
//   largas y ronda 0.45-0.70. 0.35 es un corte conservador alcanzable.
// - pctBanda1522 > 45: en texto LLM sin tratar, 60-80% de las oraciones cae
//   en la banda 15-22; en texto humano la distribucion es mucho mas plana.
// - Sin cortas o sin largas (bloques de ≥8 oraciones): codificacion literal
//   del requisito "mezclar frases de 3-8 palabras con otras de 25-35".
export const CV_MIN = 0.35;
export const BANDA_PCT_MAX = 45;

// Devuelve las fallas de burstiness y las oraciones "uniformes" (dentro de
// la banda 15-22) que la repasada dirigida debe atacar (maximo 10 para no
// inflar el prompt).
export const evaluateBurstiness = (sentences) => {
  const metrics = computeBurstiness(sentences);
  const fallas = [];
  if (metrics.oraciones === 0) return { metrics, fallas, oracionesUniformes: [] };
  if (metrics.cv < CV_MIN) fallas.push("cv_bajo");
  if (metrics.pctBanda1522 > BANDA_PCT_MAX) fallas.push("banda_uniforme");
  if (metrics.oraciones >= 8 && (metrics.cortas === 0 || metrics.largas === 0)) {
    fallas.push("sin_extremos");
  }
  const oracionesUniformes = fallas.length > 0
    ? sentences.filter((s) => {
      const l = countWords(s);
      return l >= BANDA_MIN && l <= BANDA_MAX;
    }).slice(0, 10)
    : [];
  return { metrics, fallas, oracionesUniformes };
};

// ── Banco de frases delatoras de LLM (español académico) ────────────────────
export const DELATORAS = [
  // Muletillas de enfasis
  "cabe destacar", "cabe señalar", "cabe mencionar", "cabe resaltar",
  "cabe precisar", "es importante señalar", "es importante destacar",
  "es importante mencionar", "es fundamental destacar", "es preciso señalar",
  "resulta crucial", "es crucial", "vale la pena mencionar",
  "sin lugar a dudas", "indudablemente", "resulta evidente que",
  // Metaforas tipicas de LLM
  "juega un papel crucial", "juega un papel fundamental", "desempeña un papel",
  "pilar fundamental", "piedra angular", "herramienta clave", "panorama",
  "abanico", "navegar", "sumergirse", "adentrarse", "un sinfín de",
  "una amplia gama", "una gran variedad de", "cobra relevancia",
  "cobra especial relevancia", "cobra vital importancia",
  // Marcos vacios
  "en el ámbito de", "en el marco de", "en la actualidad", "hoy en día",
  "a lo largo de la historia", "a lo largo del tiempo", "en la era de",
  "en un mundo cada vez más", "en aras de", "en la esfera de",
  // Cierres mecanicos
  "en resumen", "en conclusión", "en síntesis", "en definitiva",
  "en última instancia",
];

// \b no funciona con tildes en JS (á no es \w): se usan lookarounds Unicode.
const delatoraRegex = (frase) => new RegExp(
  `(?<!\\p{L})${escapeRegExp(frase)}(?!\\p{L})`,
  "giu",
);

const DELATORA_RES = DELATORAS.map((frase) => ({ frase, re: delatoraRegex(frase) }));

// Cuenta las delatoras presentes. Devuelve { total, detalle: [{frase, veces}] }
// con el detalle ordenado de mas a menos apariciones.
export const countDelatoras = (text) => {
  const raw = String(text ?? "");
  const detalle = [];
  let total = 0;
  for (const { frase, re } of DELATORA_RES) {
    re.lastIndex = 0;
    const matches = raw.match(re);
    if (matches && matches.length > 0) {
      detalle.push({ frase, veces: matches.length });
      total += matches.length;
    }
  }
  detalle.sort((a, b) => b.veces - a.veces);
  return { total, detalle };
};

// Conectores que el LLM cicla al inicio de oracion. En texto humano se
// alternan; >3 apariciones iniciales del MISMO conector en un bloque de
// ~1000 palabras es patron de maquina.
export const CONECTORES_INICIALES = [
  "sin embargo", "no obstante", "además", "asimismo", "por lo tanto",
  "por otro lado", "por otra parte", "en este sentido", "de esta manera",
  "de igual manera", "por ende",
];
export const CONECTOR_REPETIDO_MAX = 3;

export const countConectoresRepetidos = (sentences) => {
  const counts = new Map();
  for (const sentence of sentences) {
    const inicio = sentence.replace(/^[¿¡"“«(\s]+/u, "").toLowerCase();
    for (const conector of CONECTORES_INICIALES) {
      if (inicio.startsWith(conector)) {
        counts.set(conector, (counts.get(conector) ?? 0) + 1);
        break;
      }
    }
  }
  return [...counts.entries()]
    .filter(([, veces]) => veces > CONECTOR_REPETIDO_MAX)
    .map(([frase, veces]) => ({ frase, veces }));
};

// Umbral de delatoras: densidad > 3 por 1000 palabras.
export const DELATORAS_POR_MIL_MAX = 3;

// ── Fidelidad input → output ────────────────────────────────────────────────
const normalizeForMatch = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Citas parenteticas: "(García, 2020)", "(OMS, 2023, p. 4)", "(Ruiz, s. f.)",
// "(García y Pérez, 2021, pp. 10-12)".
const CITA_PARENTETICA_RE = /\(([^()]*?,\s*(?:\d{4}[a-z]?|s\.\s*f\.)(?:\s*,\s*p{1,2}\.\s*[\d\s.–—-]+)?)\)/gu;
// Citas narrativas: "García (2020)", "García y Pérez (2021)", "Díaz et al. (2019)".
const CITA_NARRATIVA_RE = /(?<!\p{L})([A-ZÁÉÍÓÚÑ][\p{L}'.-]*(?:\s+(?:y|e|&)\s+[A-ZÁÉÍÓÚÑ][\p{L}'.-]*)*(?:\s+et\s+al\.)?)\s*\((\d{4}[a-z]?|s\.\s*f\.)\)/gu;

// Extrae todas las citas APA del texto (tal como aparecen, normalizadas solo
// por espacios). Devuelve un array con repeticiones (comparacion multiconjunto).
export const extractCitations = (text) => {
  const raw = String(text ?? "");
  const citas = [];
  for (const match of raw.matchAll(CITA_PARENTETICA_RE)) {
    citas.push(normalizeForMatch(match[0]));
  }
  for (const match of raw.matchAll(CITA_NARRATIVA_RE)) {
    citas.push(normalizeForMatch(`${match[1]} (${match[2]})`));
  }
  return citas;
};

// Cifras fuera de las citas (los años de las citas se cubren aparte).
export const extractNumbers = (text) => {
  let raw = String(text ?? "");
  raw = raw.replace(CITA_PARENTETICA_RE, " ");
  raw = raw.replace(CITA_NARRATIVA_RE, "$1 ");
  return raw.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
};

const toMultiset = (items) => {
  const map = new Map();
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
  return map;
};

// Elementos del input que faltan (en cantidad) en el output.
const missingFrom = (inputItems, outputItems) => {
  const have = toMultiset(outputItems);
  const missing = [];
  for (const [item, needed] of toMultiset(inputItems)) {
    const available = have.get(item) ?? 0;
    if (available < needed) missing.push(item);
  }
  return missing;
};

export const RATIO_MIN = 0.7;
export const RATIO_MAX = 1.3;

// Verifica que el output preserve las citas APA, las cifras y una extension
// razonable (±30%) respecto del input. La comparacion de citas usa el texto
// normalizado por espacios del output completo (una cita narrativa puede
// haberse movido de lugar, pero debe seguir existiendo tal cual).
export const checkFidelity = (input, output) => {
  const outputNorm = normalizeForMatch(output);
  const citasInput = extractCitations(input);
  const citasOutput = extractCitations(output);
  // Primero multiconjunto de citas extraidas; el fallback de contencion en
  // el texto normalizado cubre citas que la regex del output no reconocio
  // por un cambio tipografico menor alrededor.
  const citasPerdidas = missingFrom(citasInput, citasOutput)
    .filter((cita) => !outputNorm.includes(cita));

  const cifrasPerdidas = missingFrom(extractNumbers(input), extractNumbers(output));

  const palabrasInput = countWords(input);
  const palabrasOutput = countWords(output);
  const ratioPalabras = palabrasInput > 0 ? round2(palabrasOutput / palabrasInput) : 0;
  const ratioOk = ratioPalabras >= RATIO_MIN && ratioPalabras <= RATIO_MAX;

  return {
    ok: citasPerdidas.length === 0 && cifrasPerdidas.length === 0 && ratioOk,
    citasPerdidas,
    cifrasPerdidas,
    ratioPalabras,
  };
};

// ── Fachada de analisis (serializable; viaja al frontend) ───────────────────
export const analyzeText = (text) => {
  const sentences = splitSentences(text);
  const b = computeBurstiness(sentences);
  const delatoras = countDelatoras(text);
  return {
    palabras: countWords(text),
    oraciones: b.oraciones,
    mediaPalabras: b.media,
    desviacion: b.desviacion,
    cv: b.cv,
    pctBanda1522: b.pctBanda1522,
    cortas: b.cortas,
    largas: b.largas,
    delatoras: delatoras.total,
    topDelatoras: delatoras.detalle.slice(0, 5),
  };
};

// Evaluacion completa de un bloque: burstiness + delatoras + conectores.
// Devuelve los problemas accionables para la repasada dirigida y cuantos
// umbrales fallo (para elegir entre pasadas).
export const evaluateTexto = (text) => {
  const sentences = splitSentences(text);
  const { metrics, fallas, oracionesUniformes } = evaluateBurstiness(sentences);
  const delatoras = countDelatoras(text);
  const conectoresRepetidos = countConectoresRepetidos(sentences);

  const palabras = countWords(text);
  const densidadDelatoras = palabras > 0 ? (delatoras.total / palabras) * 1000 : 0;
  const fallaDelatoras = densidadDelatoras > DELATORAS_POR_MIL_MAX || conectoresRepetidos.length > 0;

  const problemCount = fallas.length + (fallaDelatoras ? 1 : 0);
  return {
    metrics,
    problemCount,
    problemas: {
      fallasBurstiness: fallas,
      oracionesUniformes,
      delatoras: fallaDelatoras ? delatoras.detalle : [],
      conectoresRepetidos,
    },
  };
};
