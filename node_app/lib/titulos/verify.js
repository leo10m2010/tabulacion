// Verificacion de autenticidad de fuentes del Generador de Titulos: extrae
// las URLs citadas en los antecedentes y las verifica por HTTP para detectar
// handles/URLs inventados por la IA. NUNCA se generan URLs; solo se valida
// que las que la IA escribio realmente existan en el servidor remoto.
import {
  parsePublicHttpUrl,
  publicUrlDispatcher,
  resolvePublicAddresses,
} from "../security/safe-url.js";

// Regex tolerante para URLs http/https dentro de texto markdown/APA. Se
// permite casi cualquier caracter no-espacio y luego se recorta la
// puntuacion colgante (., ), ,, etc.) que suele quedar pegada al final de la
// URL en una referencia bibliografica.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// Puntuacion que puede quedar pegada al final de una URL dentro de una frase
// (punto final de la oracion, parentesis de cierre, coma, punto y coma). Se
// recorta de forma repetida por si hay varias seguidas (p.ej. "url).").
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

// Extrae todas las URLs http/https del contenido, recortando puntuacion
// colgante final, y devuelve un array deduplicado en orden de aparicion.
export const extractReferenceUrls = (contenido) => {
  const text = String(contenido ?? "");
  const matches = text.match(URL_RE) ?? [];
  const seen = new Set();
  const result = [];
  for (const raw of matches) {
    let url = raw;
    // Se recorta la puntuacion colgante; si al recortar queda un parentesis
    // sin cerrar dentro de la URL (poco comun en handles/repositorios), no
    // se reintroduce: preferimos la URL "limpia" tal como la citaria un APA.
    let prev;
    do {
      prev = url;
      url = url.replace(TRAILING_PUNCT_RE, "");
    } while (url !== prev);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
};

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.TITULOS_VERIFY_TIMEOUT_MS ?? "10000", 10);
const DEFAULT_CONCURRENCY = 5;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 TesisTab/1.0";

// Muros anti-bot que devuelven 200 para CUALQUIER ruta, exista o no
// (verificado en produccion: RENATI responde "Making sure you're not a bot!"
// con 200 tanto para handles reales como inventados). Un 200 con estas
// señales NO prueba que la URL exista: se clasifica "sospechosa" y el caller
// la resuelve por procedencia (pre-busqueda) o contraste en Brave.
const BOT_CHALLENGE_MARKERS = [
  // RENATI (Anubis) escribe "you&#39;re not a bot" con entidad HTML: se usa
  // el fragmento sin apostrofe para que coincida con ambas variantes.
  "not a bot",
  "just a moment",
  "checking your browser",
  "verifying you are human",
  "verificando que eres humano",
  "enable javascript and cookies",
];

// Dominios de fuentes NO académicas que las reglas APA 7 del generador
// prohíben citar como antecedente (solo se aceptan fuentes primarias y
// oficiales: repositorios institucionales, ALICIA, RENATI, SciELO, Redalyc,
// Dialnet, revistas con DOI). Si la IA cita una de estas, el reintento
// correctivo la reemplaza aunque la URL exista y responda 200.
export const BANNED_SOURCE_DOMAINS = [
  "scribd.com",
  "studocu.com",
  "coursehero.com",
  "monografias.com",
  "buenastareas.com",
  "academia.edu",
  "researchgate.net",
  "slideshare.net",
  "issuu.com",
  "prezi.com",
  "brainly.lat",
  "clubensayos.com",
];

// Devuelve las URLs cuyo host pertenece (o es subdominio) a un dominio
// prohibido. Las URLs no parseables no se marcan aqui: la verificacion HTTP
// ya se encarga de ellas.
export const findBannedSourceUrls = (urls) => urls.filter((url) => {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return BANNED_SOURCE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
});

// Normalizacion para comparar URLs entre fuentes (respuesta de la IA vs
// resultados de busqueda): minusculas, https, sin slash final, sin
// percent-encoding (el modelo a veces re-encodea tildes al copiar la URL).
export const normalizeUrlForMatch = (url) => {
  let text = String(url ?? "").trim();
  try {
    text = decodeURI(text);
  } catch {
    // URI malformada: se compara tal cual.
  }
  return text
    .toLowerCase()
    .replace(/^http:\/\//, "https://")
    .replace(/\/+$/, "");
};

// URLs que aunque existan NO conducen a un documento citable: listados,
// paginas de busqueda del repositorio, portadas. Citarlas viola la regla
// APA de que el enlace lleve directamente al trabajo (caso real 2026-07-11:
// la IA cito ".../handle/123456789/36/browse?...offset=723" — una pagina de
// paginacion de DSpace). Se filtran del contexto que ve el modelo y, si aun
// asi las cita, fuerzan el reintento correctivo.
const NON_DOCUMENT_PATH_RE = new RegExp(
  "(/browse([/?]|$)|/discover([/?]|$)|/simple-search|/community-list|/recent-submissions"
  + "|/search([/?]|$)|[?&]query=|/cgi/search|/statistics([/?]|$)|/login([/?]|$))",
  "i",
);

export const findNonDocumentUrls = (urls) => urls.filter((url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Portada del sitio (path vacio o "/"): no es un documento.
  if (parsed.pathname === "/" || parsed.pathname === "") return true;
  return NON_DOCUMENT_PATH_RE.test(parsed.pathname + parsed.search);
});

// Hace un GET con timeout y sin seguir redirecciones (para distinguir 3xx
// explicitamente). Devuelve { status, res } o { error } si hubo timeout o
// error de red.
const fetchWithTimeout = async (url, { timeoutMs, fetchImpl, lookupImpl }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    parsePublicHttpUrl(url);
    const dispatcher = fetchImpl === globalThis.fetch
      ? await publicUrlDispatcher(url, { lookupImpl })
      : null;
    if (fetchImpl !== globalThis.fetch && lookupImpl) {
      await resolvePublicAddresses(url, lookupImpl);
    }
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      ...(dispatcher ? { dispatcher } : {}),
    });
    return { status: res.status, res };
  } catch (err) {
    return { error: err };
  } finally {
    clearTimeout(timer);
  }
};

