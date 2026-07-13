// Cliente OpenRouter de la Matriz de Consistencia: dos llamadas a GLM-5.2
// (Etapa 1 = analisis del titulo, JSON corto; Etapa 2 = matriz completa,
// JSON estructurado). Reutiliza el transporte de lib/titulos (mismo modelo,
// mismo manejo de reasoning binario de GLM y de markup <tool_call> filtrado).
import { callOpenRouter, stripToolCallMarkup, DEFAULT_MODEL } from "../titulos/openrouter.js";

const resolveCallConfig = (options = {}) => {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY no esta configurada en el servidor.");
  }
  const model = options.model ?? process.env.OPENROUTER_MODEL_MATRIZ
    ?? process.env.OPENROUTER_MODEL_TITULOS ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs
    ?? Number.parseInt(process.env.OPENROUTER_TIMEOUT_MS ?? "600000", 10);
  return { apiKey, model, timeoutMs };
};

// Bloque de datos del cliente: vive en el mensaje user (no en el system) para
// que los system prompts queden estaticos y cacheables entre solicitudes.
export const buildDatosBlock = (input) => {
  const lines = [`- Título de la tesis: ${input.titulo}`];
  if (input.universidad) lines.push(`- Universidad: ${input.universidad}`);
  if (input.carrera) lines.push(`- Carrera: ${input.carrera}`);
  if (input.poblacion) lines.push(`- Población (usar EXACTAMENTE así): ${input.poblacion}`);
  if (input.lugar) lines.push(`- Lugar (usar EXACTAMENTE así): ${input.lugar}`);
  lines.push(`- Año: ${input.anio}`);
  return `DATOS DEL ESTUDIANTE:\n${lines.join("\n")}\n\n`;
};

const clean = (v) => String(v ?? "").trim();

// ── Etapa 1: analisis del titulo ────────────────────────────────────────────

// Extrae y valida el JSON de analisis. Tolera fences y texto alrededor (se
// toma del primer "{" al ultimo "}"). Lanza con el motivo si viene invalido.
export const parseAnalisis = (raw) => {
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("la respuesta no contiene un objeto JSON");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("el JSON del analisis no es valido");
  }

  const variables = Array.isArray(parsed?.variables)
    ? parsed.variables.map((v) => ({ nombre: clean(v?.nombre), rol: clean(v?.rol) }))
    : [];
  if (variables.length < 1 || variables.length > 2 || variables.some((v) => !v.nombre)) {
    throw new Error("el analisis debe traer 1 o 2 variables con nombre");
  }
  const descriptiva = parsed?.descriptiva === true || variables.length === 1;
  if (descriptiva && variables.length !== 1) {
    throw new Error("una tesis descriptiva debe traer exactamente 1 variable");
  }

  const required = ["tipo", "enfoque", "nivel", "diseno", "tecnica", "instrumento"];
  const result = { variables, descriptiva, conector: clean(parsed?.conector) || "ninguno" };
  for (const field of required) {
    const value = clean(parsed?.[field]);
    if (!value) throw new Error(`el analisis viene sin el campo "${field}"`);
    result[field] = value;
  }
  result.temporalidad = clean(parsed?.temporalidad);
  result.area = clean(parsed?.area);
  result.poblacion = clean(parsed?.poblacion);
  result.lugar = clean(parsed?.lugar);
  result.anio = clean(parsed?.anio);
  return result;
};

