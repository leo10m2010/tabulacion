import { test } from "node:test";
import assert from "node:assert/strict";

// Los tests nunca deben usar claves reales del entorno: la pre-busqueda
// (Brave/Firecrawl) solo se activa cuando un test la inyecta por options.
process.env.BRAVE_API_KEY = "";
process.env.FIRECRAWL_API_KEY = "";
import {
  extractReferenceUrls, verifyUrls, findBannedSourceUrls, findNonDocumentUrls,
} from "../lib/titulos/verify.js";
import { generateTitulos } from "../lib/titulos/index.js";

const validInput = () => ({
  universidad: "Universidad de Huánuco",
  carrera: "Enfermería",
  lugar: "Huánuco",
  numero_variables: "2",
  anio: "2026",
});

// ── extractReferenceUrls ─────────────────────────────────────────────────────

test("extractReferenceUrls extrae y dedup URLs de referencias APA reales", () => {
  const contenido = "1. Pérez, J. (2023). *Control interno*. Universidad de Huánuco. "
    + "https://hdl.handle.net/20.500.12692/84306.\n"
    + "2. Gómez, A. (2022). *Gestión administrativa* (https://repositorio.udh.edu.pe/handle/123/456).\n"
    + "3. Pérez, J. (2023). *Control interno*. https://hdl.handle.net/20.500.12692/84306";

  const urls = extractReferenceUrls(contenido);
  assert.deepEqual(urls, [
    "https://hdl.handle.net/20.500.12692/84306",
    "https://repositorio.udh.edu.pe/handle/123/456",
  ]);
});

test("extractReferenceUrls recorta puntuacion colgante final (punto, coma, parentesis)", () => {
  const contenido = "Ver https://hdl.handle.net/1/2, y tambien https://hdl.handle.net/3/4; "
    + "ademas (https://hdl.handle.net/5/6).";
  const urls = extractReferenceUrls(contenido);
  assert.deepEqual(urls, [
    "https://hdl.handle.net/1/2",
    "https://hdl.handle.net/3/4",
    "https://hdl.handle.net/5/6",
  ]);
});

test("extractReferenceUrls sin URLs devuelve array vacio", () => {
  assert.deepEqual(extractReferenceUrls("sin referencias aqui"), []);
  assert.deepEqual(extractReferenceUrls(""), []);
  assert.deepEqual(extractReferenceUrls(undefined), []);
});

// ── findBannedSourceUrls ─────────────────────────────────────────────────────

test("findBannedSourceUrls detecta dominios prohibidos y sus subdominios", () => {
  const urls = [
    "https://es.scribd.com/document/123/tesis",
    "https://www.studocu.com/pe/document/456",
    "https://repositorio.udh.edu.pe/handle/123/456",
    "https://hdl.handle.net/20.500.12692/84306",
  ];
  assert.deepEqual(findBannedSourceUrls(urls), [
    "https://es.scribd.com/document/123/tesis",
    "https://www.studocu.com/pe/document/456",
  ]);
});

test("findBannedSourceUrls no marca dominios que solo contienen el nombre prohibido", () => {
  // "notscribd.com" no es scribd.com ni subdominio suyo.
  assert.deepEqual(findBannedSourceUrls(["https://notscribd.com/doc/1"]), []);
});

test("findBannedSourceUrls ignora URLs no parseables", () => {
  assert.deepEqual(findBannedSourceUrls(["no-es-una-url"]), []);
});

// ── findNonDocumentUrls ──────────────────────────────────────────────────────

test("findNonDocumentUrls detecta listados, busquedas, portadas y login; respeta handles e items", () => {
  const urls = [
    "https://repositorio.udh.edu.pe/handle/123456789/36/browse?order=ASC&offset=723",
    "https://repositorio.x.edu.pe/discover?query=tesis",
    "https://alicia.concytec.gob.pe/vufind/Search/Results?lookfor=control",
    "https://repositorio.x.edu.pe/",
    "https://repositorio.x.edu.pe/login",
    "https://repositorio.udh.edu.pe/handle/123456789/3866",
    "https://hdl.handle.net/20.500.12692/84306",
    "https://doi.org/10.1000/xyz123",
    "https://repositorio.x.edu.pe/bitstream/1/2/tesis.pdf",
  ];
  assert.deepEqual(findNonDocumentUrls(urls), [
    "https://repositorio.udh.edu.pe/handle/123456789/36/browse?order=ASC&offset=723",
    "https://repositorio.x.edu.pe/discover?query=tesis",
    "https://alicia.concytec.gob.pe/vufind/Search/Results?lookfor=control",
    "https://repositorio.x.edu.pe/",
    "https://repositorio.x.edu.pe/login",
  ]);
});

