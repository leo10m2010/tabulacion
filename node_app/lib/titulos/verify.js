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

// Hace un solo request HTTP con timeout y sin seguir redirecciones (para
// poder distinguir 3xx explicitamente). Devuelve { status } o { error } si
// hubo timeout/error de red.
const fetchWithTimeout = async (url, { method, timeoutMs, fetchImpl }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    return { status: res.status };
  } catch (err) {
    return { error: err };
  } finally {
    clearTimeout(timer);
  }
};

// Clasifica una URL como "real" (2xx/3xx), "inventada" (404/410) o
// "noVerificable" (403, 429, 5xx, timeout, error de red). Intenta HEAD
// primero; si el servidor responde 405/501 (metodo no soportado) o hay un
// error de red en el HEAD, reintenta con GET antes de resolver.
const classifyUrl = async (url, { timeoutMs, fetchImpl }) => {
  let outcome = await fetchWithTimeout(url, { method: "HEAD", timeoutMs, fetchImpl });

  const needsGetFallback = outcome.error
    || outcome.status === 405
    || outcome.status === 501;
  if (needsGetFallback) {
    outcome = await fetchWithTimeout(url, { method: "GET", timeoutMs, fetchImpl });
  }

  if (outcome.error) return "noVerificable";
  const { status } = outcome;
  if (status >= 200 && status < 400) return "real";
  if (status === 404 || status === 410) return "inventada";
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

  await runWithConcurrency(urls, concurrency, async (url) => {
    const clasificacion = await classifyUrl(url, { timeoutMs, fetchImpl });
    if (clasificacion === "real") reales.push(url);
    else if (clasificacion === "inventada") inventadas.push(url);
    else noVerificables.push(url);
  });

  return { reales, inventadas, noVerificables };
};
