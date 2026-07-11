import { test } from "node:test";
import assert from "node:assert/strict";

// Los tests nunca deben usar claves reales del entorno: la pre-busqueda
// (Brave/Firecrawl) solo se activa cuando un test la inyecta por options.
process.env.BRAVE_API_KEY = "";
process.env.FIRECRAWL_API_KEY = "";
import JSZip from "jszip";
import { loadTitulosPrompts, buildSystemPrompt, buildSeleccionSystemPrompt } from "../lib/titulos/prompt.js";
import { resolveRepositoryDomain } from "../lib/titulos/universities.js";
import { normalizeTitulosInput, generateTitulos, cleanTitulosContent } from "../lib/titulos/index.js";
import { stripToolCallMarkup, buildBaseUserContent, parseSeleccion } from "../lib/titulos/openrouter.js";
import {
  searchWithFallback, buildQueries, buildTargetedQueries, gatherSearchContext,
} from "../lib/titulos/websearch.js";
import { buildTitulosDocx } from "../lib/titulos/docx.js";

// Seleccion valida de la Etapa 1 (flujo en dos etapas). `seed` distingue las
// variables entre tests: las consultas dirigidas se cachean globalmente por
// texto en websearch.js y variables repetidas contaminarian otros tests.
const seleccionJson = (seed) => JSON.stringify({
  titulos: [
    { variable1: `Clima organizacional ${seed}`, variable2: `Satisfacción laboral ${seed}`, poblacion: "trabajadores", entidad: "hospital" },
    { variable1: `Gestión administrativa ${seed}`, variable2: `Calidad de servicio ${seed}`, poblacion: "usuarios", entidad: "municipalidad" },
    { variable1: `Estrés laboral ${seed}`, variable2: `Desempeño laboral ${seed}`, poblacion: "enfermeras", entidad: "clínica" },
  ],
});

// Distingue en los mocks la llamada de seleccion (Etapa 1) de la de
// desarrollo: el system prompt de seleccion pide ELEGIR y responder JSON.
const esLlamadaSeleccion = (body) => body.messages[0].content.includes("ELEGIR");

// ── Parsing del .md ─────────────────────────────────────────────────────────

test("loadTitulosPrompts extrae system prompt y ambas plantillas, no vacias", () => {
  const { systemPrompt, plantillaA, plantillaB } = loadTitulosPrompts();
  assert.ok(systemPrompt.length > 100);
  assert.ok(plantillaA.length > 100);
  assert.ok(plantillaB.length > 100);
});

test("solo la Plantilla A trae HIPOTESIS; la Plantilla B no", () => {
  const { plantillaA, plantillaB } = loadTitulosPrompts();
  assert.ok(plantillaA.includes("HIPÓTESIS"));
  assert.ok(!plantillaB.includes("HIPÓTESIS"));
});

test("la Plantilla A tiene 6 puntos y la Plantilla B tiene 5 (sin hipotesis)", () => {
  const { plantillaA, plantillaB } = loadTitulosPrompts();
  assert.ok(plantillaA.includes("**6. REFERENCIAS Y ANTECEDENTES**"));
  assert.ok(plantillaB.includes("**5. REFERENCIAS Y ANTECEDENTES**"));
  assert.ok(!plantillaB.includes("**6."));
});

test("el system prompt trae el paso de busqueda obligatoria en repositorios", () => {
  const { systemPrompt } = loadTitulosPrompts();
  assert.ok(systemPrompt.includes("PASO 1: BÚSQUEDA EN REPOSITORIOS"));
});

// ── buildSystemPrompt: estatico (cacheable) + seleccion de plantilla ────────

test("numero_variables=2 adjunta la Plantilla A (con HIPOTESIS) y NO la B", () => {
  const prompt = buildSystemPrompt("2");
  assert.ok(prompt.includes("PLANTILLA A — estructura obligatoria"));
  assert.ok(prompt.includes("HIPÓTESIS"));
  assert.ok(!prompt.includes("PLANTILLA B — estructura obligatoria"));
});

test("numero_variables=1 adjunta la Plantilla B (sin HIPOTESIS) y NO la A", () => {
  const prompt = buildSystemPrompt("1");
  assert.ok(prompt.includes("PLANTILLA B — estructura obligatoria"));
  assert.ok(!prompt.includes("HIPÓTESIS"));
});

test("el system prompt es estatico: sin datos de cliente, con placeholders literales", () => {
  // Sin interpolacion: el prefijo es identico entre solicitudes (cache).
  const prompt = buildSystemPrompt("2");
  assert.ok(prompt.includes("{{anio}}"));
  assert.ok(prompt.includes("DATOS DEL ESTUDIANTE"));
  assert.ok(!prompt.includes("{{carrera}}"));
  assert.ok(!prompt.includes("{{universidad}}"));
  // Dos llamadas producen exactamente el mismo texto.
  assert.equal(prompt, buildSystemPrompt("2"));
});

