// Orquestador de la Matriz de Consistencia: valida el input del formulario
// (titulo obligatorio + universidad/carrera/poblacion/lugar/anio opcionales),
// clasifica el estudio con la Etapa 1 (analisis del titulo), busca
// dimensiones reales con los buscadores del sistema, redacta la matriz con
// la Etapa 2 y verifica que las fuentes de las dimensiones sean reales.
import { buildAnalisisSystemPrompt, buildRedaccionSystemPrompt, currentYear } from "./prompt.js";
import {
  requestAnalisis, requestMatriz, buildMatrizUserContent,
} from "./openrouter.js";
import { buildMatrizDocx } from "./docx.js";
import { normalizeUrlForMatch, findBannedSourceUrls, extractReferenceUrls } from "../titulos/verify.js";
import { gatherCustomSearchContext, braveUrlCheck } from "../titulos/websearch.js";

const MAX_TEXT_LENGTH = 200;
const MAX_TITULO_LENGTH = 300;

const optionalText = (value, label) => {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} no puede superar ${MAX_TEXT_LENGTH} caracteres.`);
  }
  return trimmed;
};

// Acepta el contrato snake_case del frontend (se tolera camelCase por si un
// integrador externo lo envia, igual que en titulos).
export const normalizeMatrizInput = (payload) => {
  const titulo = String(payload?.titulo ?? "").trim();
  if (!titulo) {
    throw new Error("El título de la tesis es obligatorio.");
  }
  if (titulo.length > MAX_TITULO_LENGTH) {
    throw new Error(`El título no puede superar ${MAX_TITULO_LENGTH} caracteres.`);
  }

  const universidad = optionalText(payload?.universidad, "La universidad");
  const carrera = optionalText(payload?.carrera, "La carrera");
  const poblacion = optionalText(payload?.poblacion, "La población");
  const lugar = optionalText(payload?.lugar, "El lugar");

  let anio = String(payload?.anio ?? "").trim();
  if (anio) {
    const anioNum = Number(anio);
    if (!/^\d{4}$/.test(anio) || !Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      throw new Error("El año debe tener 4 dígitos y estar entre 2000 y 2100.");
    }
  }

  return {
    titulo, universidad, carrera, poblacion, lugar, anio,
  };
};

// Consultas dirigidas a las dimensiones de cada variable: son las busquedas
// que el usuario haria a mano ("dimensiones de X segun autor"). Set acotado
// (2-3 por variable) para que la cuota de Brave sea predecible. Para tesis
// orientadas al servicio publico se agrega la variante de documentos
// gubernamentales (normas/guias ministeriales tambien dimensionan variables).
export const buildDimensionQueries = (analisis) => {
  const queries = [];
  const esServicioPublico = /p[uú]blic|gobierno|estado/i.test(analisis.area ?? "");
  for (const variable of analisis.variables) {
    queries.push(`"${variable.nombre}" dimensiones según autor libro`);
    queries.push(`dimensiones de ${variable.nombre} pdf`);
    if (esServicioPublico) {
      queries.push(`"${variable.nombre}" dimensiones documento norma ministerio`);
    }
  }
  return queries;
};

// Mensaje user del reintento correctivo: se envia con el historial completo
// (system + user original + assistant + correccion) para que la IA reemplace
// SOLO las fuentes detectadas como inventadas o prohibidas, sin tocar el
// resto de la matriz.
const buildCorrectionUserContent = (urlsInventadas, urlsProhibidas) => {
  const problemas = [];
  if (urlsInventadas.length > 0) {
    problemas.push("Verifiqué las URLs de las fuentes de tus dimensiones y las siguientes NO EXISTEN o "
      + "NO aparecen en los resultados de búsqueda disponibles (URLs inventadas o mal copiadas): "
      + `${urlsInventadas.join(", ")}.`);
  }
  if (urlsProhibidas.length > 0) {
    problemas.push("Las siguientes URLs provienen de fuentes NO académicas prohibidas (Scribd, Studocu, "
      + `Monografias, blogs y similares): ${urlsProhibidas.join(", ")}.`);
  }
  return `${problemas.join(" ")} `
  + "Debes reemplazar ÚNICAMENTE esas fuentes por otras REALES: realiza nuevas búsquedas web y elige "
  + "para cada variable afectada un autor cuya URL exacta haya aparecido efectivamente en los "
  + "resultados de esas búsquedas nuevas (si el autor cambia, ajusta también las dimensiones a las que "
  + "ese autor propone). No inventes ni \"recuerdes\" URLs. Mantén intacto todo lo demás (problemas, "
  + "objetivos, hipótesis si corresponde y metodología) y responde ÚNICAMENTE con el objeto JSON "
  + "completo de la matriz, sin texto adicional.";
};

// Verifica las fuentes de las dimensiones (1 URL por variable). A diferencia
// de titulos no se corre el pipeline HTTP completo: con tan pocas URLs basta
// la procedencia (la URL debe estar en los resultados que el sistema entrego,
// cuando la Etapa 2 fue sin herramienta) y el contraste en Brave como segunda
// oportunidad (el modelo pudo reescribir levemente la URL). Devuelve las
// listas de URLs inventadas y prohibidas (vacias si todo esta bien).
const verifyDimensionSources = async (matriz, { provenance, requireProvenance, websearchOptions }) => {
  const urls = matriz.variables.map((v) => v.fuente);
  const prohibidas = findBannedSourceUrls(urls);
  const inventadas = [];
  for (const url of urls) {
    if (prohibidas.includes(url)) continue;
    if (provenance.has(normalizeUrlForMatch(url))) continue;
    // Secuencial a proposito (limite de 1 consulta/seg del plan gratis).
    // eslint-disable-next-line no-await-in-loop
    const found = await braveUrlCheck(url, websearchOptions);
    if (found === true) continue;
    // Sin herramienta, toda URL fuera de los resultados entregados es
    // alucinada por definicion: si Brave tampoco la conoce (o no se pudo
    // consultar), se trata como inventada. Con herramienta (el modelo hizo
    // busquedas propias que el sistema no conoce), solo el "false" explicito
    // de Brave la condena; un "null" (Brave caido/sin clave) no castiga.
    if (requireProvenance || found === false) inventadas.push(url);
  }
  return { inventadas, prohibidas };
};

// Genera la matriz de consistencia completa. Flujo en dos etapas:
// 1. Analisis del titulo (JSON de clasificacion; si falla, el job falla).
// 2. Busqueda dirigida de dimensiones por el sistema (Brave/Firecrawl).
// 3. Redaccion de la matriz (sin herramienta y reasoning apagado si hubo
//    busqueda; con openrouter:web_search y reasoning medium si no).
// 4. Verificacion ligera de las fuentes + UN reintento correctivo; si
//    persisten fuentes falsas se lanza (nunca se entregan fuentes inventadas).
export const generateMatriz = async (payload, options = {}) => {
  const input = normalizeMatrizInput(payload);
  // El anio se resuelve en codigo: si el cliente no lo dio se usa el actual
  // (el propio titulo puede traer otro; el prompt de analisis lo prioriza).
  const datos = { ...input, anio: input.anio || String(currentYear()) };

  const analisis = await requestAnalisis({
    systemPrompt: buildAnalisisSystemPrompt(),
    input: datos,
    options,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[matriz] analisis: ${analisis.variables.length} variable(s), nivel=${analisis.nivel}, `
    + `enfoque=${analisis.enfoque}, diseno=${analisis.diseno}`,
  );

  // Busqueda dirigida de dimensiones por el SISTEMA (URLs reales por
  // construccion). Si falla o no hay claves, se sigue sin ella: la Etapa 2
  // conserva la herramienta de busqueda. Nunca debe tumbar el job.
  let searchContext = null;
  try {
    searchContext = await gatherCustomSearchContext(
      buildDimensionQueries(analisis),
      "Búsqueda de dimensiones",
      "busqueda de dimensiones",
      options.websearch ?? {},
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[matriz] busqueda de dimensiones fallo (se continua sin ella): ${err.message}`);
  }

  const redaccionSystemPrompt = buildRedaccionSystemPrompt();
  const sinHerramienta = Boolean(searchContext);
  const primerIntento = await requestMatriz({
    systemPrompt: redaccionSystemPrompt,
    input: datos,
    analisis,
    searchContext,
    options: {
      ...options,
      includeSearchTool: !sinHerramienta,
      reasoningEffort: sinHerramienta ? "none" : "medium",
    },
  });

  let { matriz, content, webSearchRequests } = primerIntento;
  // Procedencia: URLs que el sistema mismo obtuvo en la busqueda dirigida
  // (reales por construccion).
  const provenance = new Set(extractReferenceUrls(searchContext ?? "").map(normalizeUrlForMatch));
  let { inventadas, prohibidas } = await verifyDimensionSources(matriz, {
    provenance,
    requireProvenance: sinHerramienta,
    websearchOptions: options.websearch ?? {},
  });

  if (inventadas.length > 0 || prohibidas.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[matriz] verificacion de fuentes detecto ${inventadas.length} URL(s) inventada(s) y `
      + `${prohibidas.length} prohibida(s); reintentando con correccion: `
      + `${[...inventadas, ...prohibidas].join(", ")}`,
    );

    // El reintento correctivo SIEMPRE lleva la herramienta de busqueda
    // (necesita encontrar reemplazos reales) y razonamiento medium. Por eso
    // su verificacion no exige procedencia: sus busquedas nuevas traen URLs
    // legitimas que el sistema no conoce.
    const correctionMessages = [
      { role: "system", content: redaccionSystemPrompt },
      {
        role: "user",
        content: buildMatrizUserContent(datos, analisis, searchContext, { includeSearchTool: !sinHerramienta }),
      },
      { role: "assistant", content },
      { role: "user", content: buildCorrectionUserContent(inventadas, prohibidas) },
    ];
    const reintento = await requestMatriz({
      systemPrompt: redaccionSystemPrompt,
      input: datos,
      analisis,
      searchContext,
      options: {
        ...options,
        messages: correctionMessages,
        includeSearchTool: true,
        reasoningEffort: "medium",
      },
    });
    matriz = reintento.matriz;
    // Hoy no se vuelve a leer (el reintento es unico, sin bucle), pero se
    // mantiene junto a `matriz` y `webSearchRequests` para que las tres queden
    // coherentes: si algun dia se añade una segunda ronda correctiva, olvidarlo
    // aqui haria que se reenviara la respuesta vieja como historial.
    // eslint-disable-next-line no-useless-assignment
    content = reintento.content;
    webSearchRequests = reintento.webSearchRequests ?? webSearchRequests;

    ({ inventadas, prohibidas } = await verifyDimensionSources(matriz, {
      provenance,
      requireProvenance: false,
      websearchOptions: options.websearch ?? {},
    }));
    if (inventadas.length > 0 || prohibidas.length > 0) {
      throw new Error(
        "Tras el reintento correctivo aun se detectaron fuentes de dimensiones inventadas o "
        + `prohibidas: ${[...inventadas, ...prohibidas].join(", ")}`,
      );
    }
  }

  const docxBuffer = await buildMatrizDocx({ matriz });

  return {
    matriz,
    docxBuffer,
    webSearchRequests: webSearchRequests ?? null,
  };
};