// ── verifyUrls ───────────────────────────────────────────────────────────────

// Mock de fetch por URL: cada entrada define status, cuerpo (para 2xx),
// location (para 3xx), contentType o error. verifyUrls usa GET directo
// (necesita el cuerpo para detectar muros anti-bot y soft-404) y sigue
// redirecciones manualmente.
const buildFetchMock = (byUrl) => async (url, opts) => {
  const behavior = byUrl[url];
  if (!behavior) throw new Error(`URL no mockeada: ${url}`);
  if (behavior.throw) throw behavior.throw;
  if (behavior.timeout) {
    // simula timeout: espera a que el AbortController del caller aborte.
    await new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }
  return {
    status: behavior.status,
    headers: {
      get: (name) => {
        if (name === "location") return behavior.location ?? null;
        if (name === "content-type") return behavior.contentType ?? "text/html";
        return null;
      },
    },
    text: async () => behavior.body ?? "<html><title>Tesis</title></html>",
  };
};

test("verifyUrls clasifica 200 con cuerpo normal como real", async () => {
  const url = "https://hdl.handle.net/20.500.12692/real1";
  const fetchImpl = buildFetchMock({ [url]: { status: 200 } });
  const result = await verifyUrls([url], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result, { reales: [url], inventadas: [], noVerificables: [], sospechosas: [] });
});

test("verifyUrls clasifica 200 con muro anti-bot como sospechosa (caso RENATI)", async () => {
  const url = "https://renati.sunedu.gob.pe/handle/sunedu/3222203";
  const fetchImpl = buildFetchMock({
    [url]: { status: 200, body: "<html><title>Making sure you're not a bot!</title></html>" },
  });
  const result = await verifyUrls([url], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result.sospechosas, [url]);
  assert.deepEqual(result.reales, []);
});

test("verifyUrls: 302 sin header Location se mantiene real (criterio clasico)", async () => {
  const url = "https://hdl.handle.net/20.500.12692/redirige";
  const fetchImpl = buildFetchMock({ [url]: { status: 302, location: null } });
  const result = await verifyUrls([url], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result.reales, [url]);
});

test("verifyUrls sigue la redireccion: destino 200 real, destino 404 inventada", async () => {
  const urlOk = "https://hdl.handle.net/20.500.12692/valido";
  const destinoOk = "https://repositorio.ucv.edu.pe/handle/20.500.12692/valido";
  const urlRoto = "https://hdl.handle.net/20.500.12692/roto";
  const destinoRoto = "https://repositorio.ucv.edu.pe/handle/20.500.12692/roto";
  const fetchImpl = buildFetchMock({
    [urlOk]: { status: 302, location: destinoOk },
    [destinoOk]: { status: 200 },
    [urlRoto]: { status: 302, location: destinoRoto },
    [destinoRoto]: { status: 404 },
  });
  const result = await verifyUrls([urlOk, urlRoto], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result.reales, [urlOk]);
  assert.deepEqual(result.inventadas, [urlRoto]);
});

