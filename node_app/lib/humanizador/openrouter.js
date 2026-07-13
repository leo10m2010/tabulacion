// Cliente OpenRouter del Humanizador: dos tipos de llamada a GLM-5.2 —
// reescritura (pasada 1) y repasada dirigida (pasada 2) — ambas SIN
// herramienta de busqueda, con el razonamiento APAGADO (thinking binario de
// GLM) y temperatura ALTA (0.9): la tarea es producir variabilidad lexica,
// exactamente lo contrario de lo que una temperatura baja induce.
import { callOpenRouter, stripToolCallMarkup, DEFAULT_MODEL } from "../titulos/openrouter.js";
import { countWords } from "./metrics.js";

export const HUMANIZADOR_TEMPERATURE = 0.9;

const resolveCallConfig = (options = {}) => {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY no esta configurada en el servidor.");
  }
  const model = options.model ?? process.env.OPENROUTER_MODEL_HUMANIZADOR
    ?? process.env.OPENROUTER_MODEL_TITULOS ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs
    ?? Number.parseInt(process.env.OPENROUTER_TIMEOUT_MS ?? "600000", 10);
  // Un bloque de ~1000 palabras son ~1800 tokens de salida; 12k da holgura
  // amplia sin reasoning.
  const maxTokens = options.maxTokens
    ?? Number.parseInt(process.env.OPENROUTER_MAX_TOKENS_HUMANIZADOR ?? "12000", 10);
  return { apiKey, model, timeoutMs, maxTokens };
};

// Validacion comun de un intento: sin markup de tool_call, con contenido,
// sin placeholders y sin colapso de extension (un resumen al 30% o una
// ampliacion al triple son fallos de tarea, no de estilo). El ratio fino
// (0.7-1.3) lo controla checkFidelity en el orquestador.
const validateAttempt = (content, textoBase) => {
  const cleaned = stripToolCallMarkup(content);
  if (!cleaned) return { failure: "respuesta sin contenido util" };
  if (cleaned.includes("{{")) return { failure: "la respuesta contiene placeholders {{...}}" };
  const ratio = countWords(cleaned) / Math.max(1, countWords(textoBase));
  if (ratio < 0.5 || ratio > 2) {
    return { failure: `la extension de la respuesta colapso (ratio ${ratio.toFixed(2)})` };
  }
  return { cleaned };
};

// Bucle de 2 intentos con historial correctivo, compartido por ambas pasadas.
const requestWithRetry = async ({ messages, textoBase, label, options }) => {
  const { apiKey, model, timeoutMs, maxTokens } = resolveCallConfig(options);
  let lastFailure = "desconocido";
  let attemptMessages = messages;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { content, usage, finishReason } = await callOpenRouter({
      messages: attemptMessages,
      tools: undefined,
      model,
      apiKey,
      timeoutMs,
      maxTokens,
      reasoningEffort: "none",
      temperature: options.temperature ?? HUMANIZADOR_TEMPERATURE,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[humanizador] ${label} intento ${attempt}: finish_reason=${finishReason}, `
      + `usage=${JSON.stringify(usage)}`,
    );
    const { cleaned, failure } = validateAttempt(content, textoBase);
    if (cleaned) return cleaned;

    lastFailure = failure;
    // eslint-disable-next-line no-console
    console.error(
      `[humanizador] ${label} intento ${attempt} fallido (${failure}). Respuesta cruda:\n${String(content ?? "").slice(0, 1000)}`,
    );
    attemptMessages = [
      ...messages,
      ...(String(content ?? "").trim() ? [{ role: "assistant", content }] : []),
      {
        role: "user",
        content: `Tu respuesta anterior no fue válida (${failure}). Responde ÚNICAMENTE con el texto `
          + "completo reescrito, con una extensión similar a la del original (entre el 80% y el 120%), "
          + "sin comentarios, sin etiquetas y sin bloques de código.",
      },
    ];
  }
  throw new Error(`OpenRouter no devolvio la ${label} tras el reintento (${lastFailure}).`);
};

// Mensaje user de la pasada 1. Se exporta para que index.js reconstruya el
// historial del reintento de fidelidad.
export const buildReescrituraUserContent = (texto, contextoPrevio = null) => {
  const bloqueContexto = contextoPrevio
    ? "CONTEXTO PREVIO (últimas oraciones del fragmento anterior ya reescrito; SOLO como "
      + `referencia de continuidad, NO lo incluyas en tu respuesta):\n${contextoPrevio}\n\n`
    : "";
  return `${bloqueContexto}TEXTO A REESCRIBIR:\n\n${texto}`;
};

// Pasada 1: reescritura completa del bloque.
export const requestReescritura = async ({
  systemPrompt, texto, contextoPrevio = null, options = {},
}) => {
  const messages = Array.isArray(options.messages) && options.messages.length > 0
    ? options.messages
    : [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildReescrituraUserContent(texto, contextoPrevio) },
    ];
  return requestWithRetry({ messages, textoBase: texto, label: "reescritura", options });
};

// Formatea los problemas detectados por metrics.js para el mensaje user de
// la repasada. Solo se listan hallazgos concretos y accionables.
export const formatProblemas = (problemas) => {
  const lines = [];
  if (problemas.oracionesUniformes?.length > 0) {
    lines.push("Oraciones de longitud demasiado uniforme (fusiona unas con su vecina en oraciones "
      + "largas subordinadas y parte otras en frases cortas):");
    for (const oracion of problemas.oracionesUniformes) lines.push(`- "${oracion}"`);
  }
  if (problemas.delatoras?.length > 0) {
    lines.push("Frases delatoras de texto generado por IA (elimínalas o reformúlalas):");
    for (const { frase, veces } of problemas.delatoras) lines.push(`- "${frase}" (${veces} vez/veces)`);
  }
  if (problemas.conectoresRepetidos?.length > 0) {
    lines.push("Conectores repetidos al inicio de oración (varíalos o suprímelos):");
    for (const { frase, veces } of problemas.conectoresRepetidos) lines.push(`- "${frase}" (${veces} veces)`);
  }
  return lines.join("\n");
};

// Pasada 2: repasada dirigida SOLO sobre los problemas detectados.
export const requestRepasada = async ({
  systemPrompt, textoActual, problemas, options = {},
}) => {
  const userContent = `TEXTO ACTUAL:\n\n${textoActual}\n\nPROBLEMAS DETECTADOS:\n${formatProblemas(problemas)}`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
  return requestWithRetry({ messages, textoBase: textoActual, label: "repasada", options });
};
