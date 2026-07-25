// Orquestador del Generador de Titulos de Investigacion: valida el input del
// formulario (universidad, carrera, lugar, numero_variables, anio opcional),
// arma el system prompt interpolado con la plantilla que corresponda y hace
// UNA llamada a OpenRouter (GLM-5.2 + openrouter:web_search).
import { buildSystemPrompt, buildSeleccionSystemPrompt, currentYear } from "./prompt.js";
import { resolveRepositoryDomain } from "./universities.js";
import {
  requestTitulos, requestSeleccionVariables, buildBaseUserContent, stripToolCallMarkup,
  TITULO_MARKER_RE,
} from "./openrouter.js";
import { buildTitulosDocx } from "./docx.js";
import {
  extractReferenceUrls, verifyUrls, normalizeUrlForMatch, findBannedSourceUrls,
  findNonDocumentUrls,
} from "./verify.js";
import { gatherSearchContext, gatherTargetedSearchContext, braveUrlCheck } from "./websearch.js";

// Limpieza final del contenido: quita markup de tool_call filtrado como texto
// (defensa en profundidad: requestTitulos ya lo hace, pero esta funcion
// tambien se usa sobre contenido arbitrario) y descarta la narracion previa
// al primer titulo ("Voy a realizar las búsquedas..."). Si el marcador no
// aparece, se devuelve el texto tal cual (requestTitulos ya garantizo que
// exista en el flujo normal) pero se deja un aviso.
export const cleanTitulosContent = (content) => {
  const text = stripToolCallMarkup(content);
  const match = text.match(TITULO_MARKER_RE);
  if (!match) {
    // eslint-disable-next-line no-console
    console.warn("[titulos] no se encontro el marcador **TÍTULO 1** en la respuesta de la IA; se entrega el contenido tal cual.");
    return text;
  }
  return text.slice(match.index).trim();
};

// Extrae los titulos propuestos como lista, para que el usuario pueda ELEGIR
// uno en vez de copiarlo a mano.
//
// Usa la misma estructura en la que ya se apoya el .docx (ver splitByTitulo en
// docx.js): un encabezado **TÍTULO N** y, debajo, el titulo en si como primera
// linea con contenido. Si el formato llega distinto devuelve lista vacia y el
// frontend simplemente no ofrece elegir: nunca rompe la generacion, que es lo
// que el usuario vino a buscar.
const TITULO_HEADING_RE = /\*\*\s*T[IÍí]TULO\s*(\d+)/i;
const SECTION_HEADING_RE = /^\*\*\s*(\d+)\.\s*(.+?)\s*\*\*$/;