test("verifyUrls: redireccion a la portada o al login es sospechosa (handle invalido tipico de DSpace)", async () => {
  const aPortada = "https://repositorio.x.edu.pe/handle/1/malo";
  const aLogin = "https://repositorio.x.edu.pe/handle/1/privado";
  const fetchImpl = buildFetchMock({
    [aPortada]: { status: 302, location: "https://repositorio.x.edu.pe/" },
    [aLogin]: { status: 302, location: "https://repositorio.x.edu.pe/login?from=1" },
  });
  const result = await verifyUrls([aPortada, aLogin], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(new Set(result.sospechosas), new Set([aPortada, aLogin]));
});

test("verifyUrls clasifica soft-404 (200 con 'página no encontrada') como inventada", async () => {
  const url = "https://repositorio.x.edu.pe/handle/1/fantasma";
  const fetchImpl = buildFetchMock({
    [url]: { status: 200, body: "<html><h1>Página no encontrada</h1></html>" },
  });
  const result = await verifyUrls([url], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result.inventadas, [url]);
});

test("verifyUrls clasifica un PDF (content-type application/pdf) como real sin leer el cuerpo", async () => {
  const url = "https://repositorio.x.edu.pe/bitstream/1/2/tesis.pdf";
  const fetchImpl = buildFetchMock({
    [url]: { status: 200, contentType: "application/pdf", body: "%PDF-1.7 binario..." },
  });
  const result = await verifyUrls([url], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result.reales, [url]);
});

test("verifyUrls clasifica 404 y 410 como inventadas", async () => {
  const url404 = "https://hdl.handle.net/20.500.12692/noexiste";
  const url410 = "https://hdl.handle.net/20.500.12692/eliminado";
  const fetchImpl = buildFetchMock({ [url404]: { status: 404 }, [url410]: { status: 410 } });
  const result = await verifyUrls([url404, url410], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(new Set(result.inventadas), new Set([url404, url410]));
});

test("verifyUrls clasifica 403 como no verificable (bloqueo de bots, no evidencia de invencion)", async () => {
  const url = "https://repositorio.udh.edu.pe/handle/bloqueado";
  const fetchImpl = buildFetchMock({ [url]: { status: 403 } });
  const result = await verifyUrls([url], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result.noVerificables, [url]);
});

test("verifyUrls clasifica timeout/error de red como no verificable", async () => {
  const urlTimeout = "https://repositorio.lento.pe/handle/1";
  const urlError = "https://repositorio.caido.pe/handle/2";
  const fetchImpl = buildFetchMock({
    [urlTimeout]: { timeout: true },
    [urlError]: { throw: new Error("network error") },
  });
  const result = await verifyUrls([urlTimeout, urlError], { fetchImpl, timeoutMs: 20 });
  assert.deepEqual(new Set(result.noVerificables), new Set([urlTimeout, urlError]));
});

test("verifyUrls tolera respuestas 2xx sin cuerpo legible (se mantienen reales)", async () => {
  const url = "https://repositorio.udh.edu.pe/handle/sin-body";
  const fetchImpl = async () => ({ status: 200 }); // sin .text()
  const result = await verifyUrls([url], { fetchImpl, timeoutMs: 100 });
  assert.deepEqual(result.reales, [url]);
});

test("verifyUrls procesa multiples URLs en paralelo con concurrencia limitada", async () => {
  const urls = Array.from({ length: 8 }, (_, i) => `https://hdl.handle.net/20.500.12692/${i}`);
  const byUrl = Object.fromEntries(urls.map((u) => [u, { status: 200 }]));
  const fetchImpl = buildFetchMock(byUrl);
  const result = await verifyUrls(urls, { fetchImpl, timeoutMs: 100, concurrency: 5 });
  assert.equal(result.reales.length, 8);
});

// ── generateTitulos + verificacion de fuentes (integracion) ─────────────────

const REFERENCIA_REAL_1 = "https://hdl.handle.net/20.500.12692/11111";
const REFERENCIA_REAL_2 = "https://repositorio.udh.edu.pe/handle/20.500.12692/22222";
const REFERENCIA_INVENTADA = "https://hdl.handle.net/20.500.12692/99999";

const CONTENIDO_CON_REFERENCIAS = (ref1, ref2) => `**TÍTULO 1**\n"Un título de ejemplo"\n\n`
  + `**1. PROBLEMA Y PROPÓSITO A ABORDAR**\nTexto.\n\n`
  + `**6. REFERENCIAS Y ANTECEDENTES**\n`
  + `1. Pérez, J. (2023). *Tesis uno*. ${ref1}.\n`
  + `2. Gómez, A. (2022). *Tesis dos*. ${ref2}.\n`;

// Arma un mock de fetch que distingue llamadas a OpenRouter (POST a
// openrouter.ai) de llamadas de verificacion HTTP a otras URLs.
const buildIntegrationFetchMock = ({ openRouterResponses, urlStatuses }) => {
  let openRouterCall = 0;
  return async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const idx = Math.min(openRouterCall, openRouterResponses.length - 1);
      openRouterCall += 1;
      const body = openRouterResponses[idx];
      return { ok: true, json: async () => body };
    }
    const status = urlStatuses[url];
    if (status === undefined) throw new Error(`URL de verificacion no mockeada: ${url}`);
    if (opts.method === "HEAD" && (status === 405)) {
      return { status: 405 };
    }
    return { status };
  };
};

const openRouterOk = (content) => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { server_tool_use_details: { web_search_requests: 3 } },
});