// ── buildBaseUserContent: datos del cliente en el mensaje user ──────────────

test("el mensaje user lleva los DATOS DEL ESTUDIANTE y las directivas", () => {
  const content = buildBaseUserContent("repositorio.udh.edu.pe", {
    universidad: "Universidad de Huánuco",
    carrera: "Enfermería",
    lugar: "Huánuco",
    numeroVariables: "2",
    anio: "2026",
  });
  assert.ok(content.startsWith("DATOS DEL ESTUDIANTE:"));
  assert.ok(content.includes("Enfermería"));
  assert.ok(content.includes("Huánuco"));
  assert.ok(content.includes("2026"));
  assert.ok(content.includes("correlacional, Plantilla A"));
  assert.ok(content.includes("repositorio.udh.edu.pe"));
  assert.ok(content.includes("PLAN DE BÚSQUEDA"));
});

// ── Mapeo universidad -> dominio ────────────────────────────────────────────

test("resuelve dominio por nombre completo y por sigla, tolerando tildes/mayusculas", () => {
  assert.equal(resolveRepositoryDomain("Universidad de Huánuco"), "repositorio.udh.edu.pe");
  assert.equal(resolveRepositoryDomain("UDH"), "repositorio.udh.edu.pe");
  assert.equal(resolveRepositoryDomain("universidad cesar vallejo"), "repositorio.ucv.edu.pe");
  assert.equal(resolveRepositoryDomain("UCV"), "repositorio.ucv.edu.pe");
  assert.equal(resolveRepositoryDomain("Universidad Nacional Mayor de San Marcos"), "cybertesis.unmsm.edu.pe");
  assert.equal(resolveRepositoryDomain("Universidad Nacional de Trujillo"), "repositorio.unitru.edu.pe");
  assert.equal(resolveRepositoryDomain("Universidad Señor de Sipán"), "repositorio.uss.edu.pe");
  assert.equal(resolveRepositoryDomain("Pontificia Universidad Católica del Perú"), "tesis.pucp.edu.pe");
});

test("distingue universidades con nombres parecidos", () => {
  // Piura: la nacional y la privada comparten "de piura".
  assert.equal(resolveRepositoryDomain("Universidad Nacional de Piura"), "repositorio.unp.edu.pe");
  assert.equal(resolveRepositoryDomain("Universidad de Piura"), "pirhua.udep.edu.pe");
  // San Martin: la nacional (Tarapoto) y la de Porres (Lima).
  assert.equal(resolveRepositoryDomain("Universidad de San Martín de Porres"), "repositorio.usmp.edu.pe");
  assert.equal(resolveRepositoryDomain("Universidad Nacional de San Martín"), "repositorio.unsm.edu.pe");
  // La sigla UNAP es del Altiplano (dueno de unap.edu.pe); Iquitos va por nombre.
  assert.equal(resolveRepositoryDomain("UNAP"), "repositorio.unap.edu.pe");
  assert.equal(resolveRepositoryDomain("Universidad Nacional de la Amazonía Peruana"), "repositorio.unapiquitos.edu.pe");
});

test("sin match conocido, resolveRepositoryDomain devuelve null", () => {
  assert.equal(resolveRepositoryDomain("Universidad de Springfield"), null);
  assert.equal(resolveRepositoryDomain(""), null);
});

// ── normalizeTitulosInput (validacion 400) ──────────────────────────────────

const validInput = () => ({
  universidad: "Universidad de Huánuco",
  carrera: "Enfermería",
  lugar: "Huánuco",
  numero_variables: "2",
  anio: "2026",
});

test("input valido pasa sin errores y devuelve numeroVariables como string", () => {
  const out = normalizeTitulosInput(validInput());
  assert.equal(out.universidad, "Universidad de Huánuco");
  assert.equal(out.numeroVariables, "2");
  assert.equal(out.anio, "2026");
});

test("acepta numero_variables como numero (no solo string)", () => {
  const out = normalizeTitulosInput({ ...validInput(), numero_variables: 1 });
  assert.equal(out.numeroVariables, "1");
});

test("anio ausente/vacio se acepta y queda vacio (el default lo aplica generateTitulos)", () => {
  const { anio, ...rest } = validInput();
  void anio;
  const out = normalizeTitulosInput(rest);
  assert.equal(out.anio, "");
});