// Etapa 1: llamada corta SIN herramienta que clasifica el estudio a partir
// del titulo (conector, tipo, enfoque, nivel, diseño, tecnica/instrumento).
// Si el JSON viene invalido se reintenta UNA vez; si persiste, se lanza y el
// job falla (sin analisis no hay matriz coherente que redactar).
export const requestAnalisis = async ({ systemPrompt, input, options = {} }) => {
  const { apiKey, model, timeoutMs } = resolveCallConfig(options);
  // Salida diminuta (un JSON de clasificacion), pero el razonamiento medium
  // tambien consume presupuesto de completion.
  const maxTokens = options.maxTokensAnalisis
    ?? Number.parseInt(process.env.OPENROUTER_MAX_TOKENS_MATRIZ_ANALISIS ?? "8000", 10);

  const userContent = buildDatosBlock(input)
    + "Analiza el título y clasifica la investigación. Responde SOLO con el JSON.";
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  let lastFailure = "desconocido";
  let attemptMessages = messages;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { content, usage, finishReason } = await callOpenRouter({
      messages: attemptMessages, tools: undefined, model, apiKey, timeoutMs, maxTokens,
      reasoningEffort: "medium",
    });
    // eslint-disable-next-line no-console
    console.log(
      `[matriz] analisis intento ${attempt}: finish_reason=${finishReason}, `
      + `usage=${JSON.stringify(usage)}`,
    );
    try {
      return parseAnalisis(stripToolCallMarkup(content));
    } catch (err) {
      lastFailure = err.message;
      // eslint-disable-next-line no-console
      console.error(
        `[matriz] analisis intento ${attempt} fallido (${err.message}). Respuesta cruda:\n${String(content).slice(0, 1000)}`,
      );
      attemptMessages = [
        ...messages,
        ...(String(content ?? "").trim() ? [{ role: "assistant", content }] : []),
        {
          role: "user",
          content: `Tu respuesta anterior no fue válida (${err.message}). Responde ÚNICAMENTE con el `
            + "objeto JSON pedido en el formato de respuesta, sin texto adicional ni bloques de código.",
        },
      ];
    }
  }
  throw new Error(`El analisis del titulo fallo tras el reintento (${lastFailure}).`);
};

// ── Etapa 2: redaccion de la matriz ─────────────────────────────────────────

const parseSeccionTexto = (obj, label, { requireEspecificos = true } = {}) => {
  const general = clean(obj?.general);
  const especificos = Array.isArray(obj?.especificos)
    ? obj.especificos.map(clean).filter(Boolean)
    : [];
  if (!general) throw new Error(`la matriz viene sin ${label} general`);
  if (requireEspecificos && especificos.length < 1) {
    throw new Error(`la matriz viene sin ${label}s específicos`);
  }
  return { general, especificos };
};

export const METODOLOGIA_FIELDS = [
  "tipo", "enfoque", "nivel", "diseno", "poblacion", "muestra", "muestreo", "tecnica", "instrumento",
];

