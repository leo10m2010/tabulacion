// Orquestador del Generador de Titulos de Investigacion: valida el input del
// formulario (universidad, carrera, lugar, numero_variables, anio opcional),
// arma el system prompt interpolado con la plantilla que corresponda y hace
// UNA llamada a OpenRouter (GLM-5.2 + openrouter:web_search).
import { buildSystemPrompt } from "./prompt.js";
import { buildAllowedDomains } from "./universities.js";
import { requestTitulos, buildBaseUserContent } from "./openrouter.js";
import { buildTitulosDocx } from "./docx.js";
import { extractReferenceUrls, verifyUrls } from "./verify.js";

// Marcador tolerante de inicio del primer titulo (con o sin espacios, con o
// sin tilde). GLM-5.2 a veces antepone narracion de sus busquedas ("Voy a
// realizar las búsquedas...") antes de los titulos: se descarta todo lo
// anterior al marcador. Si no aparece, se devuelve el contenido tal cual
// (mejor entregar algo imperfecto que romper el job) pero se deja un aviso.
const TITULO_1_MARKER_RE = /\*\*\s*T[IÍí]TULO\s*1/i;

export const cleanTitulosContent = (content) => {
  const text = String(content ?? "");
  const match = text.match(TITULO_1_MARKER_RE);
  if (!match) {
    // eslint-disable-next-line no-console
    console.warn("[titulos] no se encontro el marcador **TÍTULO 1** en la respuesta de la IA; se entrega el contenido tal cual.");
    return text;
  }
  return text.slice(match.index).trim();
};

const MAX_TEXT_LENGTH = 200;

const requireNonEmptyText = (value, label) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${label} es obligatorio.`);
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} no puede superar ${MAX_TEXT_LENGTH} caracteres.`);
  }
  return trimmed;
};

// Acepta camelCase o snake_case para numero_variables/anio (el frontend usa
// el contrato snake_case, pero se tolera el otro por si un integrador externo
// envia camelCase).
export const normalizeTitulosInput = (payload) => {
  const universidad = requireNonEmptyText(payload?.universidad, "La universidad");
  const carrera = requireNonEmptyText(payload?.carrera, "La carrera");
  const lugar = requireNonEmptyText(payload?.lugar, "El lugar");

  const numeroVariablesRaw = String(payload?.numero_variables ?? payload?.numeroVariables ?? "").trim();
  if (!["1", "2"].includes(numeroVariablesRaw)) {
    throw new Error('El numero de variables debe ser "1" (descriptiva) o "2" (correlacional).');
  }

  let anio = String(payload?.anio ?? "").trim();
  if (anio) {
    const anioNum = Number(anio);
    if (!/^\d{4}$/.test(anio) || !Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      throw new Error("El año debe tener 4 dígitos y estar entre 2000 y 2100.");
    }
  } else {
    anio = "";
  }

  return {
    universidad, carrera, lugar, numeroVariables: numeroVariablesRaw, anio,
  };
};

// Mensaje user del reintento correctivo: se envia junto con el historial
// completo (system + user original + assistant con la respuesta anterior)
// para que la IA reemplace SOLO las URLs que la verificacion detecto como
// inventadas (404/410), sin tocar el resto del contenido.
const buildCorrectionUserContent = (urlsInventadas) => "Verifique las URLs de tus antecedentes y las siguientes "
  + `NO EXISTEN (el servidor respondio 404/410 al consultarlas): ${urlsInventadas.join(", ")}. `
  + "Debes reemplazar ÚNICAMENTE esos antecedentes por otros REALES: realiza nuevas búsquedas web y cita "
  + "solo referencias cuya URL exacta haya aparecido efectivamente en los resultados de esas búsquedas "
  + "nuevas. No inventes ni \"recuerdes\" URLs. Mantén intacto todo lo demás (los 3 títulos, problema, "
  + "objetivos, planteamiento del problema, metodología e hipótesis si corresponde) y conserva el mismo "
  + "formato completo de tu respuesta anterior, comenzando directamente con **TÍTULO 1**.";

// Verifica las URLs citadas como antecedentes en el contenido y clasifica el
// resultado. Se usa tanto en el intento inicial como en el reintento
// correctivo.
const verifyContentSources = async (contenido) => {
  const urls = extractReferenceUrls(contenido);
  return verifyUrls(urls);
};

// Genera los 3 titulos: valida, arma el system prompt final y llama a la IA.
// Tras recibir la respuesta, verifica por HTTP que las URLs de los
// antecedentes sean reales (no handles/repositorios inventados por el
// modelo). Si detecta alguna inventada (404/410), hace UN reintento
// correctivo pidiendole a la IA que la reemplace por una fuente real; si aun
// asi persiste, se lanza un error (se prefiere fallar el job antes que
// entregar fuentes falsas). Devuelve el markdown limpio (el frontend lo
// renderiza), el .docx ya armado, el numero de busquedas web usadas
// (monitoreo de costo) y un resumen de la verificacion de fuentes.
export const generateTitulos = async (payload, options = {}) => {
  const input = normalizeTitulosInput(payload);
  const systemPrompt = buildSystemPrompt(input);
  const allowedDomains = buildAllowedDomains(input.universidad);

  const primerIntento = await requestTitulos({
    systemPrompt,
    allowedDomains,
    options,
  });

  let content = primerIntento.content;
  let webSearchRequests = primerIntento.webSearchRequests;
  let contenido = cleanTitulosContent(content);
  let { reales, inventadas, noVerificables } = await verifyContentSources(contenido);

  if (inventadas.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[titulos] verificacion de fuentes detecto ${inventadas.length} URL(s) inventada(s); `
      + `reintentando con correccion: ${inventadas.join(", ")}`,
    );

    const correctionMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildBaseUserContent() },
      { role: "assistant", content },
      { role: "user", content: buildCorrectionUserContent(inventadas) },
    ];

    const reintento = await requestTitulos({
      systemPrompt,
      allowedDomains,
      options: { ...options, messages: correctionMessages },
    });

    content = reintento.content;
    webSearchRequests = reintento.webSearchRequests ?? webSearchRequests;
    contenido = cleanTitulosContent(content);
    ({ reales, inventadas, noVerificables } = await verifyContentSources(contenido));

    if (inventadas.length > 0) {
      throw new Error(
        "Tras el reintento correctivo aun se detectaron URLs de antecedentes inventadas "
        + `(no existen): ${inventadas.join(", ")}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[titulos] verificacion de fuentes: ${reales.length} reales, ${noVerificables.length} no verificables`);

  const docxBuffer = await buildTitulosDocx({ contenido, input });

  return {
    contenido,
    docxBuffer,
    webSearchRequests: webSearchRequests ?? null,
    fuentes: { reales: reales.length, noVerificables: noVerificables.length },
  };
};