test("rechaza universidad/carrera/lugar vacios", () => {
  assert.throws(() => normalizeTitulosInput({ ...validInput(), universidad: "  " }), /universidad/i);
  assert.throws(() => normalizeTitulosInput({ ...validInput(), carrera: "" }), /carrera/i);
  assert.throws(() => normalizeTitulosInput({ ...validInput(), lugar: "   " }), /lugar/i);
});

test("rechaza universidad/carrera/lugar demasiado largos (>200 caracteres)", () => {
  const largo = "a".repeat(201);
  assert.throws(() => normalizeTitulosInput({ ...validInput(), universidad: largo }));
});

test("rechaza numero_variables distinto de 1 o 2", () => {
  assert.throws(() => normalizeTitulosInput({ ...validInput(), numero_variables: "3" }), /numero de variables/i);
  assert.throws(() => normalizeTitulosInput({ ...validInput(), numero_variables: "" }), /numero de variables/i);
});

test("rechaza anio con formato o rango invalido", () => {
  assert.throws(() => normalizeTitulosInput({ ...validInput(), anio: "26" }), /año/i);
  assert.throws(() => normalizeTitulosInput({ ...validInput(), anio: "1999" }), /año/i);
  assert.throws(() => normalizeTitulosInput({ ...validInput(), anio: "2101" }), /año/i);
  assert.throws(() => normalizeTitulosInput({ ...validInput(), anio: "abcd" }), /año/i);
});

// ── cleanTitulosContent (defensa contra narracion de la IA) ────────────────

const NARRACION_REAL = "Voy a realizar las búsquedas en repositorios académicos antes de proponer "
  + "los títulos. Realizaré varias búsquedas simultáneas.Voy a realizar búsquedas adicionales para "
  + "encontrar más tesis relacionadas...Con base en los resultados de las búsquedas realizadas... he "
  + "identificado las variables más frecuentes...\n\n1. **Sistema de control interno**...\n\nA "
  + "continuación, presento las tres propuestas de título...\n\n---\n\n**TÍTULO 1**\n"
  + "\"Sistema de control interno en...\"\n\n**1. PROBLEMA Y PROPÓSITO A ABORDAR**\n...";

test("cleanTitulosContent descarta la narracion previa y empieza en **TÍTULO 1**", () => {
  const out = cleanTitulosContent(NARRACION_REAL);
  assert.ok(out.startsWith("**TÍTULO 1**"));
  assert.ok(!out.includes("Voy a realizar"));
});

test("cleanTitulosContent sin marcador devuelve el contenido intacto", () => {
  const sinMarcador = "Aquí no hay ningún título desarrollado, solo texto suelto.";
  assert.equal(cleanTitulosContent(sinMarcador), sinMarcador);
});

test("cleanTitulosContent tolera TÍTULO 1 sin espacio y sin tilde", () => {
  assert.ok(cleanTitulosContent("ruido previo **TITULO1** resto").startsWith("**TITULO1**"));
});

// ── stripToolCallMarkup (tool_calls filtrados como texto, visto en produccion) ─

// Caso real de produccion: la respuesta completa fueron solo llamadas de
// busqueda escritas como texto plano, sin ningun titulo.
const TOOL_CALL_LEAK_REAL = "<tool_call>openrouter_web_search"
  + "<arg_key>query</arg_key>"
  + '<arg_value>tesis "comunicación organizacional" "satisfacción laboral" Ecuador Colombia Bolivia 2022 2023 repositorio universitario</arg_value>'
  + "</tool_call><tool_call>openrouter_web_search"
  + "<arg_key>query</arg_key>"
  + '<arg_value>tesis "redes sociales" "imagen institucional" universidad Ecuador Colombia Bolivia 2022 2023 repositorio</arg_value>'
  + "</tool_call><tool_call>openrouter_web_search"
  + "<arg_key>query</arg_key>"
  + '<arg_value>tesis "periodismo digital" "pensamiento crítico" estudiantes Ecuador Colombia 2022 2023 repositorio universitario</arg_value>'
  + "</tool_call>";

test("stripToolCallMarkup elimina por completo el caso real de tool_calls filtrados", () => {
  assert.equal(stripToolCallMarkup(TOOL_CALL_LEAK_REAL), "");
});

test("stripToolCallMarkup elimina un bloque sin cerrar al final y etiquetas sueltas", () => {
  assert.equal(stripToolCallMarkup("texto util <tool_call>openrouter_web_search<arg_key>query</arg_key> cortado"), "texto util");
  assert.equal(stripToolCallMarkup("hola <arg_value>x</arg_value> mundo"), "hola x mundo");
});

