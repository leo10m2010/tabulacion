// Orquestador del Humanizador: valida el input (texto o .docx, 50-3000
// palabras), trocea por parrafos en bloques de ~1000 palabras y, por bloque:
// pasada 1 (reescritura) -> verificacion de FIDELIDAD (citas APA, cifras,
// extension; si falla, un reintento correctivo; si persiste, el job falla) ->
// metricas de burstiness/delatoras -> si fallan umbrales, pasada 2 (repasada
// dirigida) -> se entrega la mejor pasada FIEL. La fidelidad es condicion de
// admision, no un criterio ponderable: una cita perdida invalida al candidato.
import { docxToMarkdown } from "../descriptiva/docx.js";
import { buildReescrituraSystemPrompt, buildRepasadaSystemPrompt } from "./prompt.js";
import {
  requestReescritura, requestRepasada, buildReescrituraUserContent,
} from "./openrouter.js";
import {
  countWords, splitSentences, checkFidelity, evaluateTexto, analyzeText,
} from "./metrics.js";
import { buildHumanizadorDocx } from "./docx.js";
import { errorLogFields, metrics, structuredLog } from "../observability.js";

export const MAX_PALABRAS = 3000;
export const MIN_PALABRAS = 50;
const TARGET_PALABRAS_BLOQUE = 1000;

// Error cuyo mensaje SI puede mostrarse al usuario final (validaciones de
// entrada detectadas dentro del job, p. ej. el conteo de palabras del .docx,
// que solo se conoce tras convertirlo). El handler del job lo distingue de
// los errores tecnicos, que llegan como mensaje generico.
const userError = (message) => {
  const err = new Error(message);
  err.isUserError = true;
  return err;
};

// texto XOR docxBase64 (mensajes calcados de descriptiva).
export const normalizeHumanizadorInput = (payload) => {
  const texto = String(payload?.texto ?? "").trim();
  const docxBase64 = String(payload?.docxBase64 ?? "").trim();
  if (!texto && !docxBase64) {
    throw new Error("Pega tu texto o sube un archivo .docx.");
  }
  if (texto && docxBase64) {
    throw new Error("Envia solo el texto pegado o solo el archivo .docx, no ambos.");
  }
  return { texto, docxBase64 };
};