// Paginas que responden 200 pero cuyo contenido dice que el recurso no
// existe (soft-404, tipico de DSpace y proxies de handle). Frases
// especificas a proposito: un marcador generico como "404" solo daria
// falsos positivos.
const SOFT_404_MARKERS = [
  "página no encontrada",
  "pagina no encontrada",
  "page not found",
  "item not found",
  "handle not found",
  "recurso no encontrado",
  "no se encontró el recurso",
  "no se encontro el recurso",
  "el recurso solicitado no existe",
  "404 not found",
  "error 404",
];

const MAX_REDIRECTS = 3;

// Clasifica una URL:
// - "real": 2xx (directo o tras seguir redirecciones) sin señales anti-bot
//   ni soft-404, o un PDF.
// - "sospechosa": 2xx con muro anti-bot, redireccion a la portada/login del
//   sitio (tipico de DSpace con handles invalidos), o demasiadas
//   redirecciones. Se resuelve por procedencia o contraste Brave.
// - "inventada": 404/410 (directo o al final de la cadena de redirecciones)
//   o cuerpo soft-404 ("página no encontrada" con 200).
// - "noVerificable": 403/429/5xx, timeout o error de red.
// Se usa GET directo (no HEAD): para los 2xx hay que inspeccionar el cuerpo.
// Las redirecciones se siguen manualmente (hasta MAX_REDIRECTS) porque un
// 3xx NO prueba que el recurso exista: hdl.handle.net y varios DSpace
// redirigen tambien handles rotos (a la portada o a una pagina de error).
const classifyUrl = async (url, { timeoutMs, fetchImpl, lookupImpl }) => {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await fetchWithTimeout(currentUrl, { timeoutMs, fetchImpl, lookupImpl });
    if (outcome.error) return "noVerificable";
    const { status, res } = outcome;

    if (status >= 300 && status < 400) {
      const location = res?.headers?.get?.("location");
      if (!location) {
        // Redireccion sin destino legible (o mock sin headers): se mantiene
        // el criterio clasico (el recurso respondio, se considera real).
        return "real";
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return "sospechosa";
      }
      // Aterrizar en la portada o el login del sitio es el patron clasico
      // de "handle invalido" en DSpace: no prueba que el documento exista.
      if (nextUrl.pathname === "/" || nextUrl.pathname === "" || /\/login([/?]|$)/i.test(nextUrl.pathname)) {
        return "sospechosa";
      }
      currentUrl = nextUrl.toString();
      continue;
    }
    if (status === 404 || status === 410) return "inventada";
    if (status >= 200 && status < 300) {
      const contentType = String(res?.headers?.get?.("content-type") ?? "").toLowerCase();
      // El PDF ES el documento: no hay señales anti-bot ni soft-404 que
      // buscar en un binario.
      if (contentType.includes("application/pdf")) return "real";
      let body = "";
      try {
        body = String(await res.text()).slice(0, 30000).toLowerCase();
      } catch {
        // Sin cuerpo legible no hay señales que evaluar: se mantiene el
        // criterio clasico (2xx = real).
        return "real";
      }
      if (BOT_CHALLENGE_MARKERS.some((marker) => body.includes(marker))) return "sospechosa";
      if (SOFT_404_MARKERS.some((marker) => body.includes(marker))) return "inventada";
      return "real";
    }
    return "noVerificable";
  }
  // Cadena de redirecciones demasiado larga: no prueba nada.
  return "sospechosa";
};

// Ejecuta `worker` sobre `items` con un limite de concurrencia dado.
const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(runners);
  return results;
};

// Verifica en paralelo (concurrencia limitada) las URLs dadas y las agrupa
// segun su clasificacion. `options.fetchImpl` permite inyectar un fetch mock
// en tests; por defecto usa el fetch nativo del runtime.
export const verifyUrls = async (urls, options = {}) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupImpl = options.lookupImpl;

  const reales = [];
  const inventadas = [];
  const noVerificables = [];
  const sospechosas = [];

  await runWithConcurrency(urls, concurrency, async (url) => {
    const clasificacion = await classifyUrl(url, { timeoutMs, fetchImpl, lookupImpl });
    if (clasificacion === "real") reales.push(url);
    else if (clasificacion === "inventada") inventadas.push(url);
    else if (clasificacion === "sospechosa") sospechosas.push(url);
    else noVerificables.push(url);
  });

  return { reales, inventadas, noVerificables, sospechosas };
};