test("cleanTitulosContent quita tool_calls intercalados y conserva los titulos", () => {
  const out = cleanTitulosContent(`**TÍTULO 1**\ncontenido${TOOL_CALL_LEAK_REAL}\nmas contenido`);
  assert.ok(out.startsWith("**TÍTULO 1**"));
  assert.ok(!out.includes("<tool_call>"));
  assert.ok(out.includes("mas contenido"));
});

// ── websearch: pre-busqueda Brave/Firecrawl (fetch inyectado, nunca red real) ─

const braveOk = (results) => ({
  status: 200,
  json: async () => ({ web: { results } }),
});

test("searchWithFallback usa Brave y cachea el resultado", async () => {
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    assert.ok(String(url).includes("api.search.brave.com"));
    return braveOk([{ title: "Tesis X", url: "https://repo.pe/x", description: "desc" }]);
  };
  const opts = { braveApiKey: "brave-key", firecrawlApiKey: null, fetchImpl };
  const r1 = await searchWithFallback("consulta unica brave cache", opts);
  const r2 = await searchWithFallback("consulta unica brave cache", opts);
  assert.equal(fetches, 1); // la segunda sale del cache
  assert.deepEqual(r1, r2);
  assert.equal(r1[0].url, "https://repo.pe/x");
});

test("searchWithFallback cae a Firecrawl si Brave falla, y devuelve [] si ambos fallan", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("brave")) return { status: 429, json: async () => ({}) };
    return {
      status: 200,
      json: async () => ({ data: [{ title: "T", url: "https://fc.pe/t", description: "" }] }),
    };
  };
  const conFallback = await searchWithFallback("consulta fallback firecrawl", {
    braveApiKey: "b", firecrawlApiKey: "f", fetchImpl,
  });
  assert.equal(conFallback[0].url, "https://fc.pe/t");

  const todoFalla = await searchWithFallback("consulta todo falla", {
    braveApiKey: "b",
    firecrawlApiKey: "f",
    fetchImpl: async () => ({ status: 500, json: async () => ({}) }),
  });
  assert.deepEqual(todoFalla, []);
});

test("buildQueries usa site: del repositorio si hay dominio, y cubre alicia/renati/internacional", () => {
  const datos = { universidad: "UDH", carrera: "Enfermería", lugar: "Huánuco" };
  const conDominio = buildQueries(datos, "repositorio.udh.edu.pe");
  assert.ok(conDominio[0].includes("site:repositorio.udh.edu.pe"));
  assert.ok(conDominio.some((q) => q.includes("alicia.concytec.gob.pe")));
  assert.ok(conDominio.some((q) => q.includes("renati.sunedu.gob.pe")));
  assert.ok(conDominio.some((q) => q.includes("Ecuador")));
  const sinDominio = buildQueries(datos, null);
  assert.ok(sinDominio[0].includes("UDH"));
});

test("gatherSearchContext sin claves devuelve null; con resultados arma el bloque", async () => {
  assert.equal(await gatherSearchContext(
    { universidad: "U", carrera: "C", lugar: "L" },
    null,
    { braveApiKey: null, firecrawlApiKey: null },
  ), null);

  const bloque = await gatherSearchContext(
    { universidad: "U Test", carrera: "Carrera Test", lugar: "Lugar Test" },
    "repositorio.test.edu.pe",
    {
      braveApiKey: "brave-key",
      firecrawlApiKey: null,
      delayMs: 0,
      fetchImpl: async () => braveOk([{ title: "Tesis A", url: "https://repo.pe/a", description: "d" }]),
    },
  );
  assert.ok(bloque.includes("### Búsqueda:"));
  assert.ok(bloque.includes("https://repo.pe/a"));
});

