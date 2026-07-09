import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { loadTitulosPrompts, interpolate, buildSystemPrompt } from "../lib/titulos/prompt.js";
import { resolveRepositoryDomain, buildAllowedDomains } from "../lib/titulos/universities.js";
import { normalizeTitulosInput, generateTitulos, cleanTitulosContent } from "../lib/titulos/index.js";
import { buildTitulosDocx } from "../lib/titulos/docx.js";

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

// ── interpolate ──────────────────────────────────────────────────────────────

test("interpolate reemplaza todos los placeholders, incluso repetidos", () => {
  const out = interpolate("{{a}} y {{b}}, otra vez {{a}}.", { a: "X", b: "Y" });
  assert.equal(out, "X y Y, otra vez X.");
});

// ── buildSystemPrompt: seleccion de plantilla + interpolacion ───────────────

test("numero_variables=2 adjunta la Plantilla A (con HIPOTESIS) y NO la B", () => {
  const prompt = buildSystemPrompt({
    universidad: "Universidad de Huánuco",
    carrera: "Enfermería",
    lugar: "Huánuco",
    numeroVariables: "2",
    anio: "2026",
  });
  assert.ok(prompt.includes("PLANTILLA A — estructura obligatoria"));
  assert.ok(prompt.includes("HIPÓTESIS"));
  assert.ok(prompt.includes("Huánuco"));
  assert.ok(prompt.includes("Enfermería"));
  assert.ok(prompt.includes("2026"));
});

test("numero_variables=1 adjunta la Plantilla B (sin HIPOTESIS) y NO la A", () => {
  const prompt = buildSystemPrompt({
    universidad: "Universidad César Vallejo",
    carrera: "Psicología",
    lugar: "Trujillo",
    numeroVariables: "1",
    anio: "2026",
  });
  assert.ok(prompt.includes("PLANTILLA B — estructura obligatoria"));
  assert.ok(!prompt.includes("HIPÓTESIS"));
  assert.ok(prompt.includes("Trujillo"));
});

test("anio vacio usa el anio actual del sistema antes de interpolar", () => {
  const prompt = buildSystemPrompt({
    universidad: "Universidad de Huánuco",
    carrera: "Enfermería",
    lugar: "Huánuco",
    numeroVariables: "2",
    anio: "",
  });
  const anioActual = String(new Date().getFullYear());
  assert.ok(prompt.includes(anioActual));
  assert.ok(!prompt.includes("{{anio}}"));
});

// ── Mapeo universidad -> dominio ────────────────────────────────────────────

test("resuelve dominio por nombre completo y por sigla, tolerando tildes/mayusculas", () => {
  assert.equal(resolveRepositoryDomain("Universidad de Huánuco"), "repositorio.udh.edu.pe");
  assert.equal(resolveRepositoryDomain("UDH"), "repositorio.udh.edu.pe");
  assert.equal(resolveRepositoryDomain("universidad cesar vallejo"), "repositorio.ucv.edu.pe");
  assert.equal(resolveRepositoryDomain("UCV"), "repositorio.ucv.edu.pe");
  assert.equal(resolveRepositoryDomain("Universidad Nacional Mayor de San Marcos"), "cybertesis.unmsm.edu.pe");
});

test("sin match conocido, resolveRepositoryDomain devuelve null", () => {
  assert.equal(resolveRepositoryDomain("Universidad Nacional de Trujillo"), null);
  assert.equal(resolveRepositoryDomain(""), null);
});

test("buildAllowedDomains: con match agrega alicia+renati+dominio; sin match, null", () => {
  assert.deepEqual(
    buildAllowedDomains("Universidad de Huánuco"),
    ["alicia.concytec.gob.pe", "renati.sunedu.gob.pe", "repositorio.udh.edu.pe"],
  );
  assert.equal(buildAllowedDomains("Universidad Nacional de Trujillo"), null);
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

test("anio ausente/vacio se acepta y queda vacio (el default lo aplica buildSystemPrompt)", () => {
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
    assert.deepEqual(
      calls[0].body.tools[0].parameters.allowed_domains,
      ["alicia.concytec.gob.pe", "renati.sunedu.gob.pe", "repositorio.udh.edu.pe"],
    );
    assert.ok(!("response_format" in calls[0].body));
    // El mensaje de usuario debe blindar contra narracion de la IA.
    assert.ok(calls[0].body.messages[1].content.includes("ÚNICAMENTE"));
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

test("generateTitulos sin match de universidad omite allowed_domains", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: null }) };
  };
  try {
    await generateTitulos({ ...validInput(), universidad: "Universidad Nacional de Trujillo" }, { apiKey: "test-key" });
    assert.equal("allowed_domains" in calls[0].body.tools[0].parameters, false);
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

test("generateTitulos propaga el error de OpenRouter (HTTP no ok)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid key" } }) });
  try {
    await assert.rejects(() => generateTitulos(validInput(), { apiKey: "bad-key" }), /invalid key/);
  } finally {
    global.fetch = originalFetch;
  }
});