// Extrae y valida el JSON de la matriz completa. `descriptiva` indica lo que
// determino la Etapa 1: en descriptivas "hipotesis" debe ser null y la unica
// variable admite hasta 6 dimensiones; en las demas, 3 a 5.
export const parseMatriz = (raw, { descriptiva }) => {
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("la respuesta no contiene un objeto JSON");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("el JSON de la matriz no es valido");
  }

  const titulo = clean(parsed?.titulo);
  if (!titulo) throw new Error("la matriz viene sin título");
  const problema = parseSeccionTexto(parsed?.problema, "problema");
  const objetivos = parseSeccionTexto(parsed?.objetivos, "objetivo");

  let hipotesis = null;
  if (descriptiva) {
    if (parsed?.hipotesis) {
      throw new Error("una tesis descriptiva no lleva hipótesis (el campo debe ser null)");
    }
  } else {
    const general = clean(parsed?.hipotesis?.general);
    const nula = clean(parsed?.hipotesis?.nula);
    const especificas = Array.isArray(parsed?.hipotesis?.especificas)
      ? parsed.hipotesis.especificas.map(clean).filter(Boolean)
      : [];
    if (!general || !nula) {
      throw new Error("la matriz viene sin hipótesis general (Hi) o nula (Ho)");
    }
    hipotesis = { general, nula, especificas };
  }

  const maxDim = descriptiva ? 6 : 5;
  const expectedVariables = descriptiva ? 1 : 2;
  const variablesRaw = Array.isArray(parsed?.variables) ? parsed.variables : [];
  if (variablesRaw.length !== expectedVariables) {
    throw new Error(`la matriz debe traer exactamente ${expectedVariables} variable(s)`);
  }
  const variables = variablesRaw.map((v, i) => {
    const nombre = clean(v?.nombre);
    const rol = clean(v?.rol);
    const autor = clean(v?.autor);
    const fuente = clean(v?.fuente);
    const dimensiones = Array.isArray(v?.dimensiones)
      ? v.dimensiones.map(clean).filter(Boolean)
      : [];
    if (!nombre) throw new Error(`la variable ${i + 1} viene sin nombre`);
    if (dimensiones.length < 3 || dimensiones.length > maxDim) {
      throw new Error(`la variable "${nombre}" debe traer entre 3 y ${maxDim} dimensiones (trajo ${dimensiones.length})`);
    }
    if (!autor) throw new Error(`la variable "${nombre}" viene sin autor de las dimensiones`);
    if (!/^https?:\/\//i.test(fuente)) {
      throw new Error(`la variable "${nombre}" viene sin URL de fuente válida`);
    }
    return { nombre, rol, dimensiones, autor, fuente };
  });

  const metodologia = {};
  for (const field of METODOLOGIA_FIELDS) {
    const value = clean(parsed?.metodologia?.[field]);
    if (!value) throw new Error(`la metodología viene sin el campo "${field}"`);
    metodologia[field] = value;
  }

  return { titulo, problema, objetivos, hipotesis, variables, metodologia };
};

// Mensaje user de la Etapa 2. Se exporta para que index.js reconstruya el
// mismo mensaje al armar el historial del reintento correctivo.
export const buildMatrizUserContent = (input, analisis, searchContext, { includeSearchTool }) => {
  const bloqueAnalisis = "ANÁLISIS METODOLÓGICO (ya realizado; respétalo, no lo cambies):\n"
    + `${JSON.stringify(analisis, null, 2)}\n\n`;
  const bloqueResultados = searchContext
    ? "RESULTADOS DE BÚSQUEDA DEL SISTEMA (obtenidos en tiempo real de motores de búsqueda; "
      + "estas URLs son reales):\n\n" + searchContext + "\n\n"
    : "";
  const planFuentes = includeSearchTool
    ? "PLAN DE BÚSQUEDA (máximo 4 búsquedas): busca las dimensiones de cada variable según un autor "
      + "citable (libro con autor identificable o documento normativo oficial). Si el resultado es "
      + "una tesis o artículo que toma las dimensiones de un teórico, cita en \"autor\" al teórico "
      + "original, no al intermediario. Cita solo URLs que aparezcan efectivamente en los resultados "
      + "de tus búsquedas, copiando cada URL exactamente. Cuando tengas las dimensiones de todas las "
      + "variables, DEJA de buscar y redacta el JSON completo. Nunca escribas etiquetas como "
      + "<tool_call>, <arg_key> o <arg_value> en tu respuesta: ejecuta las búsquedas con la "
      + "herramienta de forma nativa."
    : "PLAN: en esta solicitud NO tienes herramienta de búsqueda. Las dimensiones y sus autores deben "
      + "salir de los RESULTADOS DE BÚSQUEDA DEL SISTEMA de arriba: elige para cada variable un "
      + "resultado que trate sus dimensiones (si ese resultado es una tesis o artículo que toma las "
      + "dimensiones de un teórico, cita en \"autor\" al teórico original, no al intermediario) y "
      + "copia su URL LITERALMENTE, carácter por carácter. El sistema verificará cada URL y "
      + "RECHAZARÁ tu respuesta si citas alguna que no esté en los resultados, así que no "
      + "reconstruyas ni completes URLs de memoria.";
  return buildDatosBlock(input)
    + bloqueAnalisis
    + bloqueResultados
    + "Redacta ahora la matriz de consistencia completa y responde ÚNICAMENTE con el objeto JSON del "
    + "formato de respuesta, sin texto adicional.\n\n"
    + planFuentes;
};

