// Verificacion de autenticidad de fuentes del Generador de Titulos: extrae
// las URLs citadas en los antecedentes y las verifica por HTTP para detectar
// handles/URLs inventados por la IA. NUNCA se generan URLs; solo se valida
// que las que la IA escribio realmente existan en el servidor remoto.

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
// resultados de busqueda): minusculas, https, sin slash final.
export const normalizeUrlForMatch = (url) => String(url ?? "")
  .trim()
  .toLowerCase()
  .replace(/^http:\/\//, "https://")
  .replace(/\/+$/, "");

// Hace un GET con timeout y sin seguir redirecciones (para distinguir 3xx
// explicitamente). Devuelve { status, res } o { error } si hubo timeout o
// error de red.
const fetchWithTimeout = async (url, { timeoutMs, fetchImpl }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    return { status: res.status, res };
  } catch (err) {
    return { error: err };
  } finally {
    clearTimeout(timer);
  }
};

// Clasifica una URL:
// - "real": 3xx (el recurso redirige, existe) o 2xx sin señales anti-bot.
// - "sospechosa": 2xx pero el cuerpo es un muro anti-bot (no prueba nada).
// - "inventada": 404/410 (el servidor confirma que no existe).
// - "noVerificable": 403/429/5xx, timeout o error de red.
// Se usa GET directo (no HEAD): para los 2xx hay que inspeccionar el cuerpo.
const classifyUrl = async (url, { timeoutMs, fetchImpl }) => {
  const outcome = await fetchWithTimeout(url, { timeoutMs, fetchImpl });
  if (outcome.error) return "noVerificable";
  const { status, res } = outcome;
  if (status >= 300 && status < 400) return "real";
  if (status === 404 || status === 410) return "inventada";
  if (status >= 200 && status < 300) {
    let body = "";
    try {
      body = String(await res.text()).slice(0, 30000).toLowerCase();
    } catch {
      // Sin cuerpo legible no hay señales anti-bot que evaluar: se mantiene
      // el criterio clasico (2xx = real).
      return "real";
    }
    if (BOT_CHALLENGE_MARKERS.some((marker) => body.includes(marker))) return "sospechosa";
    return "real";
  }
  return "noVerificable";
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

  const reales = [];
  const inventadas = [];
  const noVerificables = [];
  const sospechosas = [];

  await runWithConcurrency(urls, concurrency, async (url) => {
    const clasificacion = await classifyUrl(url, { timeoutMs, fetchImpl });
    if (clasificacion === "real") reales.push(url);
    else if (clasificacion === "inventada") inventadas.push(url);
    else if (clasificacion === "sospechosa") sospechosas.push(url);
    else noVerificables.push(url);
  });

  return { reales, inventadas, noVerificables, sospechosas };
};