test("generateTitulos con pre-busqueda corre en dos etapas: seleccion + desarrollo sin herramienta", async () => {
  const originalFetch = global.fetch;
  const openRouterCalls = [];
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(opts.body);
      openRouterCalls.push(body);
      const content = esLlamadaSeleccion(body) ? seleccionJson("obst") : "**TÍTULO 1**\nok";
      return { ok: true, json: async () => ({ choices: [{ message: { content } }], usage: null }) };
    }
    // Verificacion HTTP de URLs citadas (el contenido "ok" no trae URLs).
    return { status: 200, text: async () => "<title>Tesis</title>" };
  };
  try {
    await generateTitulos({ ...validInput(), carrera: "Obstetricia" }, {
      apiKey: "test-key",
      websearch: {
        braveApiKey: "brave-key",
        firecrawlApiKey: null,
        delayMs: 0,
        fetchImpl: async () => braveOk([{ title: "Tesis B", url: "https://repo.pe/b", description: "d" }]),
      },
    });
    assert.equal(openRouterCalls.length, 2);
    // Etapa 1 (seleccion): sin herramienta, razonamiento medium, con los
    // resultados de la pre-busqueda.
    const seleccionBody = openRouterCalls[0];
    assert.equal(seleccionBody.tools, undefined);
    assert.equal(seleccionBody.reasoning.effort, "medium");
    assert.ok(seleccionBody.messages[1].content.includes("https://repo.pe/b"));
    // Etapa 2 (desarrollo): sin herramienta, razonamiento APAGADO (para GLM
    // el thinking es binario; un effort bajo no lo acota), con las variables
    // ya elegidas y las busquedas dirigidas.
    const devBody = openRouterCalls[1];
    assert.equal(devBody.tools, undefined);
    assert.deepEqual(devBody.reasoning, { enabled: false });
    const userMsg = devBody.messages[1].content;
    assert.ok(userMsg.includes("RESULTADOS DE BÚSQUEDA DEL SISTEMA"));
    assert.ok(userMsg.includes("VARIABLES YA ELEGIDAS"));
    assert.ok(userMsg.includes("Clima organizacional obst"));
    assert.ok(userMsg.includes("Búsqueda dirigida"));
    assert.ok(userMsg.includes("NO tienes herramienta de búsqueda"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("si la seleccion de variables falla dos veces, se cae al flujo clasico con herramienta", async () => {
  const originalFetch = global.fetch;
  const openRouterCalls = [];
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(opts.body);
      openRouterCalls.push(body);
      // La seleccion responde texto sin JSON (invalida); el desarrollo ok.
      const content = esLlamadaSeleccion(body) ? "no puedo responder eso" : "**TÍTULO 1**\nok";
      return { ok: true, json: async () => ({ choices: [{ message: { content } }], usage: null }) };
    }
    return { status: 200, text: async () => "<title>Tesis</title>" };
  };
  try {
    await generateTitulos({ ...validInput(), carrera: "Biología" }, {
      apiKey: "test-key",
      websearch: {
        braveApiKey: "brave-key",
        firecrawlApiKey: null,
        delayMs: 0,
        fetchImpl: async () => braveOk([{ title: "Tesis B", url: "https://repo.pe/bio", description: "d" }]),
      },
    });
    // 2 intentos de seleccion fallidos + 1 llamada clasica de desarrollo.
    assert.equal(openRouterCalls.length, 3);
    const devBody = openRouterCalls[2];
    // Flujo clasico: CON herramienta, razonamiento medium, sin seleccion.
    assert.ok(Array.isArray(devBody.tools) && devBody.tools.length === 1);
    assert.equal(devBody.reasoning.effort, "medium");
    assert.ok(!devBody.messages[1].content.includes("VARIABLES YA ELEGIDAS"));
    assert.ok(devBody.messages[1].content.includes("MÁXIMO 4"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("si la etapa de desarrollo falla dos veces, el job cae al flujo clasico con herramienta", async () => {
  const originalFetch = global.fetch;
  const openRouterCalls = [];
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(opts.body);
      openRouterCalls.push(body);
      let content;
      if (esLlamadaSeleccion(body)) {
        content = seleccionJson("quim");
      } else if (body.tools === undefined) {
        // Desarrollo sin herramienta: vacio en ambos intentos (simula el
        // finish_reason=length por razonamiento desbocado).
        content = "";
      } else {
        // Flujo clasico con herramienta: responde bien.
        content = "**TÍTULO 1**\nok clasico";
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: "length" } ] , usage: null }) };
    }
    return { status: 200, text: async () => "<title>Tesis</title>" };
  };
  try {
    const result = await generateTitulos({ ...validInput(), carrera: "Química" }, {
      apiKey: "test-key",
      websearch: {
        braveApiKey: "brave-key",
        firecrawlApiKey: null,
        delayMs: 0,
        fetchImpl: async () => braveOk([{ title: "Tesis Q", url: "https://repo.pe/quim", description: "d" }]),
      },
    });
    // 1 seleccion + 2 intentos de desarrollo fallidos + 1 llamada clasica.
    assert.equal(openRouterCalls.length, 4);
    assert.ok(Array.isArray(openRouterCalls[3].tools) && openRouterCalls[3].tools.length === 1);
    assert.equal(result.contenido, "**TÍTULO 1**\nok clasico");
  } finally {
    global.fetch = originalFetch;
  }
});

// ── parseSeleccion / buildTargetedQueries (unidad) ──────────────────────────