// Con pre-busqueda activa el flujo corre en dos etapas: la primera llamada a
// OpenRouter es la seleccion de variables (system prompt pide ELEGIR y
// responder JSON). `seed` evita que las consultas dirigidas (cacheadas
// globalmente por texto) se compartan entre tests.
const esLlamadaSeleccion = (body) => body.messages[0].content.includes("ELEGIR");
const seleccionJson = (seed) => JSON.stringify({
  titulos: [
    { variable1: `Variable A ${seed}`, variable2: `Variable B ${seed}`, poblacion: "trabajadores", entidad: "entidad" },
    { variable1: `Variable C ${seed}`, variable2: `Variable D ${seed}`, poblacion: "usuarios", entidad: "entidad" },
    { variable1: `Variable E ${seed}`, variable2: `Variable F ${seed}`, poblacion: "clientes", entidad: "entidad" },
  ],
});

test("generateTitulos caso feliz: todas las URLs reales, sin reintento", async () => {
  const originalFetch = global.fetch;
  const contenido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, REFERENCIA_REAL_2);
  let openRouterCalls = 0;
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      return { ok: true, json: async () => openRouterOk(contenido) };
    }
    const statuses = {
      [REFERENCIA_REAL_1]: 200,
      [REFERENCIA_REAL_2]: 200,
    };
    void opts;
    return { status: statuses[url] };
  };
  try {
    const result = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(openRouterCalls, 1);
    assert.equal(result.contenido, contenido.trim());
    assert.deepEqual(result.fuentes, { reales: 2, noVerificables: 0 });
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos con URL inventada (404) hace reintento correctivo y devuelve el contenido corregido", async () => {
  const originalFetch = global.fetch;
  const contenidoInicial = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, REFERENCIA_INVENTADA);
  const contenidoCorregido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, REFERENCIA_REAL_2);

  let openRouterCalls = 0;
  const bodies = [];
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      bodies.push(JSON.parse(opts.body));
      const content = openRouterCalls === 1 ? contenidoInicial : contenidoCorregido;
      return { ok: true, json: async () => openRouterOk(content) };
    }
    const statuses = {
      [REFERENCIA_REAL_1]: 200,
      [REFERENCIA_INVENTADA]: 404,
      [REFERENCIA_REAL_2]: 200,
    };
    return { status: statuses[url] };
  };
  try {
    const result = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(openRouterCalls, 2);
    // El segundo intento debe incluir el historial: system, user original,
    // assistant con la respuesta anterior, user con la correccion.
    const segundoIntentoMessages = bodies[1].messages;
    assert.equal(segundoIntentoMessages.length, 4);
    assert.equal(segundoIntentoMessages[0].role, "system");
    assert.equal(segundoIntentoMessages[1].role, "user");
    assert.equal(segundoIntentoMessages[2].role, "assistant");
    assert.equal(segundoIntentoMessages[2].content, contenidoInicial.trim());
    assert.equal(segundoIntentoMessages[3].role, "user");
    assert.ok(segundoIntentoMessages[3].content.includes(REFERENCIA_INVENTADA));
    assert.equal(result.contenido, contenidoCorregido.trim());
    assert.deepEqual(result.fuentes, { reales: 2, noVerificables: 0 });
  } finally {
    global.fetch = originalFetch;
  }
});

test("URL tras muro anti-bot que vino de la pre-busqueda se acepta por procedencia (sin reintento)", async () => {
  const originalFetch = global.fetch;
  const URL_RENATI = "https://renati.sunedu.gob.pe/handle/sunedu/1234567";
  const contenido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, URL_RENATI);
  let openRouterCalls = 0;
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      const body = JSON.parse(opts.body);
      return { ok: true, json: async () => openRouterOk(esLlamadaSeleccion(body) ? seleccionJson("der") : contenido) };
    }
    if (url === URL_RENATI) {
      return { status: 200, text: async () => "<title>Making sure you're not a bot!</title>" };
    }
    return { status: 200, text: async () => "<title>Tesis</title>" };
  };
  try {
    const result = await generateTitulos({ ...validInput(), carrera: "Derecho" }, {
      apiKey: "test-key",
      websearch: {
        braveApiKey: "brave-key",
        firecrawlApiKey: null,
        delayMs: 0,
        // La pre-busqueda devuelve las DOS URLs citadas (procedencia): con
        // el flujo de dos etapas toda cita debe venir de estos resultados.
        fetchImpl: async () => ({
          status: 200,
          json: async () => ({
            web: {
              results: [
                { title: "Tesis RENATI", url: URL_RENATI, description: "d" },
                { title: "Tesis real", url: REFERENCIA_REAL_1, description: "d" },
              ],
            },
          }),
        }),
      },
    });
    // Dos etapas: 1 llamada de seleccion + 1 de desarrollo, sin correctivo.
    assert.equal(openRouterCalls, 2);
    assert.deepEqual(result.fuentes, { reales: 2, noVerificables: 0 });
  } finally {
    global.fetch = originalFetch;
  }
});

