// Cliente OpenRouter para la capa de decision de datos (GLM-5.2): arma los
// mensajes con el prompt maestro fijo como system, pide JSON, limpia la
// respuesta y reintenta UNA vez si el JSON no parsea o no pasa la validacion
// estructural. La IA nunca genera el Excel: solo el JSON de simulacion.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { metrics, providerUsageFields, structuredLog } from "../observability.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(SCRIPT_DIR, "..", "..", "prompts", "prompt_maestro_datos.md");

// El endpoint es sobreescribible por entorno. Se anadio para poder probar el
// control de concurrencia de los jobs contra un servidor lento local: sin
// esto, en pruebas la generacion falla en microsegundos por falta de clave y
// el job deja de estar activo antes de que llegue la segunda peticion, asi que
// no habia forma de ejercitar la carrera. Tambien sirve para apuntar a un
// proxy propio. En produccion no se define y vale el de siempre.
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL
  || "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "z-ai/glm-5.2";

// El archivo del prompt trae un preambulo de arquitectura y un bloque final
// "USER MESSAGE" que son documentacion para humanos; a la IA solo se le manda
// el bloque SYSTEM PROMPT (de "# SYSTEM PROMPT" hasta "# USER MESSAGE").
let cachedSystemPrompt = null;
export const loadSystemPrompt = () => {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const raw = fs.readFileSync(PROMPT_PATH, "utf-8");
  const start = raw.indexOf("# SYSTEM PROMPT");
  const end = raw.indexOf("# USER MESSAGE");
  cachedSystemPrompt = (start >= 0 && end > start ? raw.slice(start, end) : raw).trim();
  return cachedSystemPrompt;
};

// Quita fences de bloque de codigo (```json ... ```) y cualquier texto fuera
// del primer/ultimo brace, que algunos modelos agregan pese a pedir solo JSON.
export const stripCodeFences = (text) => {
  let out = String(text ?? "").trim();
  const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) out = fence[1].trim();
  const first = out.indexOf("{");
  const last = out.lastIndexOf("}");
  if (first > 0 || (last >= 0 && last < out.length - 1)) {
    if (first >= 0 && last > first) out = out.slice(first, last + 1);
  }
  return out;
};

const callOpenRouter = async ({ messages, model, apiKey, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://tesistab.vercel.app",
        "X-Title": "TesisTab Descriptiva",
      },
      body: JSON.stringify({
        model,
        messages,
        // Temperatura baja: maxima consistencia entre corridas.
        temperature: 0.4,
        // GLM-5.2 es un modelo razonador: sin tope explicito, el razonamiento
        // puede comerse el presupuesto de salida y dejar el JSON vacio o
        // truncado. Se fija un max_tokens holgado (el modelo soporta 131k) y
        // se limita el esfuerzo de razonamiento: la tarea es mecanica.
        max_tokens: Number.parseInt(process.env.OPENROUTER_MAX_TOKENS ?? "110000", 10),
        reasoning: { effort: "low" },
        response_format: { type: "json_object" },
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = payload?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`OpenRouter respondio con error: ${detail}`);
    }
    const choice = payload?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
    // El contenido vacio NO se lanza aqui: el caller lo trata como intento
    // fallido reintentable (un hipo del proveedor no debe matar el job).
    return {
      content,
      usage: payload?.usage ?? null,
      finishReason: choice?.finish_reason ?? choice?.native_finish_reason ?? "desconocido",
    };
  } finally {
    clearTimeout(timer);
  }
};

// Mensaje system con cache_control (formato de content-blocks de OpenRouter).
// TODO(cache): OpenRouter hoy solo aplica cache_control en proveedores tipo
// Anthropic/Gemini; para z-ai/glm-5.2 el marcador se ignora y se cobra precio
// normal. Se deja puesto para que el cache aplique solo cuando el proveedor
// lo soporte, sin cambiar codigo.
const buildSystemMessage = () => ({
  role: "system",
  content: [{ type: "text", text: loadSystemPrompt(), cache_control: { type: "ephemeral" } }],
});

// Pide el JSON de simulacion y lo devuelve parseado y validado. `validate`
// recibe el objeto y devuelve un array de errores (vacio = ok). Un solo
// reintento cubre tanto JSON invalido como estructura invalida.
export const requestSimulationJson = async ({ questionnaire, configLine, validate, options = {} }) => {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY no esta configurada en el servidor.");
  }
  const model = options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs
    ?? Number.parseInt(process.env.OPENROUTER_TIMEOUT_MS ?? "600000", 10);

  // El user message es unicamente el cuestionario; la configuracion (N,
  // nivel) va como linea final con el formato que el prompt maestro define.
  const userContent = configLine
    ? `${questionnaire}\n\n---\nConfiguración opcional: ${configLine}`
    : questionnaire;

  const attempts = [];
  let userMessage = userContent;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { content, usage, finishReason } = await callOpenRouter({
      messages: [buildSystemMessage(), { role: "user", content: userMessage }],
      model,
      apiKey,
      timeoutMs,
    });

    let data = null;
    let failure = null;
    if (!content.trim()) {
      failure = `respuesta sin contenido (finish_reason: ${finishReason})`;
    } else {
      const cleaned = stripCodeFences(content);
      try {
        data = JSON.parse(cleaned);
      } catch (err) {
        failure = `JSON.parse fallo: ${err.message} (finish_reason: ${finishReason})`;
      }
      if (data && validate) {
        const errors = validate(data);
        if (errors.length > 0) {
          failure = `Validacion estructural fallo: ${errors.join(" | ")}`;
          data = null;
        }
      }
    }

    attempts.push({ attempt, usage, failure, rawLength: content.length });
    if (data) {
      return { data, attempts };
    }

    metrics.increment("openrouter_invalid_responses_total", 1, {
      tool: "descriptiva", stage: "data",
    });
    structuredLog("warn", "openrouter.invalid_response", {
      tool: "descriptiva", stage: "data", attempt,
      responseLength: String(content ?? "").length,
      ...providerUsageFields(usage),
    });
    userMessage = `${userContent}\n\n---\nAVISO: tu respuesta anterior no fue un JSON valido o completo `
      + `(${failure}). Responde UNICAMENTE con el JSON descrito en el Paso 7, sin texto adicional, `
      + "sin backticks, con todas las preguntas y las N filas completas.";
  }

  const err = new Error("La IA no devolvio un JSON valido tras el reintento.");
  err.attempts = attempts;
  throw err;
};