test("parseSeleccion tolera fences y texto alrededor, y normaliza variable2 null con 1 variable", () => {
  const raw = "Aquí está:\n```json\n" + JSON.stringify({
    titulos: [
      { variable1: "Ansiedad", variable2: null, poblacion: "estudiantes", entidad: "universidad" },
      { variable1: "Autoestima", poblacion: "estudiantes", entidad: "colegio" },
      { variable1: "Estrés académico", variable2: "lo que sea", poblacion: "alumnos", entidad: "instituto" },
    ],
  }) + "\n```";
  const seleccion = parseSeleccion(raw, "1");
  assert.equal(seleccion.length, 3);
  assert.equal(seleccion[0].variable1, "Ansiedad");
  // Con numero_variables=1 variable2 siempre queda null, venga lo que venga.
  assert.equal(seleccion[2].variable2, null);
});

test("parseSeleccion rechaza: sin JSON, menos de 3 titulos, variable2 faltante y variables repetidas", () => {
  assert.throws(() => parseSeleccion("sin json aqui", "2"), /JSON/);
  assert.throws(() => parseSeleccion(JSON.stringify({ titulos: [{ variable1: "A", variable2: "B", poblacion: "p", entidad: "e" }] }), "2"), /3 titulos/);
  const sinV2 = { titulos: [
    { variable1: "A", variable2: "B", poblacion: "p", entidad: "e" },
    { variable1: "C", poblacion: "p", entidad: "e" },
    { variable1: "D", variable2: "E", poblacion: "p", entidad: "e" },
  ] };
  assert.throws(() => parseSeleccion(JSON.stringify(sinV2), "2"), /variable2/);
  const repetida = { titulos: [
    { variable1: "A", variable2: "B", poblacion: "p", entidad: "e" },
    { variable1: "a", variable2: "C", poblacion: "p", entidad: "e" },
    { variable1: "D", variable2: "E", poblacion: "p", entidad: "e" },
  ] };
  assert.throws(() => parseSeleccion(JSON.stringify(repetida), "2"), /se repite/);
});

test("buildTargetedQueries arma consultas nacionales, internacionales y del repositorio", () => {
  const seleccion = [
    { variable1: "V1", variable2: "V2", poblacion: "p", entidad: "e" },
    { variable1: "V3", variable2: null, poblacion: "p", entidad: "e" },
  ];
  const conDominio = buildTargetedQueries(seleccion, "repositorio.udh.edu.pe");
  assert.equal(conDominio.length, 6);
  assert.ok(conDominio[0].includes('"V1" "V2"') && conDominio[0].includes("Perú"));
  assert.ok(conDominio[1].includes("Ecuador"));
  assert.ok(conDominio[2].includes("site:repositorio.udh.edu.pe"));
  // Univariable: solo variable1 entre comillas.
  assert.ok(conDominio[3].includes('"V3"') && !conDominio[3].includes('"null"'));
  const sinDominio = buildTargetedQueries(seleccion, null);
  assert.equal(sinDominio.length, 4);
});

test("buildSeleccionSystemPrompt es estatico y pide ELEGIR con salida JSON", () => {
  const prompt = buildSeleccionSystemPrompt();
  assert.ok(prompt.includes("ELEGIR"));
  assert.ok(prompt.includes('"titulos"'));
  assert.ok(!prompt.includes("{{universidad}}"));
  assert.equal(prompt, buildSeleccionSystemPrompt());
});

// ── buildTitulosDocx (zip .docx valido con el contenido esperado) ──────────

const CONTENIDO_EJEMPLO = `**TÍTULO 1**
"Sistema de control interno en la gestión administrativa del Hospital X, Huánuco, 2026"

**1. PROBLEMA Y PROPÓSITO A ABORDAR**
Existe un vacío de conocimiento respecto al sistema de control interno.

**2. OBJETIVOS**
Objetivo General:
Determinar el nivel de sistema de control interno en la gestión administrativa.

Objetivos Específicos:
- Describir el nivel de la dimensión 1.
- Describir el nivel de la dimensión 2.

**3. PLANTEAMIENTO DEL PROBLEMA**
Problema General:
¿Cuál es el nivel de sistema de control interno?

**4. ESTRATEGIA METODOLÓGICA**
| Tipo | Básica |
| Enfoque | Cuantitativo |
| Nivel | Descriptivo |

**5. REFERENCIAS Y ANTECEDENTES**
Antecedentes nacionales:
1. Pérez, J. (2023). *Control interno y gestión*. Universidad de Huánuco. http://repositorio.udh.edu.pe/123

---

**TÍTULO 2**
"Otro título de ejemplo, Huánuco, 2026"

**1. PROBLEMA Y PROPÓSITO A ABORDAR**
Otro parrafo de contexto.
`;