test("URL tras muro anti-bot que Brave no conoce se trata como inventada y dispara el reintento", async () => {
  const originalFetch = global.fetch;
  const URL_RENATI_FALSA = "https://renati.sunedu.gob.pe/handle/sunedu/7777777";
  const URL_OTRA = "https://repositorio.otro.edu.pe/handle/1/1";
  const contenidoInicial = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, URL_RENATI_FALSA);
  const contenidoCorregido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, URL_OTRA);
  let openRouterCalls = 0;
  let devCalls = 0;
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      const body = JSON.parse(opts.body);
      if (esLlamadaSeleccion(body)) {
        return { ok: true, json: async () => openRouterOk(seleccionJson("eco")) };
      }
      devCalls += 1;
      return { ok: true, json: async () => openRouterOk(devCalls === 1 ? contenidoInicial : contenidoCorregido) };
    }
    if (url === URL_RENATI_FALSA) {
      return { status: 200, text: async () => "<title>Making sure you're not a bot!</title>" };
    }
    return { status: 200, text: async () => "<title>Tesis</title>" };
  };
  try {
    const result = await generateTitulos({ ...validInput(), carrera: "Economía" }, {
      apiKey: "test-key",
      websearch: {
        braveApiKey: "brave-key",
        firecrawlApiKey: null,
        delayMs: 0,
        // Brave nunca devuelve la URL falsa (ni en pre-busqueda ni en el
        // contraste): la sospechosa se degrada a inventada.
        fetchImpl: async () => ({
          status: 200,
          json: async () => ({ web: { results: [{ title: "Otra tesis", url: URL_OTRA, description: "d" }] } }),
        }),
      },
    });
    // Dos etapas + correctivo: seleccion, desarrollo y reintento correctivo.
    assert.equal(openRouterCalls, 3);
    assert.equal(result.contenido, contenidoCorregido.trim());
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos con URL de fuente prohibida (Scribd) hace reintento correctivo aunque responda 200", async () => {
  const originalFetch = global.fetch;
  const URL_SCRIBD = "https://es.scribd.com/document/123/tesis-copiada";
  const contenidoInicial = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, URL_SCRIBD);
  const contenidoCorregido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, REFERENCIA_REAL_2);

  let openRouterCalls = 0;
  const bodies = [];
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      bodies.push(JSON.parse(opts.body));
      const content = openRouterCalls === 1 ? contenidoInicial : contenidoCorregido;
      return { ok: true, json: async () => openRouterOk(content) };
    }
    // Scribd responde 200 (la URL existe), pero igual esta prohibida. Nunca
    // deberia consultarse por HTTP: se excluye antes de verifyUrls.
    const statuses = {
      [REFERENCIA_REAL_1]: 200,
      [URL_SCRIBD]: 200,
      [REFERENCIA_REAL_2]: 200,
    };
    return { status: statuses[url] };
  };
  try {
    const result = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(openRouterCalls, 2);
    const mensajeCorreccion = bodies[1].messages[3];
    assert.equal(mensajeCorreccion.role, "user");
    assert.ok(mensajeCorreccion.content.includes(URL_SCRIBD));
    assert.ok(mensajeCorreccion.content.includes("prohibidas"));
    assert.equal(result.contenido, contenidoCorregido.trim());
    assert.deepEqual(result.fuentes, { reales: 2, noVerificables: 0 });
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos con fuente prohibida persistente tras el reintento lanza Error", async () => {
  const originalFetch = global.fetch;
  const URL_STUDOCU = "https://www.studocu.com/pe/document/456/apuntes";
  const contenido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, URL_STUDOCU);
  let openRouterCalls = 0;
  global.fetch = async (url) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      return { ok: true, json: async () => openRouterOk(contenido) };
    }
    return { status: 200, text: async () => "<title>Doc</title>" };
  };
  try {
    await assert.rejects(
      () => generateTitulos(validInput(), { apiKey: "test-key" }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(URL_STUDOCU));
        return true;
      },
    );
    assert.equal(openRouterCalls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("flujo dos etapas: URL fuera de los resultados del sistema se rechaza aunque responda 200", async () => {
  const originalFetch = global.fetch;
  const URL_PROV = "https://repositorio.prov.edu.pe/handle/1/111";
  const URL_ALUCINADA = "https://repositorio.real.edu.pe/handle/2/222"; // existe, pero nadie se la dio
  const URL_NUEVA = "https://repositorio.nueva.edu.pe/handle/3/333"; // hallada por el correctivo
  const contenidoInicial = CONTENIDO_CON_REFERENCIAS(URL_PROV, URL_ALUCINADA);
  const contenidoCorregido = CONTENIDO_CON_REFERENCIAS(URL_PROV, URL_NUEVA);
  let openRouterCalls = 0;
  let devCalls = 0;
  let mensajeCorreccion = null;
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      const body = JSON.parse(opts.body);
      if (esLlamadaSeleccion(body)) {
        return { ok: true, json: async () => openRouterOk(seleccionJson("prov")) };
      }
      devCalls += 1;
      if (devCalls === 2) {
        mensajeCorreccion = body.messages[body.messages.length - 1].content;
      }
      return { ok: true, json: async () => openRouterOk(devCalls === 1 ? contenidoInicial : contenidoCorregido) };
    }
    // TODAS las URLs responden 200 con cuerpo normal: la alucinada solo debe
    // caer por no estar en la procedencia, no por HTTP.
    return { status: 200, headers: { get: () => null }, text: async () => "<title>Tesis</title>" };
  };
  try {
    const result = await generateTitulos({ ...validInput(), carrera: "Sociología" }, {
      apiKey: "test-key",
      websearch: {
        braveApiKey: "brave-key",
        firecrawlApiKey: null,
        delayMs: 0,
        // El sistema solo entrego URL_PROV en sus resultados.
        fetchImpl: async () => ({
          status: 200,
          json: async () => ({ web: { results: [{ title: "Tesis prov", url: URL_PROV, description: "d" }] } }),
        }),
      },
    });
    // seleccion + desarrollo + correctivo.
    assert.equal(openRouterCalls, 3);
    assert.ok(mensajeCorreccion.includes(URL_ALUCINADA));
    assert.ok(mensajeCorreccion.includes("NO aparecen") || mensajeCorreccion.includes("NO EXISTEN"));
    // El correctivo (con herramienta) puede citar URLs nuevas: no se exige
    // procedencia en su verificacion y el job cierra bien.
    assert.equal(result.contenido, contenidoCorregido.trim());
  } finally {
    global.fetch = originalFetch;
  }
});

