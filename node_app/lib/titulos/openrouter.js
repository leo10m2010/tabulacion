// Cliente OpenRouter para el Generador de Titulos: UNA sola peticion a
// z-ai/glm-5.2 con la server tool openrouter:web_search (la ejecuta
// OpenRouter del lado de su servidor; no hay loop de tool_calls que manejar
// aqui). La salida es texto markdown, no JSON: no se usa response_format.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "z-ai/glm-5.2";

// Mensaje user base (sin el historial de reintento correctivo). Se exporta
// para que index.js pueda reconstruir el mismo mensaje al armar el historial
// completo (system + user original + assistant + user de correccion) cuando
// la verificacion de fuentes detecta antecedentes inventados.
export const buildBaseUserContent = () => "Genera los 3 títulos según los datos proporcionados. Tu respuesta debe "
  + "contener ÚNICAMENTE los tres títulos desarrollados según la plantilla, comenzando directamente "
  + "con **TÍTULO 1**. No narres tus búsquedas, no incluyas introducciones, resúmenes de "
  + "variables encontradas, comentarios ni despedidas.\n\n"
  + "IMPORTANTE - AUTENTICIDAD DE FUENTES: los antecedentes de cada título deben provenir "
  + "EXCLUSIVAMENTE de los resultados reales de la búsqueda web que realices; cita la URL "
  + "exactamente tal como aparece en el resultado de búsqueda, sin modificarla. Está PROHIBIDO "
  + "inventar o \"recordar\" autores, años, títulos de tesis o URLs que no hayan aparecido "
  + "efectivamente en los resultados de tus búsquedas. Si no encuentras suficientes antecedentes "
  + "reales, realiza más búsquedas adicionales en vez de completar con datos supuestos.";

const callOpenRouter = async ({
  messages, tools, model, apiKey, timeoutMs, maxTokens,
}) => {
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
        "X-Title": "TesisTab Generador de Titulos",
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        max_tokens: maxTokens,
        // Esfuerzo de razonamiento "medium": a diferencia de la tabulacion
        // descriptiva (tarea mecanica, effort "low"), aqui la IA debe
        // analizar resultados reales de busqueda y elegir variables con
        // respaldo teorico, asi que se le deja mas presupuesto de analisis.
        reasoning: { effort: "medium" },
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = payload?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`OpenRouter respondio con error: ${detail}`);
    }
    const choice = payload?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
    return {
      content,
      usage: payload?.usage ?? null,
      finishReason: choice?.finish_reason ?? choice?.native_finish_reason ?? "desconocido",
    };
  } finally {
    clearTimeout(timer);
  }
};

// Pide los 3 titulos desarrollados. `allowedDomains` es un array (con el
// dominio institucional resuelto) o null (se omite el filtro y se confia en
// que el prompt de sistema ya guía la busqueda). Si el contenido viene vacio
// se reintenta UNA vez (mismo criterio que la tabulacion descriptiva: un hipo
// del proveedor no debe matar el job).
export const requestTitulos = async ({ systemPrompt, allowedDomains, options = {} }) => {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY no esta configurada en el servidor.");
  }
  const model = options.model ?? process.env.OPENROUTER_MODEL_TITULOS ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs
    ?? Number.parseInt(process.env.OPENROUTER_TIMEOUT_MS ?? "600000", 10);
  // Salida corta (3 titulos desarrollados) pero se deja holgado: el
  // razonamiento y los resultados de busqueda tambien consumen presupuesto.
  const maxTokens = options.maxTokens
    ?? Number.parseInt(process.env.OPENROUTER_MAX_TOKENS_TITULOS ?? "24000", 10);

  const searchParameters = {
    engine: "auto",
    max_results: 6,
    max_total_results: 20,
    search_context_size: "medium",
  };
  if (allowedDomains) searchParameters.allowed_domains = allowedDomains;

  // messages/extraMessages permite al llamador (index.js) inyectar un
  // historial previo (system + user original + assistant con la respuesta
  // anterior + user con la correccion) para el reintento correctivo cuando la
  // verificacion de URLs detecta antecedentes inventados. Si no se pasa, se
  // arma el par system/user de siempre.
  const messages = Array.isArray(options.messages) && options.messages.length > 0
    ? options.messages
    : [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildBaseUserContent() },
    ];
  const tools = [{ type: "openrouter:web_search", parameters: searchParameters }];

  let lastFinishReason = "desconocido";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { content, usage, finishReason } = await callOpenRouter({
      messages, tools, model, apiKey, timeoutMs, maxTokens,
    });
    lastFinishReason = finishReason;
    // OpenRouter devuelve el conteo en server_tool_use_details (verificado en
    // produccion); se conserva server_tool_use como fallback por compatibilidad.
    const webSearchRequests = usage?.server_tool_use_details?.web_search_requests
      ?? usage?.server_tool_use?.web_search_requests
      ?? null;
    // Monitoreo de costo: Exa/Parallel cobran ~$4 por 1000 resultados.
    // eslint-disable-next-line no-console
    console.log(
      `[titulos] intento ${attempt}: finish_reason=${finishReason}, `
      + `web_search_requests=${webSearchRequests ?? "n/a"}, usage=${JSON.stringify(usage)}`,
    );
    if (content.trim()) {
      return { content: content.trim(), webSearchRequests };
    }
    // eslint-disable-next-line no-console
    console.error(`[titulos] intento ${attempt} sin contenido (finish_reason: ${finishReason}).`);
  }

  throw new Error(`OpenRouter no devolvio contenido tras el reintento (finish_reason: ${lastFinishReason}).`);
};