// Etapa 2: pide la matriz completa en JSON. En el flujo normal va SIN
// herramienta y con el razonamiento APAGADO ("none" => reasoning.enabled=
// false; para GLM el thinking es binario y "low" NO lo acota — ver el
// comentario en lib/titulos/openrouter.js). Sin pre-busqueda del sistema, va
// CON openrouter:web_search y razonamiento medium. `options.messages` permite
// inyectar el historial del reintento correctivo (con herramienta).
export const requestMatriz = async ({
  systemPrompt, input, analisis, searchContext = null, options = {},
}) => {
  const { apiKey, model, timeoutMs } = resolveCallConfig(options);
  const maxTokens = options.maxTokens
    ?? Number.parseInt(process.env.OPENROUTER_MAX_TOKENS_MATRIZ ?? "16000", 10);

  // Mismos parametros de busqueda que titulos, con topes menores: aqui solo
  // se necesitan las dimensiones de 1-2 variables, no antecedentes.
  const searchParameters = {
    engine: "auto",
    max_results: 8,
    max_total_results: 24,
    search_context_size: "medium",
    max_characters: 2000,
  };
  const includeSearchTool = options.includeSearchTool ?? !searchContext;
  const tools = includeSearchTool
    ? [{ type: "openrouter:web_search", parameters: searchParameters }]
    : undefined;
  const reasoningEffort = options.reasoningEffort ?? (includeSearchTool ? "medium" : "none");

  const messages = Array.isArray(options.messages) && options.messages.length > 0
    ? options.messages
    : [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildMatrizUserContent(input, analisis, searchContext, { includeSearchTool }) },
    ];

  let lastFailure = "desconocido";
  let attemptMessages = messages;
  let attemptTools = tools;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { content, usage, finishReason } = await callOpenRouter({
      messages: attemptMessages, tools: attemptTools, model, apiKey, timeoutMs, maxTokens, reasoningEffort,
    });
    const webSearchRequests = usage?.server_tool_use_details?.web_search_requests
      ?? usage?.server_tool_use?.web_search_requests
      ?? null;
    // eslint-disable-next-line no-console
    console.log(
      `[matriz] redaccion intento ${attempt}: finish_reason=${finishReason}, `
      + `web_search_requests=${webSearchRequests ?? "n/a"}, usage=${JSON.stringify(usage)}`,
    );
    try {
      const matriz = parseMatriz(stripToolCallMarkup(content), { descriptiva: analisis.descriptiva });
      return { matriz, content, webSearchRequests };
    } catch (err) {
      lastFailure = err.message;
      // eslint-disable-next-line no-console
      console.error(
        `[matriz] redaccion intento ${attempt} fallido (${err.message}). Respuesta cruda:\n${String(content).slice(0, 2000)}`,
      );
      // Glitch de busqueda escrito como texto (visto en titulos): si hay
      // pre-busqueda del sistema, el reintento va SIN herramienta y con la
      // orden de redactar con lo ya disponible.
      const forceWriteout = /<tool_call/i.test(String(content ?? "")) && Boolean(searchContext);
      if (forceWriteout) attemptTools = undefined;
      attemptMessages = [
        ...messages,
        ...(String(content ?? "").trim() ? [{ role: "assistant", content }] : []),
        {
          role: "user",
          content: `Tu respuesta anterior no fue válida (${err.message}). `
            + (forceWriteout
              ? "Los RESULTADOS DE BÚSQUEDA DEL SISTEMA del mensaje inicial son suficientes; NO busques más. "
              : "")
            + "Responde ÚNICAMENTE con el objeto JSON completo de la matriz según el formato de "
            + "respuesta, sin texto adicional, sin bloques de código y sin etiquetas <tool_call>.",
        },
      ];
    }
  }
  throw new Error(`OpenRouter no devolvio la matriz tras el reintento (${lastFailure}).`);
};