const inputEjemplo = {
  universidad: "Universidad de Huánuco",
  carrera: "Enfermería",
  lugar: "Huánuco",
  numeroVariables: "1",
  anio: "2026",
};

test("buildTitulosDocx devuelve un Buffer que es un zip .docx valido con el contenido esperado", async () => {
  const buffer = await buildTitulosDocx({ contenido: CONTENIDO_EJEMPLO, input: inputEjemplo });
  assert.ok(Buffer.isBuffer(buffer));

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("word/document.xml"), "el .docx debe traer word/document.xml");
  const xml = await zip.file("word/document.xml").async("string");

  assert.ok(xml.includes("TÍTULO 1"));
  assert.ok(xml.includes("TÍTULO 2"));
  assert.ok(xml.includes("Objetivo General"));
  assert.ok(xml.includes("Propuestas de T"));
});

test("buildTitulosDocx nunca lanza con contenido vacio, sin marcador o con solo texto plano", async () => {
  await assert.doesNotReject(() => buildTitulosDocx({ contenido: "", input: inputEjemplo }));
  await assert.doesNotReject(() => buildTitulosDocx({ contenido: "texto suelto sin estructura", input: inputEjemplo }));
  await assert.doesNotReject(() => buildTitulosDocx({ contenido: undefined, input: {} }));
});

// ── generateTitulos (mockea fetch, nunca llama a OpenRouter real) ──────────

test("generateTitulos llama a OpenRouter una vez y devuelve el contenido", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "**TÍTULO 1**\n..." }, finish_reason: "stop" }],
        usage: { server_tool_use_details: { web_search_requests: 3 } },
      }),
    };
  };
  try {
    const result = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[0].body.model, "z-ai/glm-5.2");
    assert.ok(Array.isArray(calls[0].body.tools));
    assert.equal(calls[0].body.tools[0].type, "openrouter:web_search");
    // allowed_domains NUNCA se envia: aplica a todas las busquedas del
    // request y bloquearia los antecedentes internacionales. El dominio del
    // repositorio va como pista dentro del mensaje user.
    assert.equal("allowed_domains" in calls[0].body.tools[0].parameters, false);
    assert.ok(calls[0].body.messages[1].content.includes("repositorio.udh.edu.pe"));
    assert.ok(!("response_format" in calls[0].body));
    // El mensaje de usuario debe blindar contra narracion de la IA.
    assert.ok(calls[0].body.messages[1].content.includes("ÚNICAMENTE"));
    // System estatico (cacheable): los datos del cliente van SOLO en el user.
    assert.ok(!calls[0].body.messages[0].content.includes("Enfermería"));
    assert.ok(calls[0].body.messages[1].content.includes("DATOS DEL ESTUDIANTE"));
    assert.ok(calls[0].body.messages[1].content.includes("Enfermería"));
    assert.equal(result.contenido, "**TÍTULO 1**\n...");
    assert.equal(result.webSearchRequests, 3);
    assert.ok(Buffer.isBuffer(result.docxBuffer));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos lee web_search_requests desde server_tool_use_details con fallback a server_tool_use", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "**TÍTULO 1**\n..." }, finish_reason: "stop" }],
        usage: { server_tool_use_details: { web_search_requests: 5 } },
      }),
    });
    const conDetails = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(conDetails.webSearchRequests, 5);

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "**TÍTULO 1**\n..." }, finish_reason: "stop" }],
        usage: { server_tool_use: { web_search_requests: 7 } },
      }),
    });
    const conFallback = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(conFallback.webSearchRequests, 7);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos sin match de universidad no incluye pista de repositorio", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "**TÍTULO 1**\nok" } }], usage: null }) };
  };
  try {
    await generateTitulos({ ...validInput(), universidad: "Universidad de Springfield" }, { apiKey: "test-key" });
    assert.equal("allowed_domains" in calls[0].body.tools[0].parameters, false);
    assert.ok(!calls[0].body.messages[1].content.includes("DATO VERIFICADO"));
    // El plan de busqueda con la guia internacional va siempre.
    assert.ok(calls[0].body.messages[1].content.includes("PLAN DE BÚSQUEDA"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos reintenta UNA vez si el primer intento viene vacio, y lanza si el segundo tambien", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: null }) };
  };
  try {
    await assert.rejects(() => generateTitulos(validInput(), { apiKey: "test-key" }));
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos reintenta si la respuesta es solo tool_calls filtrados y usa la respuesta valida del segundo intento", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const content = calls.length === 1 ? TOOL_CALL_LEAK_REAL : "**TÍTULO 1**\ncontenido valido";
    return { ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: null }) };
  };
  try {
    const result = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(calls.length, 2);
    // El segundo intento lleva el aviso correctivo como ultimo mensaje user,
    // precedido por la respuesta invalida como assistant.
    const mensajes = calls[1].messages;
    assert.equal(mensajes[mensajes.length - 1].role, "user");
    assert.ok(mensajes[mensajes.length - 1].content.includes("tool_call"));
    assert.equal(mensajes[mensajes.length - 2].role, "assistant");
    assert.equal(result.contenido, "**TÍTULO 1**\ncontenido valido");
  } finally {
    global.fetch = originalFetch;
  }
});