// Trocea por parrafos (nunca a mitad de parrafo) acumulando hasta ~1000
// palabras por bloque. Un parrafo solitario mas largo va solo en su bloque.
export const splitIntoBloques = (texto) => {
  const parrafos = String(texto ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const bloques = [];
  let actual = [];
  let palabrasActual = 0;
  for (const parrafo of parrafos) {
    const palabras = countWords(parrafo);
    if (actual.length > 0 && palabrasActual + palabras > TARGET_PALABRAS_BLOQUE) {
      bloques.push(actual.join("\n\n"));
      actual = [];
      palabrasActual = 0;
    }
    actual.push(parrafo);
    palabrasActual += palabras;
  }
  if (actual.length > 0) bloques.push(actual.join("\n\n"));
  return bloques;
};

// Ultimas N oraciones de un texto (contexto de continuidad entre bloques).
const lastSentences = (texto, n = 2) => {
  const sentences = splitSentences(texto);
  return sentences.slice(-n).join(" ");
};

const buildFidelityCorrectionContent = (fidelity) => {
  const problemas = [];
  if (fidelity.citasPerdidas.length > 0) {
    problemas.push("Se perdieron o alteraron estas citas del texto original (deben aparecer INTACTAS, "
      + `carácter por carácter): ${fidelity.citasPerdidas.join("; ")}.`);
  }
  if (fidelity.cifrasPerdidas.length > 0) {
    problemas.push("Se perdieron o alteraron estas cifras del texto original (deben conservarse tal "
      + `cual): ${fidelity.cifrasPerdidas.join(", ")}.`);
  }
  if (fidelity.ratioPalabras < 0.7 || fidelity.ratioPalabras > 1.3) {
    problemas.push(`La extensión quedó en ${Math.round(fidelity.ratioPalabras * 100)}% del original; `
      + "debe quedar entre el 80% y el 120% (es una reescritura, no un resumen ni una ampliación).");
  }
  return `Tu reescritura anterior rompió la fidelidad del texto. ${problemas.join(" ")} `
    + "Corrige tu reescritura restituyendo exactamente esas citas y cifras donde corresponden y "
    + "ajustando la extensión, manteniendo el ritmo irregular y el léxico ya trabajados. Responde "
    + "ÚNICAMENTE con el texto completo corregido.";
};

// Procesa UN bloque: pasada 1 con verificacion de fidelidad (+1 reintento),
// y si las metricas siguen fallando, pasada 2 dirigida. Devuelve el texto
// final del bloque.
const humanizarBloque = async (bloque, indice, contextoPrevio, options) => {
  const reescrituraPrompt = buildReescrituraSystemPrompt();
  let pasada1 = await requestReescritura({
    systemPrompt: reescrituraPrompt,
    texto: bloque,
    contextoPrevio,
    options,
  });

  // Fidelidad de la pasada 1 (contra el bloque ORIGINAL). Si falla, UN
  // reintento correctivo con historial completo; si persiste, el job falla:
  // nunca se entrega texto con citas o cifras perdidas.
  let fidelity = checkFidelity(bloque, pasada1);
  if (!fidelity.ok) {
    metrics.increment("humanizer_fidelity_retries_total", 1);
    structuredLog("warn", "humanizer.fidelity_retry", {
      blockIndex: indice + 1,
      missingCitationCount: fidelity.citasPerdidas.length,
      missingNumberCount: fidelity.cifrasPerdidas.length,
      wordRatio: fidelity.ratioPalabras,
    });
    const correctionMessages = [
      { role: "system", content: reescrituraPrompt },
      { role: "user", content: buildReescrituraUserContent(bloque, contextoPrevio) },
      { role: "assistant", content: pasada1 },
      { role: "user", content: buildFidelityCorrectionContent(fidelity) },
    ];
    pasada1 = await requestReescritura({
      systemPrompt: reescrituraPrompt,
      texto: bloque,
      contextoPrevio,
      options: { ...options, messages: correctionMessages },
    });
    fidelity = checkFidelity(bloque, pasada1);
    if (!fidelity.ok) {
      throw new Error(
        `La reescritura del bloque ${indice + 1} perdio fidelidad tras el reintento `
        + `(citas perdidas: ${fidelity.citasPerdidas.join("; ") || "ninguna"}; `
        + `cifras perdidas: ${fidelity.cifrasPerdidas.join(", ") || "ninguna"}; `
        + `ratio: ${fidelity.ratioPalabras}).`,
      );
    }
  }

  const eval1 = evaluateTexto(pasada1);
  structuredLog("info", "humanizer.pass_evaluated", {
    blockIndex: indice + 1, pass: 1, cv: eval1.metrics.cv,
    bandPercent: eval1.metrics.pctBanda1522, problemCount: eval1.problemCount,
  });
  if (eval1.problemCount === 0) return pasada1;

  // Pasada 2 dirigida SOLO con los problemas concretos. Si rompe fidelidad
  // (contra el bloque original) se descarta y se entrega la pasada 1, que ya
  // demostro ser fiel. Entre pasadas fieles gana la de menos umbrales
  // fallados; empate -> mayor CV.
  // Inicializacion defensiva: si requestRepasada lanza, el catch devuelve la
  // pasada 1 sin llegar a leer esta variable.
  // eslint-disable-next-line no-useless-assignment
  let pasada2 = null;
  try {
    pasada2 = await requestRepasada({
      systemPrompt: buildRepasadaSystemPrompt(),
      textoActual: pasada1,
      problemas: eval1.problemas,
      options,
    });
  } catch (err) {
    structuredLog("warn", "humanizer.revision_failed", {
      blockIndex: indice + 1, fallbackPass: 1, ...errorLogFields(err),
    });
    return pasada1;
  }

  if (!checkFidelity(bloque, pasada2).ok) {
    structuredLog("warn", "humanizer.revision_fidelity_failed", {
      blockIndex: indice + 1, fallbackPass: 1,
    });
    return pasada1;
  }
  const eval2 = evaluateTexto(pasada2);
  structuredLog("info", "humanizer.pass_evaluated", {
    blockIndex: indice + 1, pass: 2, cv: eval2.metrics.cv,
    bandPercent: eval2.metrics.pctBanda1522, problemCount: eval2.problemCount,
  });
  if (eval2.problemCount < eval1.problemCount) return pasada2;
  if (eval2.problemCount === eval1.problemCount && eval2.metrics.cv > eval1.metrics.cv) return pasada2;
  return pasada1;
};

// Genera la humanizacion completa. Devuelve { textoHumanizado, metricas
// (antes/despues, serializable), docxBuffer }.
export const generateHumanizacion = async (payload, options = {}) => {
  const input = normalizeHumanizadorInput(payload);
  const texto = input.docxBase64 ? await docxToMarkdown(input.docxBase64) : input.texto;

  const palabras = countWords(texto);
  if (palabras < MIN_PALABRAS) {
    throw userError("El texto es demasiado corto; pega al menos un párrafo completo (mínimo 50 palabras).");
  }
  if (palabras > MAX_PALABRAS) {
    throw userError(
      `El texto tiene ${palabras.toLocaleString("es-PE")} palabras y el límite por corrida es `
      + `${MAX_PALABRAS.toLocaleString("es-PE")}. Divide tu capítulo en partes de hasta 3000 palabras `
      + "y humanízalas por separado.",
    );
  }

  const bloques = splitIntoBloques(texto);
  structuredLog("info", "humanizer.started", {
    wordCount: palabras, blockCount: bloques.length,
  });

  const bloquesFinales = [];
  for (let i = 0; i < bloques.length; i += 1) {
    const contextoPrevio = i > 0 ? lastSentences(bloquesFinales[i - 1]) : null;
    // Secuencial a proposito: el contexto de continuidad depende del bloque
    // anterior ya humanizado.
    bloquesFinales.push(await humanizarBloque(bloques[i], i, contextoPrevio, options));
  }

  const textoHumanizado = bloquesFinales.join("\n\n");
  const metricas = {
    antes: analyzeText(texto),
    despues: analyzeText(textoHumanizado),
  };
  structuredLog("info", "humanizer.completed", {
    cvBefore: metricas.antes.cv,
    cvAfter: metricas.despues.cv,
    bandPercentBefore: metricas.antes.pctBanda1522,
    bandPercentAfter: metricas.despues.pctBanda1522,
    markerCountBefore: metricas.antes.delatoras,
    markerCountAfter: metricas.despues.delatoras,
  });

  const docxBuffer = await buildHumanizadorDocx({ texto: textoHumanizado });

  return { textoHumanizado, metricas, docxBuffer };
};
