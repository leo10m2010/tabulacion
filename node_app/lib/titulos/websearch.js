// Pre-busqueda del Generador de Titulos: el SISTEMA ejecuta un set fijo y
// acotado de busquedas (Brave como motor principal, Firecrawl como respaldo)
// ANTES de llamar a la IA, y le inyecta los resultados en el mensaje user.
// Ventajas frente a dejar que el modelo busque solo via openrouter:web_search:
// - Cuota predecible: maximo ~7 busquedas por job (planes gratis: Brave
//   2000/mes, Firecrawl ~500 creditos unicos — Firecrawl SOLO como fallback).
// - Menos busquedas del modelo => menos costo OpenRouter y menos riesgo de
//   glitches (tool_calls como texto).
// - Las URLs de los resultados son reales por construccion.
// La herramienta openrouter:web_search se mantiene como complemento acotado
// (el prompt le permite pocas busquedas adicionales si le falta algo).

import { normalizeUrlForMatch, findBannedSourceUrls, findNonDocumentUrls } from "./verify.js";

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";
const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/search";

// Cache en memoria por consulta: clientes de la misma carrera/universidad
// repiten exactamente las mismas consultas y no deben re-gastar cuota.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

const cacheGet = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.results;
};

const cacheSet = (key, results) => {
  if (cache.size >= CACHE_MAX) {
    // Se descarta la entrada mas vieja (orden de insercion del Map).
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { results, expiresAt: Date.now() + CACHE_TTL_MS });
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const fetchJson = async (url, init, { timeoutMs, fetchImpl }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const payload = await res.json().catch(() => null);
    return { status: res.status, payload };
  } finally {
    clearTimeout(timer);
  }
};