test("glitch tool_calls CON pre-busqueda: la etapa de desarrollo (sin tools) reintenta y ordena redactar", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let devCalls = 0;
  global.fetch = async (url, opts) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(opts.body);
      calls.push(body);
      let content;
      if (esLlamadaSeleccion(body)) {
        content = seleccionJson("nutr");
      } else {
        devCalls += 1;
        // El desarrollo alucina markup <tool_call> en el primer intento
        // (aunque no tiene herramienta) y responde bien en el segundo.
        content = devCalls === 1 ? TOOL_CALL_LEAK_REAL : "**TÍTULO 1**\ncontenido valido";
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: null }) };
    }
    return { status: 200, text: async () => "<title>Tesis</title>" };
  };
  try {
    const result = await generateTitulos({ ...validInput(), carrera: "Nutrición" }, {
      apiKey: "test-key",
      websearch: {
        braveApiKey: "brave-key",
        firecrawlApiKey: null,
        delayMs: 0,
        fetchImpl: async () => braveOk([{ title: "Tesis N", url: "https://repo.pe/n", description: "d" }]),
      },
    });
    // 1 seleccion + 2 intentos de desarrollo (ambos sin herramienta).
    assert.equal(calls.length, 3);
    assert.equal(calls[1].tools, undefined);
    assert.equal(calls[2].tools, undefined);
    const mensajeCorrectivo = calls[2].messages[calls[2].messages.length - 1];
    assert.equal(mensajeCorrectivo.role, "user");
    assert.ok(mensajeCorrectivo.content.includes("NO busques más"));
    assert.equal(result.contenido, "**TÍTULO 1**\ncontenido valido");
  } finally {
    global.fetch = originalFetch;
  }
});

test("glitch tool_calls SIN pre-busqueda: el reintento conserva la herramienta de busqueda", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const content = calls.length === 1 ? TOOL_CALL_LEAK_REAL : "**TÍTULO 1**\ncontenido valido";
    return { ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: null }) };
  };
  try {
    // Sin claves de pre-busqueda no hay searchContext: quitar la herramienta
    // invitaria a inventar fuentes, asi que se conserva.
    await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(calls.length, 2);
    assert.ok(Array.isArray(calls[1].tools) && calls[1].tools.length === 1);
    const mensajeCorrectivo = calls[1].messages[calls[1].messages.length - 1];
    assert.ok(mensajeCorrectivo.content.includes("EJECUTA las búsquedas"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos con anio vacio manda el anio actual en los DATOS DEL ESTUDIANTE", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: "**TÍTULO 1**\nok" } }], usage: null }) };
  };
  try {
    const { anio, ...sinAnio } = validInput();
    void anio;
    await generateTitulos(sinAnio, { apiKey: "test-key" });
    assert.ok(calls[0].messages[1].content.includes(`Año: ${new Date().getFullYear()}`));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos reintenta si la respuesta trae placeholders {{...}} sin reemplazar", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const content = calls.length === 1
      ? "**TÍTULO 1**\nAlgo en [lugar], {{anio}}" // placeholder fugado
      : "**TÍTULO 1**\nAlgo en Huánuco, 2026";
    return { ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: null }) };
  };
  try {
    const result = await generateTitulos(validInput(), { apiKey: "test-key" });
    assert.equal(calls.length, 2);
    assert.equal(result.contenido, "**TÍTULO 1**\nAlgo en Huánuco, 2026");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos lanza si ambos intentos son solo tool_calls filtrados (nunca entrega basura)", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: TOOL_CALL_LEAK_REAL }, finish_reason: "stop" }], usage: null }) };
  };
  try {
    await assert.rejects(() => generateTitulos(validInput(), { apiKey: "test-key" }), /no devolvio los titulos/);
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTitulos propaga el error de OpenRouter (HTTP no ok)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid key" } }) });
  try {
    await assert.rejects(() => generateTitulos(validInput(), { apiKey: "bad-key" }), /invalid key/);
  } finally {
    global.fetch = originalFetch;
  }
});