test("URL de listado (browse) citada dispara el correctivo con el mensaje de documento directo", async () => {
  const originalFetch = global.fetch;
  const URL_BROWSE = "https://repositorio.udh.edu.pe/handle/123456789/36/browse?offset=723";
  const contenidoInicial = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, URL_BROWSE);
  const contenidoCorregido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, REFERENCIA_REAL_2);
  let openRouterCalls = 0;
  let mensajeCorreccion = null;
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      const body = JSON.parse(opts.body);
      if (openRouterCalls === 2) {
        mensajeCorreccion = body.messages[body.messages.length - 1].content;
      }
      return { ok: true, json: async () => openRouterOk(openRouterCalls === 1 ? contenidoInicial : contenidoCorregido) };
    }
    return { status: 200, headers: { get: () => null }, text: async () => "<title>Tesis</title>" };
  };
  try {
    const result = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(openRouterCalls, 2);
    assert.ok(mensajeCorreccion.includes(URL_BROWSE));
    assert.ok(mensajeCorreccion.includes("listado"));
    assert.equal(result.contenido, contenidoCorregido.trim());
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos con URL inventada persistente tras el reintento lanza Error con las URLs", async () => {
  const originalFetch = global.fetch;
  const contenido = CONTENIDO_CON_REFERENCIAS(REFERENCIA_REAL_1, REFERENCIA_INVENTADA);
  let openRouterCalls = 0;
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalls += 1;
      void opts;
      return { ok: true, json: async () => openRouterOk(contenido) };
    }
    const statuses = {
      [REFERENCIA_REAL_1]: 200,
      [REFERENCIA_INVENTADA]: 404,
    };
    return { status: statuses[url] };
  };
  try {
    await assert.rejects(
      () => generateTitulos(validInput(), { apiKey: "test-key" }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(REFERENCIA_INVENTADA));
        return true;
      },
    );
    assert.equal(openRouterCalls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
