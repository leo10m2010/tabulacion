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
//
// `repositoryDomain` (opcional) es el dominio verificado del repositorio de
// la universidad del cliente: se pasa como PISTA en el texto, NO como
// allowed_domains. Razon (verificada en la doc de OpenRouter y en un fallo de
// produccion): allowed_domains aplica a TODAS las busquedas del request, y
// restringir a repositorios peruanos hace imposible encontrar los 5
// antecedentes internacionales que exige la plantilla — el modelo busca en
// vano una y otra vez hasta agotar el tope de resultados o glitchear.
export const buildBaseUserContent = (repositoryDomain = null, datos = null, searchContext = null) => {
  // Los datos del cliente viven aqui (mensaje user), no en el system prompt:
  // el system queda estatico y cacheable entre solicitudes.
  const bloqueDatos = datos
    ? "DATOS DEL ESTUDIANTE:\n"
      + `- Universidad: ${datos.universidad}\n`
      + `- Carrera: ${datos.carrera}\n`
      + `- Lugar (usar EXACTAMENTE así): ${datos.lugar}\n`
      + `- Número de variables: ${datos.numeroVariables} `
      + `(${datos.numeroVariables === "2" ? "correlacional, Plantilla A" : "descriptiva univariable, Plantilla B"})\n`
      + `- Año: ${datos.anio}\n\n`
    : "";
  const pistaRepositorio = repositoryDomain
    ? `\n\nDATO VERIFICADO: el repositorio institucional de la universidad del estudiante es `
      + `https://${repositoryDomain} — prioriza ese dominio en tus búsquedas de tesis de esa universidad `
      + "(por ejemplo incluyendo el dominio o el nombre de la universidad en la consulta)."
    : "";
  // Con pre-busqueda del sistema (Brave/Firecrawl), el modelo trabaja
  // primero sobre resultados ya obtenidos y solo busca lo que falte (pocas
  // busquedas => menos costo OpenRouter y menos riesgo de glitch). Sin
  // pre-busqueda, aplica el plan de busqueda completo de siempre.
  const bloqueResultados = searchContext
    ? "RESULTADOS DE BÚSQUEDA DEL SISTEMA (obtenidos en tiempo real de motores de búsqueda; "
      + "estas URLs son reales):\n\n" + searchContext + "\n\n"
    : "";
  const planBusqueda = searchContext
    ? "PLAN DE BÚSQUEDA: usa PRIMERO los RESULTADOS DE BÚSQUEDA DEL SISTEMA de arriba como fuente "
      + "principal para identificar las variables más investigadas y para citar los antecedentes. "
      + "Solo si te falta información concreta (p. ej. no alcanzan los antecedentes internacionales) "
      + "realiza búsquedas adicionales con la herramienta, MÁXIMO 4. Los antecedentes internacionales "
      + "deben ser trabajos de instituciones extranjeras: una tesis de una universidad peruana NO "
      + "cuenta como internacional aunque estudie otro país. Cuando tengas suficiente información, "
      + "DEJA de buscar y redacta la respuesta completa."
    : "PLAN DE BÚSQUEDA (máximo 10 búsquedas en total): usa ~3 búsquedas para tesis de la "
      + "universidad y carrera del estudiante, ~3 para trabajos nacionales en ALICIA/RENATI u otros "
      + "repositorios peruanos, y ~3 para los antecedentes internacionales en fuentes de OTROS países "
      + "(SciELO, Redalyc, Dialnet o repositorios universitarios de Ecuador, Colombia, México, Chile, "
      + "Argentina o España). Los antecedentes internacionales deben ser trabajos de instituciones "
      + "extranjeras: una tesis de una universidad peruana NO cuenta como internacional aunque estudie "
      + "otro país. Cuando tengas suficiente información, DEJA de buscar y redacta la respuesta completa.";
  return bloqueDatos
  + bloqueResultados
  + "Genera los 3 títulos según los datos proporcionados. Tu respuesta debe "
  + "contener ÚNICAMENTE los tres títulos desarrollados según la plantilla, comenzando directamente "
  + "con **TÍTULO 1**. No narres tus búsquedas, no incluyas introducciones, resúmenes de "
  + "variables encontradas, comentarios ni despedidas. Nunca escribas etiquetas como <tool_call>, "
  + "<arg_key> o <arg_value> ni ninguna sintaxis de llamadas a herramientas dentro del texto de tu "
  + "respuesta: ejecuta las búsquedas con la herramienta de forma nativa y entrega solo el resultado final."
  + pistaRepositorio
  + "\n\n" + planBusqueda + "\n\n"
  + "IMPORTANTE - AUTENTICIDAD DE FUENTES: los antecedentes de cada título deben provenir "
  + "EXCLUSIVAMENTE de los resultados reales de la búsqueda web que realices; cita la URL "
  + "exactamente tal como aparece en el resultado de búsqueda, sin modificarla. Está PROHIBIDO "
  + "inventar o \"recordar\" autores, años, títulos de tesis o URLs que no hayan aparecido "
  + "efectivamente en los resultados de tus búsquedas. Si no encuentras suficientes antecedentes "
  + "reales, realiza más búsquedas adicionales en vez de completar con datos supuestos.";
};

// GLM-5.2 a veces "filtra" sus llamadas a herramientas como texto plano en el
// contenido (<tool_call>openrouter_web_search<arg_key>query</arg_key>
// <arg_value>...</arg_value></tool_call>) en lugar de ejecutarlas. Ese markup
// jamas debe llegar al cliente final: se elimina por completo (bloques
// cerrados, un bloque final sin cerrar y etiquetas sueltas) y, si tras
// eliminarlo no queda una respuesta valida, el intento se trata como fallido.
export const stripToolCallMarkup = (text) => String(text ?? "")
  .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
  .replace(/<tool_call>[\s\S]*$/gi, "")
  .replace(/<\/?(?:tool_call|arg_key|arg_value)>/gi, "")
  .trim();