export const extraerTitulos = (contenido) => {
  const lineas = String(contenido ?? "").split("\n");
  const titulos = [];
  let buscando = false;

  for (const cruda of lineas) {
    if (TITULO_HEADING_RE.test(cruda)) { buscando = true; continue; }
    if (!buscando) continue;
    const linea = cruda.trim();
    if (linea === "" || /^[-—_*]{3,}$/.test(linea)) continue;
    // Si lo primero es un encabezado de seccion, este bloque no trae el titulo
    // en el sitio esperado; se pasa al siguiente en vez de guardar basura.
    if (SECTION_HEADING_RE.test(linea)) { buscando = false; continue; }
    const limpio = linea
      .replace(/^[*_`>#\s]+|[*_`\s]+$/g, "")
      .replace(/^["“«]|["”»]$/g, "")
      .trim();
    if (limpio) titulos.push(limpio.slice(0, 300));
    buscando = false;
  }
  return titulos;
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
const buildCorrectionUserContent = (urlsInventadas, urlsProhibidas = [], urlsListado = []) => {
  const problemas = [];
  if (urlsInventadas.length > 0) {
    problemas.push("Verifique las URLs de tus antecedentes y las siguientes NO EXISTEN o NO aparecen "
      + "en los resultados de búsqueda disponibles (URLs inventadas o mal copiadas): "
      + `${urlsInventadas.join(", ")}.`);
  }
  if (urlsProhibidas.length > 0) {
    problemas.push("Las siguientes URLs provienen de fuentes NO académicas prohibidas por las reglas de "
      + `referencias (Scribd, Studocu, Course Hero, Monografias, blogs y similares): ${urlsProhibidas.join(", ")}. `
      + "Solo se aceptan fuentes primarias y oficiales: repositorios institucionales, ALICIA, RENATI, "
      + "SciELO, Redalyc, Dialnet o revistas con DOI.");
  }
  if (urlsListado.length > 0) {
    problemas.push("Las siguientes URLs no conducen a un documento concreto sino a un listado, página "
      + `de búsqueda o portada del repositorio: ${urlsListado.join(", ")}. El enlace de cada referencia `
      + "debe llevar DIRECTAMENTE a la ficha o PDF del trabajo citado (handle, DOI o URI del ítem).");
  }
  return `${problemas.join(" ")} `
  + "Debes reemplazar ÚNICAMENTE esos antecedentes por otros REALES de fuentes oficiales: realiza nuevas "
  + "búsquedas web y cita solo referencias cuya URL exacta haya aparecido efectivamente en los resultados "
  + "de esas búsquedas nuevas. No inventes ni \"recuerdes\" URLs. Mantén intacto todo lo demás (los 3 "
  + "títulos, problema, objetivos, planteamiento del problema, metodología e hipótesis si corresponde) y "
  + "conserva el mismo formato completo de tu respuesta anterior, comenzando directamente con **TÍTULO 1**.";
};

// Verifica las URLs citadas como antecedentes en el contenido. Las
// "sospechosas" (2xx pero detras de un muro anti-bot, p. ej. RENATI, que
// devuelve 200 a cualquier handle exista o no) se resuelven en dos pasos:
// 1. Procedencia: si la URL aparecio en los resultados de la pre-busqueda
//    del sistema, es real por construccion.
// 2. Contraste en Brave: si el indice del buscador conoce la URL exacta es
//    real; si no aparece, se trata como inventada (el reintento correctivo
//    la reemplaza). Sin clave o con Brave caido queda como no verificable.
const verifyContentSources = async (contenido, { provenance, websearchOptions, requireProvenance = false }) => {
  const urls = extractReferenceUrls(contenido);
  // Fuentes no académicas (Scribd, Studocu, etc.): prohibidas por las reglas
  // APA 7 del prompt aunque la URL exista. Las URLs de listado/portada no
  // conducen al documento citado. Ambas se excluyen de la verificacion HTTP
  // (no aporta nada) y disparan el mismo reintento correctivo.
  const prohibidas = findBannedSourceUrls(urls);
  const listados = findNonDocumentUrls(urls.filter((url) => !prohibidas.includes(url)));
  const excluidas = new Set([...prohibidas, ...listados]);
  let urlsVerificables = urls.filter((url) => !excluidas.has(url));

  // Flujo en dos etapas: la llamada de desarrollo NO tiene herramienta de
  // busqueda, asi que TODA URL citada debe existir literalmente en los
  // resultados que el sistema le entrego (procedencia). Una URL fuera de esa
  // lista es alucinada por definicion — aunque responda 200 podria apuntar a
  // otro trabajo distinto del citado. Se marca inventada sin gastar HTTP.
  const fueraDeResultados = [];
  if (requireProvenance) {
    urlsVerificables = urlsVerificables.filter((url) => {
      if (provenance.has(normalizeUrlForMatch(url))) return true;
      fueraDeResultados.push(url);
      return false;
    });
  }

  const { reales, inventadas, noVerificables, sospechosas } = await verifyUrls(urlsVerificables);
  inventadas.push(...fueraDeResultados);

  for (const url of sospechosas) {
    if (provenance.has(normalizeUrlForMatch(url))) {
      reales.push(url);
      continue;
    }
    // Secuencial a proposito (limite de 1 consulta/seg del plan gratis).
    // eslint-disable-next-line no-await-in-loop
    const found = await braveUrlCheck(url, websearchOptions);
    if (found === true) reales.push(url);
    else if (found === false) inventadas.push(url);
    else noVerificables.push(url);
  }
  if (sospechosas.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[titulos] ${sospechosas.length} URL(s) tras muro anti-bot resueltas por procedencia/Brave.`,
    );
  }

  return { reales, inventadas, noVerificables, prohibidas, listados };
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
  // El anio se resuelve en codigo (no en el prompt): si el cliente no lo dio,
  // se usa el anio actual del sistema. `datos` viaja en el mensaje user para
  // que el system prompt quede estatico y cacheable.
  const datos = { ...input, anio: input.anio || String(currentYear()) };
  const systemPrompt = buildSystemPrompt(datos.numeroVariables);
  const repositoryDomain = resolveRepositoryDomain(datos.universidad);

  // Pre-busqueda del sistema (Brave/Firecrawl): resultados reales que se
  // inyectan en el mensaje user para que el modelo casi no necesite buscar
  // por su cuenta. Si falla o no hay claves, se sigue sin ella (el modelo
  // conserva su herramienta de busqueda). Nunca debe tumbar el job.
  let searchContext = null;
  try {
    searchContext = await gatherSearchContext(datos, repositoryDomain, options.websearch ?? {});
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[titulos] pre-busqueda fallo (se continua sin ella): ${err.message}`);
  }

  // Flujo en dos etapas (solo con pre-busqueda): la Etapa 1 elige las
  // variables (llamada corta, razonamiento medium), el sistema lanza
  // busquedas Brave dirigidas a esas variables, y la Etapa 2 desarrolla los
  // titulos SIN herramienta (razonamiento low) — sin herramienta no hay
  // glitch <tool_call> ni rondas de busqueda del modelo, y el job baja de
  // ~10-17 min a ~4-6 min. Si la Etapa 1 falla, se cae al flujo clasico de
  // una sola llamada CON herramienta (nunca se tumba el job por esto).
  let seleccion = null;
  let fullSearchContext = searchContext;
  if (searchContext) {
    try {
      seleccion = await requestSeleccionVariables({
        systemPrompt: buildSeleccionSystemPrompt(),
        datos,
        searchContext,
        options,
      });
      try {
        const targeted = await gatherTargetedSearchContext(
          seleccion, repositoryDomain, options.websearch ?? {},
        );
        if (targeted) fullSearchContext = `${searchContext}\n\n${targeted}`;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[titulos] busqueda dirigida fallo (se continua con la generica): ${err.message}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[titulos] seleccion de variables fallo (se usa el flujo clasico): ${err.message}`);
      seleccion = null;
    }
  }
  // Etapa 2 sin herramienta y con razonamiento APAGADO ("none" =>
  // reasoning.enabled=false): la tarea ya es mecanica (rellenar la plantilla
  // con variables y material dados) y para GLM el thinking es binario —
  // con effort "low" el modelo quemo todo el presupuesto de tokens pensando
  // y devolvio contenido vacio (finish_reason=length, visto en produccion).
  const developOptions = seleccion
    ? { ...options, includeSearchTool: false, reasoningEffort: "none" }
    : options;

  // Si la etapa de desarrollo (sin herramienta) falla por cualquier motivo,
  // el job NO muere: se cae al flujo clasico (una llamada CON herramienta,
  // razonamiento medium), conservando las busquedas dirigidas como material
  // extra. Preferimos un job lento a un job fallido.
  let primerIntento;
  try {
    primerIntento = await requestTitulos({
      systemPrompt,
      repositoryDomain,
      datos,
      searchContext: fullSearchContext,
      seleccion,
      options: developOptions,
    });
  } catch (err) {
    if (!seleccion) throw err;
    // eslint-disable-next-line no-console
    console.warn(`[titulos] etapa de desarrollo fallo (${err.message}); se reintenta con el flujo clasico.`);
    seleccion = null;
    primerIntento = await requestTitulos({
      systemPrompt,
      repositoryDomain,
      datos,
      searchContext: fullSearchContext,
      options,
    });
  }

  let content = primerIntento.content;
  let webSearchRequests = primerIntento.webSearchRequests;
  let contenido = cleanTitulosContent(content);
  // Procedencia: URLs que el sistema mismo obtuvo en la pre-busqueda y en
  // las busquedas dirigidas (reales por construccion) — resuelven las
  // "sospechosas" sin gastar cuota.
  const provenance = new Set(extractReferenceUrls(fullSearchContext ?? "").map(normalizeUrlForMatch));
  // En el flujo de dos etapas la llamada de desarrollo no tuvo herramienta:
  // toda URL citada DEBE venir de los resultados entregados (procedencia
  // estricta). En el flujo clasico el modelo busca por su cuenta y sus URLs
  // legitimas no estan en la procedencia, asi que no se puede exigir.
  let {
    reales, inventadas, noVerificables, prohibidas, listados,
  } = await verifyContentSources(contenido, {
    provenance,
    websearchOptions: options.websearch ?? {},
    requireProvenance: Boolean(seleccion),
  });

  if (inventadas.length > 0 || prohibidas.length > 0 || listados.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[titulos] verificacion de fuentes detecto ${inventadas.length} URL(s) inventada(s)/fuera de `
      + `resultados, ${prohibidas.length} de fuentes prohibidas y ${listados.length} de listados; `
      + `reintentando con correccion: ${[...inventadas, ...prohibidas, ...listados].join(", ")}`,
    );

    const correctionMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildBaseUserContent(repositoryDomain, datos, fullSearchContext, seleccion) },
      { role: "assistant", content },
      { role: "user", content: buildCorrectionUserContent(inventadas, prohibidas, listados) },
    ];

    // El reintento correctivo SIEMPRE lleva la herramienta de busqueda
    // (necesita encontrar reemplazos reales), incluso en el flujo en dos
    // etapas donde la llamada de desarrollo fue sin herramienta. Por eso su
    // verificacion NO exige procedencia: sus busquedas nuevas traen URLs
    // legitimas que el sistema no conoce (la verificacion HTTP las cubre).
    const reintento = await requestTitulos({
      systemPrompt,
      repositoryDomain,
      datos,
      searchContext: fullSearchContext,
      seleccion,
      options: { ...options, messages: correctionMessages },
    });

    content = reintento.content;
    webSearchRequests = reintento.webSearchRequests ?? webSearchRequests;
    contenido = cleanTitulosContent(content);
    ({
      reales, inventadas, noVerificables, prohibidas, listados,
    } = await verifyContentSources(contenido, {
      provenance,
      websearchOptions: options.websearch ?? {},
      requireProvenance: false,
    }));

    if (inventadas.length > 0 || prohibidas.length > 0 || listados.length > 0) {
      throw new Error(
        "Tras el reintento correctivo aun se detectaron URLs de antecedentes inventadas, de fuentes "
        + `no académicas o de listados: ${[...inventadas, ...prohibidas, ...listados].join(", ")}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[titulos] verificacion de fuentes: ${reales.length} reales, ${noVerificables.length} no verificables`);

  // La portada del Word usa `datos` (con el anio ya resuelto) para no
  // mostrar el campo vacio cuando el cliente no indico anio.
  const docxBuffer = await buildTitulosDocx({ contenido, input: datos });

  return {
    contenido,
    docxBuffer,
    webSearchRequests: webSearchRequests ?? null,
    fuentes: { reales: reales.length, noVerificables: noVerificables.length },
  };
};