// Busca en Brave (GET, X-Subscription-Token). Devuelve resultados
// normalizados [{ title, url, description }] o lanza si el status no es 2xx.
const braveSearch = async (query, { apiKey, count, timeoutMs, fetchImpl }) => {
  const params = new URLSearchParams({ q: query, count: String(count) });
  const { status, payload } = await fetchJson(`${BRAVE_URL}?${params}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  }, { timeoutMs, fetchImpl });
  if (status < 200 || status >= 300) {
    throw new Error(`Brave respondio HTTP ${status}`);
  }
  const results = payload?.web?.results ?? [];
  return results.map((r) => ({
    title: String(r?.title ?? "").trim(),
    url: String(r?.url ?? "").trim(),
    description: String(r?.description ?? "").trim(),
  })).filter((r) => r.url);
};

// Busca en Firecrawl (POST, Bearer). Solo se usa como respaldo de Brave:
// el plan gratis trae ~500 creditos UNICOS, no mensuales.
const firecrawlSearch = async (query, { apiKey, count, timeoutMs, fetchImpl }) => {
  const { status, payload } = await fetchJson(FIRECRAWL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, limit: count }),
  }, { timeoutMs, fetchImpl });
  if (status < 200 || status >= 300) {
    throw new Error(`Firecrawl respondio HTTP ${status}`);
  }
  const results = payload?.data ?? [];
  return results.map((r) => ({
    title: String(r?.title ?? "").trim(),
    url: String(r?.url ?? "").trim(),
    description: String(r?.description ?? "").trim(),
  })).filter((r) => r.url);
};

// Ejecuta una consulta con cache y fallback Brave -> Firecrawl. Devuelve []
// si ambos fallan (la generacion continua igual: el modelo aun tiene su
// herramienta de busqueda como complemento).
export const searchWithFallback = async (query, options = {}) => {
  const braveKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;
  const firecrawlKey = options.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY;
  const count = options.count ?? 8;
  const timeoutMs = options.timeoutMs ?? 15000;
  const fetchImpl = options.fetchImpl ?? fetch;

  const cached = cacheGet(query);
  if (cached) return cached;

  // Los resultados de fuentes no académicas prohibidas (Scribd, Studocu,
  // etc.) y las URLs que no son documentos (listados /browse, paginas de
  // busqueda, portadas) se descartan aqui: la pre-busqueda jamas debe
  // ofrecerle al modelo una URL que las reglas de referencias le prohiben
  // citar o que no conduce a un trabajo concreto.
  const dropBanned = (results) => {
    const urls = results.map((r) => r.url);
    const excluded = new Set([...findBannedSourceUrls(urls), ...findNonDocumentUrls(urls)]);
    return results.filter((r) => !excluded.has(r.url));
  };

  if (braveKey) {
    try {
      const results = dropBanned(
        await braveSearch(query, { apiKey: braveKey, count, timeoutMs, fetchImpl }),
      );
      if (results.length > 0) {
        cacheSet(query, results);
        return results;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[titulos] Brave fallo para "${query}": ${err.message}; se intenta Firecrawl.`);
    }
  }

  if (firecrawlKey) {
    try {
      // Menos resultados en el fallback: los creditos de Firecrawl son unicos.
      const results = dropBanned(await firecrawlSearch(query, {
        apiKey: firecrawlKey, count: Math.min(count, 5), timeoutMs, fetchImpl,
      }));
      if (results.length > 0) {
        cacheSet(query, results);
        return results;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[titulos] Firecrawl fallo para "${query}": ${err.message}.`);
    }
  }

  return [];
};

// Contraste de una URL contra el indice de Brave: para dominios con muro
// anti-bot (RENATI devuelve 200 a TODO, exista o no el handle) el unico modo
// barato de saber si una URL citada existe es preguntarle a un buscador.
// Devuelve true (el indice conoce la URL exacta), false (no aparece: muy
// probablemente inventada) o null (sin clave o Brave fallo: no se castiga).
export const braveUrlCheck = async (url, options = {}) => {
  const braveKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;
  if (!braveKey) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const query = String(url).replace(/^https?:\/\//, "");
  const cacheKey = `urlcheck:${query}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.found;

  try {
    const delayMs = options.delayMs ?? 1100;
    if (delayMs > 0) await sleep(delayMs); // respeta 1 consulta/seg del plan gratis
    const results = await braveSearch(query, { apiKey: braveKey, count: 10, timeoutMs, fetchImpl });
    const target = normalizeUrlForMatch(url);
    const found = results.some((r) => normalizeUrlForMatch(r.url) === target);
    cacheSet(cacheKey, { found });
    return found;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[titulos] braveUrlCheck fallo para "${url}": ${err.message}.`);
    return null;
  }
};

// Ejecuta una lista de consultas arbitraria con el mismo pipeline (cache,
// fallback Brave->Firecrawl, rate limit). La usa lib/matriz para la busqueda
// dirigida de dimensiones. Devuelve null sin claves o sin resultados.
export const gatherCustomSearchContext = async (queries, sectionLabel, logLabel, options = {}) => {
  const braveKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;
  const firecrawlKey = options.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!braveKey && !firecrawlKey) return null;
  return runQueries(queries, sectionLabel, logLabel, options);
};

// Consultas fijas del job: cubren universidad, nacional (ALICIA/RENATI) e
// internacional. Set acotado a proposito — la cuota es predecible.
export const buildQueries = (datos, repositoryDomain) => {
  const { universidad, carrera, lugar } = datos;
  const queries = [
    repositoryDomain
      ? `tesis ${carrera} site:${repositoryDomain}`
      : `tesis ${carrera} ${universidad} repositorio institucional`,
    `tesis ${carrera} site:alicia.concytec.gob.pe`,
    `tesis ${carrera} site:renati.sunedu.gob.pe`,
    `tesis ${carrera} ${lugar}`,
    `tesis ${carrera} repositorio universidad Ecuador Colombia`,
    `tesis ${carrera} repositorio universidad México Chile España`,
    `${carrera} artículo scielo redalyc dialnet`,
  ];
  return queries;
};

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Ejecuta una lista de consultas (secuencial: Brave gratis limita a 1
// consulta/segundo) y arma el bloque de texto que se inyecta en el mensaje
// user. Devuelve null si ninguna consulta trajo resultados.
const runQueries = async (queries, sectionLabel, logLabel, options = {}) => {
  const delayMs = options.delayMs ?? 1100;
  const sections = [];
  let totalResults = 0;

  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    // eslint-disable-next-line no-await-in-loop
    const results = await searchWithFallback(query, options);
    if (results.length > 0) {
      totalResults += results.length;
      const lines = results.map((r) => `- ${truncate(r.title, 120)} | ${r.url}`
        + (r.description ? ` | ${truncate(r.description, 200)}` : ""));
      sections.push(`### ${sectionLabel}: ${query}\n${lines.join("\n")}`);
    }
    if (i < queries.length - 1 && delayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[titulos] ${logLabel}: ${queries.length} consultas, ${totalResults} resultados.`);
  if (sections.length === 0) return null;
  return sections.join("\n\n");
};

// Pre-busqueda generica del job (por carrera/universidad). Devuelve null si
// no hay ninguna clave configurada o si ninguna consulta trajo resultados
// (en ese caso el flujo queda igual que antes).
export const gatherSearchContext = async (datos, repositoryDomain, options = {}) => {
  const braveKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;
  const firecrawlKey = options.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!braveKey && !firecrawlKey) return null;
  return runQueries(buildQueries(datos, repositoryDomain), "Búsqueda", "pre-busqueda", options);
};

// Consultas dirigidas a las variables ya elegidas en la Etapa 1: son las
// mismas busquedas especificas que antes hacia el modelo (lento y propenso
// al glitch), pero ejecutadas por el sistema — deterministas y con URLs
// reales por construccion. Set acotado: 2 por titulo (nacional +
// internacional) y, si hay dominio de repositorio, 1 mas por titulo.
export const buildTargetedQueries = (seleccion, repositoryDomain) => {
  const queries = [];
  for (const t of seleccion) {
    const vars = t.variable2 ? `"${t.variable1}" "${t.variable2}"` : `"${t.variable1}"`;
    queries.push(`tesis ${vars} Perú repositorio`);
    queries.push(`tesis ${vars} repositorio universidad Ecuador Colombia México Chile España`);
    if (repositoryDomain) {
      queries.push(`tesis "${t.variable1}" site:${repositoryDomain}`);
    }
  }
  return queries;
};

// Ejecuta las consultas dirigidas y arma el bloque "RESULTADOS DE BÚSQUEDA
// DIRIGIDA". Devuelve null sin claves o sin resultados (la Etapa 2 continua
// solo con la pre-busqueda generica).
export const gatherTargetedSearchContext = async (seleccion, repositoryDomain, options = {}) => {
  const braveKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;
  const firecrawlKey = options.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!braveKey && !firecrawlKey) return null;
  return runQueries(
    buildTargetedQueries(seleccion, repositoryDomain),
    "Búsqueda dirigida",
    "busqueda dirigida",
    options,
  );
};