// Marcador tolerante del primer titulo (con o sin espacios, con o sin tilde).
// Una respuesta sin este marcador no contiene los titulos pedidos y se trata
// como intento fallido (nunca se entrega basura al cliente final).
export const TITULO_MARKER_RE = /\*\*\s*T[IÍí]TULO\s*1/i;

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
        // Temperatura moderada-baja: menos variabilidad entre corridas y
        // menor probabilidad de desvios de formato (tool_calls como texto,
        // narracion), sin matar la redaccion academica.
        temperature: 0.5,
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

// Pide los 3 titulos desarrollados. `repositoryDomain` es el dominio del
// repositorio institucional resuelto (o null): va como pista en el mensaje
// user, nunca como allowed_domains (ver comentario en buildBaseUserContent).
// `datos` son los datos normalizados del cliente (con anio ya resuelto), que
// van en el mensaje user para mantener el system prompt estatico/cacheable.
// Si el contenido viene vacio o invalido se reintenta UNA vez.
export const requestTitulos = async ({
  systemPrompt, repositoryDomain = null, datos = null, searchContext = null, options = {},
}) => {
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

  // El costo de la busqueda es POR PETICION (~$0.005 c/u con Exa/Parallel),
  // no por resultado: subir max_results da mas material por busqueda casi
  // gratis (solo tokens de prompt) y reduce el numero de busquedas que el
  // modelo necesita. max_total_results holgado para que alcance para las
  // busquedas nacionales E internacionales sin que el tope corte a mitad.
  // Sin allowed_domains: aplica a TODAS las busquedas del request y hacia
  // imposible encontrar antecedentes internacionales (fallo visto en
  // produccion); la orientacion a repositorios va en el prompt.
  const searchParameters = {
    engine: "auto",
    max_results: 8,
    max_total_results: 60,
    search_context_size: "medium",
    // Tope de caracteres por resultado: los resultados de busqueda son el
    // grueso de los tokens de entrada (~150k en corridas reales). Para citar
    // un antecedente bastan autor, anio, titulo y URL; 2000 caracteres los
    // cubren de sobra y recortan el relleno.
    max_characters: 2000,
  };

  // options.messages permite al llamador (index.js) inyectar un historial
  // previo (system + user original + assistant con la respuesta anterior +
  // user con la correccion) para el reintento correctivo cuando la
  // verificacion de URLs detecta antecedentes inventados. Si no se pasa, se
  // arma el par system/user de siempre.
  const messages = Array.isArray(options.messages) && options.messages.length > 0
    ? options.messages
    : [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildBaseUserContent(repositoryDomain, datos, searchContext) },
    ];
  const tools = [{ type: "openrouter:web_search", parameters: searchParameters }];

  let lastFailure = "desconocido";
  let attemptMessages = messages;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { content, usage, finishReason } = await callOpenRouter({
      messages: attemptMessages, tools, model, apiKey, timeoutMs, maxTokens,
    });
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

    // Un intento es valido solo si, tras quitar markup de tool_call filtrado,
    // queda contenido y contiene el primer titulo. Sin esto, una respuesta
    // que sea puro <tool_call> (busquedas escritas como texto, visto en
    // produccion) llegaria tal cual al cliente final.
    const cleaned = stripToolCallMarkup(content);
    let failure = null;
    if (!cleaned) {
      failure = `respuesta sin contenido util (finish_reason: ${finishReason})`;
    } else if (!TITULO_MARKER_RE.test(cleaned)) {
      failure = `la respuesta no contiene el marcador **TÍTULO 1** (finish_reason: ${finishReason})`;
    } else if (cleaned.includes("{{")) {
      // La plantilla del system prompt trae {{anio}} literal (para que el
      // system sea estatico/cacheable); el modelo debe reemplazarlo. Si se
      // le escapo alguno, el cliente veria "{{anio}}" en su documento.
      failure = "la respuesta contiene placeholders {{...}} sin reemplazar";
    }
    if (!failure) {
      return { content: cleaned, webSearchRequests };
    }

    lastFailure = failure;
    // Log tecnico completo en servidor (nunca llega al usuario final).
    // eslint-disable-next-line no-console
    console.error(
      `[titulos] intento ${attempt} fallido (${failure}). Respuesta cruda:\n${content.slice(0, 2000)}`,
    );
    // Para el segundo intento se anexa la respuesta invalida (si la hubo) y
    // un aviso: debe ejecutar las busquedas de verdad y entregar solo los
    // titulos, sin sintaxis de herramientas escrita como texto.
    attemptMessages = [
      ...messages,
      ...(content.trim() ? [{ role: "assistant", content }] : []),
      {
        role: "user",
        content: "Tu respuesta anterior no fue válida: no contenía los 3 títulos desarrollados "
          + "(llegó vacía, incompleta, con llamadas a herramientas escritas como texto <tool_call>, "
          + "o con placeholders {{...}} sin reemplazar). "
          + "EJECUTA las búsquedas web usando la herramienta disponible (no las escribas como texto) y "
          + "responde ÚNICAMENTE con los tres títulos desarrollados según la plantilla, comenzando "
          + "directamente con **TÍTULO 1**, reemplazando cada {{anio}} por el año de los DATOS DEL "
          + "ESTUDIANTE y cada [lugar] por el lugar exacto. No incluyas etiquetas <tool_call> ni "
          + "ninguna sintaxis de herramientas en tu respuesta.",
      },
    ];
  }

  throw new Error(`OpenRouter no devolvio los titulos tras el reintento (${lastFailure}).`);
};
