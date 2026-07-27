// Matriz de Consistencia: hueco de cobertura encontrado en la auditoria de
// pruebas (2026-07-26). El modulo entero (lib/matriz/index.js, openrouter.js
// y docx.js) no tenia NINGUNA prueba, directa ni indirecta (ni siquiera un
// test de servidor que golpee POST /matriz): a diferencia de su hermano
// lib/titulos, que si esta cubierto a fondo (titulos.test.js,
// titulos-verify.test.js).
//
// Aqui se cubre lo mas critico y mas facil de probar sin mockear OpenRouter:
// - normalizeMatrizInput / buildDimensionQueries: puras, deterministas.
// - parseAnalisis / parseMatriz: el JSON que la IA devuelve se valida aqui;
//   si la validacion fuera laxa, una matriz con hipotesis en una tesis
//   descriptiva, con el numero de variables equivocado o con una URL de
//   fuente inventada llegaria igual al Word que recibe el tesista.
// - buildMatrizDocx: que el .docx sea un zip valido, que las secciones
//   correctas aparezcan segun si hay hipotesis (correlacional/explicativa)
//   o no (descriptiva), que NUNCA lance con una matriz malformada (la
//   "robustez total" documentada en el propio archivo), y sobre todo que la
//   orientacion A4 APAISADO se mantenga: docx.js pasa las medidas de
//   RETRATO (210x297mm) confiando en que la libreria "docx" las intercambia
//   sola en landscape (comentario explicito en el archivo, "leccion
//   aprendida"); si esa libreria cambiara de comportamiento en una
//   actualizacion, el documento saldria con las proporciones cambiadas sin
//   que nada lo avisara. Este test lee el XML real y comprueba que el ancho
//   final sea mayor que el alto.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { normalizeMatrizInput, buildDimensionQueries } from "../lib/matriz/index.js";
import { parseAnalisis, parseMatriz } from "../lib/matriz/openrouter.js";
import { buildMatrizDocx } from "../lib/matriz/docx.js";

// ── normalizeMatrizInput ─────────────────────────────────────────────────────

describe("normalizeMatrizInput", () => {
  test("el título es obligatorio", () => {
    assert.throws(() => normalizeMatrizInput({}), /título.*obligatorio/i);
    assert.throws(() => normalizeMatrizInput({ titulo: "   " }), /título.*obligatorio/i);
  });

  test("el título no puede superar 300 caracteres", () => {
    assert.throws(
      () => normalizeMatrizInput({ titulo: "x".repeat(301) }),
      /título.*300/i,
    );
    assert.doesNotThrow(() => normalizeMatrizInput({ titulo: "x".repeat(300) }));
  });

  test("los campos opcionales no pueden superar 200 caracteres", () => {
    const base = { titulo: "Un título válido" };
    for (const campo of ["universidad", "carrera", "poblacion", "lugar"]) {
      assert.throws(
        () => normalizeMatrizInput({ ...base, [campo]: "x".repeat(201) }),
        /200/,
        `el campo "${campo}" debería rechazarse pasado el máximo`,
      );
    }
  });

  test("el año debe tener 4 dígitos y estar entre 2000 y 2100", () => {
    const base = { titulo: "Un título válido" };
    for (const malo of ["abc", "99", "1999", "2101", "202a", "20266"]) {
      assert.throws(
        () => normalizeMatrizInput({ ...base, anio: malo }),
        /año/i,
        `"${malo}" debería rechazarse`,
      );
    }
    assert.equal(normalizeMatrizInput({ ...base, anio: "2026" }).anio, "2026");
    assert.equal(normalizeMatrizInput({ ...base, anio: "2000" }).anio, "2000");
    assert.equal(normalizeMatrizInput({ ...base, anio: "2100" }).anio, "2100");
  });

  test("el año es opcional: vacío no lanza", () => {
    const r = normalizeMatrizInput({ titulo: "Un título válido" });
    assert.equal(r.anio, "");
  });

  test("recorta espacios y acepta el payload mínimo", () => {
    const r = normalizeMatrizInput({ titulo: "  Un título con espacios  " });
    assert.equal(r.titulo, "Un título con espacios");
    assert.equal(r.universidad, "");
    assert.equal(r.carrera, "");
    assert.equal(r.poblacion, "");
    assert.equal(r.lugar, "");
  });
});

// ── buildDimensionQueries ────────────────────────────────────────────────────

describe("buildDimensionQueries", () => {
  test("2 consultas por variable cuando el área no es de servicio público", () => {
    const analisis = { area: "salud", variables: [{ nombre: "Clima laboral" }, { nombre: "Desempeño" }] };
    const queries = buildDimensionQueries(analisis);
    assert.equal(queries.length, 4);
    assert.ok(queries.every((q) => !/ministerio/i.test(q)));
  });

  test("3 consultas por variable (incluida la variante de gobierno) cuando el área es servicio público", () => {
    for (const area of ["Gestión pública", "Administración del Estado", "Gobierno local"]) {
      const analisis = { area, variables: [{ nombre: "Gestión administrativa" }] };
      const queries = buildDimensionQueries(analisis);
      assert.equal(queries.length, 3, `área "${area}" debería sumar la consulta de gobierno`);
      assert.ok(queries.some((q) => /ministerio/i.test(q)));
    }
  });

  test("cada consulta menciona el nombre exacto de la variable", () => {
    const analisis = { area: "", variables: [{ nombre: "Satisfacción laboral" }] };
    const queries = buildDimensionQueries(analisis);
    assert.ok(queries.every((q) => q.includes("Satisfacción laboral")));
  });
});

// ── parseAnalisis (Etapa 1: clasificación del título) ───────────────────────

const analisisValido = (overrides = {}) => ({
  variables: [{ nombre: "Gestión administrativa", rol: "independiente" }, { nombre: "Calidad de servicio", rol: "dependiente" }],
  tipo: "Básica",
  enfoque: "Cuantitativo",
  nivel: "Correlacional",
  diseno: "No experimental",
  tecnica: "Encuesta",
  instrumento: "Cuestionario",
  ...overrides,
});

describe("parseAnalisis", () => {
  test("rechaza una respuesta sin JSON", () => {
    assert.throws(() => parseAnalisis("no hay json aquí"), /no contiene un objeto JSON/i);
    assert.throws(() => parseAnalisis(""), /no contiene un objeto JSON/i);
  });

  test("rechaza JSON mal formado", () => {
    assert.throws(() => parseAnalisis("{variables: sin comillas}"), /JSON.*no es valido/i);
  });

  test("rechaza 0 variables o más de 2", () => {
    assert.throws(() => parseAnalisis(JSON.stringify(analisisValido({ variables: [] }))), /1 o 2 variables/);
    assert.throws(
      () => parseAnalisis(JSON.stringify(analisisValido({
        variables: [{ nombre: "A" }, { nombre: "B" }, { nombre: "C" }],
      }))),
      /1 o 2 variables/,
    );
  });

  test("rechaza una variable sin nombre", () => {
    assert.throws(
      () => parseAnalisis(JSON.stringify(analisisValido({ variables: [{ nombre: "A" }, { nombre: "" }] }))),
      /1 o 2 variables/,
    );
  });

  test('con "descriptiva: true" exige exactamente 1 variable', () => {
    assert.throws(
      () => parseAnalisis(JSON.stringify(analisisValido({ descriptiva: true }))), // trae 2 variables
      /descriptiva.*1 variable/i,
    );
    assert.doesNotThrow(() => parseAnalisis(JSON.stringify(analisisValido({
      descriptiva: true, variables: [{ nombre: "Única variable" }],
    }))));
  });

  test("una sola variable se marca descriptiva aunque no se declare explícitamente", () => {
    const r = parseAnalisis(JSON.stringify(analisisValido({ variables: [{ nombre: "Única variable" }] })));
    assert.equal(r.descriptiva, true);
  });

  test("rechaza si falta cualquiera de los campos obligatorios", () => {
    for (const campo of ["tipo", "enfoque", "nivel", "diseno", "tecnica", "instrumento"]) {
      const malo = analisisValido({ [campo]: "" });
      assert.throws(
        () => parseAnalisis(JSON.stringify(malo)),
        new RegExp(`sin el campo "${campo}"`),
        `debería exigir el campo "${campo}"`,
      );
    }
  });

  test("un análisis válido se acepta y conserva sus campos", () => {
    const r = parseAnalisis(JSON.stringify(analisisValido({ area: "Salud pública" })));
    assert.equal(r.variables.length, 2);
    assert.equal(r.descriptiva, false);
    assert.equal(r.tipo, "Básica");
    assert.equal(r.area, "Salud pública");
    assert.equal(r.conector, "ninguno", "sin conector explícito, el default es \"ninguno\"");
  });

  test("tolera texto y bloques de código alrededor del JSON", () => {
    const envuelto = `Aquí está el análisis:\n\`\`\`json\n${JSON.stringify(analisisValido())}\n\`\`\`\nListo.`;
    assert.doesNotThrow(() => parseAnalisis(envuelto));
  });
});

// ── parseMatriz (Etapa 2: matriz completa) ──────────────────────────────────

const matrizCorrelacional = (overrides = {}) => ({
  titulo: "Gestión administrativa y calidad de servicio en la Municipalidad de Lima, 2026",
  problema: { general: "¿Cuál es la relación...?", especificos: ["¿Cuál es la relación con la dimensión 1?"] },
  objetivos: { general: "Determinar la relación...", especificos: ["Determinar la relación con la dimensión 1."] },
  hipotesis: { general: "Existe relación significativa.", nula: "No existe relación.", especificas: ["Existe relación con la dimensión 1."] },
  variables: [
    { nombre: "Gestión administrativa", rol: "independiente", autor: "Chiavenato (2019)", dimensiones: ["Planificación", "Organización", "Control"], fuente: "https://repositorio.example.edu/123" },
    { nombre: "Calidad de servicio", rol: "dependiente", autor: "Parasuraman (1988)", dimensiones: ["Fiabilidad", "Capacidad de respuesta", "Empatía"], fuente: "https://repositorio.example.edu/456" },
  ],
  metodologia: {
    tipo: "Básica", enfoque: "Cuantitativo", nivel: "Correlacional", diseno: "No experimental",
    poblacion: "200 trabajadores", muestra: "132", muestreo: "Probabilístico", tecnica: "Encuesta", instrumento: "Cuestionario",
  },
  ...overrides,
});

const matrizDescriptiva = (overrides = {}) => ({
  titulo: "Nivel de clima organizacional en la Municipalidad de Lima, 2026",
  problema: { general: "¿Cuál es el nivel de clima organizacional?", especificos: ["¿Cuál es el nivel según la dimensión 1?"] },
  objetivos: { general: "Determinar el nivel de clima organizacional.", especificos: ["Determinar el nivel según la dimensión 1."] },
  variables: [
    { nombre: "Clima organizacional", rol: "", autor: "Litwin y Stringer (1968)", dimensiones: ["Estructura", "Responsabilidad", "Recompensa"], fuente: "https://repositorio.example.edu/789" },
  ],
  metodologia: {
    tipo: "Básica", enfoque: "Cuantitativo", nivel: "Descriptivo", diseno: "No experimental",
    poblacion: "150 trabajadores", muestra: "108", muestreo: "Probabilístico", tecnica: "Encuesta", instrumento: "Cuestionario",
  },
  ...overrides,
});

describe("parseMatriz — validación general", () => {
  test("rechaza una respuesta sin JSON o con JSON inválido", () => {
    assert.throws(() => parseMatriz("texto plano", { descriptiva: false }), /no contiene un objeto JSON/i);
    assert.throws(() => parseMatriz("{esto: no es json}", { descriptiva: false }), /JSON.*no es valido/i);
  });

  test("exige título, problema y objetivos", () => {
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({ titulo: "" })), { descriptiva: false }),
      /sin título/i,
    );
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({ problema: { general: "", especificos: [] } })), { descriptiva: false }),
      /sin problema general/i,
    );
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({ objetivos: { general: "X", especificos: [] } })), { descriptiva: false }),
      /objetivos específicos/i,
    );
  });

  test("exige que cada variable tenga autor y una URL de fuente válida", () => {
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({
        variables: [
          { ...matrizCorrelacional().variables[0], autor: "" },
          matrizCorrelacional().variables[1],
        ],
      })), { descriptiva: false }),
      /sin autor/i,
    );
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({
        variables: [
          { ...matrizCorrelacional().variables[0], fuente: "ftp://no-es-http.com" },
          matrizCorrelacional().variables[1],
        ],
      })), { descriptiva: false }),
      /URL de fuente válida/i,
      "una URL que no empieza con http(s) debe rechazarse",
    );
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({
        variables: [
          { ...matrizCorrelacional().variables[0], fuente: "www.sin-esquema.com/pagina" },
          matrizCorrelacional().variables[1],
        ],
      })), { descriptiva: false }),
      /URL de fuente válida/i,
    );
  });

  test("exige todos los campos de metodología", () => {
    for (const campo of ["tipo", "enfoque", "nivel", "diseno", "poblacion", "muestra", "muestreo", "tecnica", "instrumento"]) {
      const malo = matrizCorrelacional({ metodologia: { ...matrizCorrelacional().metodologia, [campo]: "" } });
      assert.throws(
        () => parseMatriz(JSON.stringify(malo), { descriptiva: false }),
        new RegExp(`sin el campo "${campo}"`),
        `debería exigir el campo de metodología "${campo}"`,
      );
    }
  });
});

describe("parseMatriz — estudios NO descriptivos (correlacional/explicativa)", () => {
  test("exige hipótesis general (Hi) y nula (Ho)", () => {
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({ hipotesis: { general: "", nula: "Ho", especificas: [] } })), { descriptiva: false }),
      /sin hipótesis/i,
    );
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({ hipotesis: { general: "Hi", nula: "", especificas: [] } })), { descriptiva: false }),
      /sin hipótesis/i,
    );
  });

  test("exige exactamente 2 variables", () => {
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizCorrelacional({ variables: [matrizCorrelacional().variables[0]] })), { descriptiva: false }),
      /2 variable/,
    );
  });

  test("cada variable debe traer entre 3 y 5 dimensiones", () => {
    const conPocas = matrizCorrelacional();
    conPocas.variables[0].dimensiones = ["Solo una"];
    assert.throws(() => parseMatriz(JSON.stringify(conPocas), { descriptiva: false }), /entre 3 y 5 dimensiones/);

    const conMuchas = matrizCorrelacional();
    conMuchas.variables[0].dimensiones = ["D1", "D2", "D3", "D4", "D5", "D6"];
    assert.throws(() => parseMatriz(JSON.stringify(conMuchas), { descriptiva: false }), /entre 3 y 5 dimensiones/);

    assert.doesNotThrow(() => parseMatriz(JSON.stringify(matrizCorrelacional()), { descriptiva: false }));
  });

  test("una matriz válida se acepta completa", () => {
    const m = parseMatriz(JSON.stringify(matrizCorrelacional()), { descriptiva: false });
    assert.equal(m.variables.length, 2);
    assert.ok(m.hipotesis);
    assert.equal(m.hipotesis.general, "Existe relación significativa.");
    assert.equal(m.metodologia.nivel, "Correlacional");
  });
});

describe("parseMatriz — estudios descriptivos", () => {
  test("rechaza si trae hipótesis (una descriptiva NO lleva hipótesis)", () => {
    const conHipotesis = matrizDescriptiva({ hipotesis: { general: "Hi", nula: "Ho", especificas: [] } });
    assert.throws(
      () => parseMatriz(JSON.stringify(conHipotesis), { descriptiva: true }),
      /no lleva hipótesis/i,
    );
  });

  test("exige exactamente 1 variable", () => {
    assert.throws(
      () => parseMatriz(JSON.stringify(matrizDescriptiva({
        variables: [matrizDescriptiva().variables[0], matrizDescriptiva().variables[0]],
      })), { descriptiva: true }),
      /1 variable/,
    );
  });

  test("la única variable admite hasta 6 dimensiones (no 5)", () => {
    const conSeis = matrizDescriptiva();
    conSeis.variables[0].dimensiones = ["D1", "D2", "D3", "D4", "D5", "D6"];
    assert.doesNotThrow(() => parseMatriz(JSON.stringify(conSeis), { descriptiva: true }));

    const conSiete = matrizDescriptiva();
    conSiete.variables[0].dimensiones = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];
    assert.throws(() => parseMatriz(JSON.stringify(conSiete), { descriptiva: true }), /entre 3 y 6 dimensiones/);
  });

  test("una matriz descriptiva válida se acepta con hipotesis en null", () => {
    const m = parseMatriz(JSON.stringify(matrizDescriptiva()), { descriptiva: true });
    assert.equal(m.hipotesis, null);
    assert.equal(m.variables.length, 1);
  });
});

// ── buildMatrizDocx ──────────────────────────────────────────────────────────

describe("buildMatrizDocx", () => {
  test("produce un Buffer que es un .docx (zip) válido", async () => {
    const buffer = await buildMatrizDocx({ matriz: matrizCorrelacional() });
    assert.ok(Buffer.isBuffer(buffer));
    const zip = await JSZip.loadAsync(buffer);
    assert.ok(zip.file("word/document.xml"), "el .docx debe traer word/document.xml");
  });

  test("el documento sale APAISADO: el ancho final es mayor que el alto", async () => {
    // Guarda de regresion del comentario en lib/matriz/docx.js: el codigo pasa
    // las medidas de RETRATO (210x297mm) confiando en que la libreria "docx"
    // las intercambia sola por la orientacion landscape. Si esa libreria
    // cambiara de comportamiento, este test lo detectaria (el documento
    // saldria angosto en vez de ancho, arruinando la tabla de 4-5 columnas).
    const buffer = await buildMatrizDocx({ matriz: matrizCorrelacional() });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml").async("string");
    const match = xml.match(/<w:pgSz\s+w:w="(\d+)"\s+w:h="(\d+)"\s+w:orient="(\w+)"\s*\/>/);
    assert.ok(match, "debe existir un <w:pgSz> con w, h y orient");
    const [, wStr, hStr, orient] = match;
    assert.equal(orient, "landscape");
    assert.ok(Number(wStr) > Number(hStr), `ancho (${wStr}) debería ser mayor que el alto (${hStr})`);
  });

  test("con hipótesis (correlacional/explicativa) el docx trae la columna de hipótesis", async () => {
    const buffer = await buildMatrizDocx({ matriz: matrizCorrelacional() });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml").async("string");
    assert.ok(xml.includes("Hipótesis"));
    assert.ok(xml.includes("Hipótesis nula"));
  });

  test("sin hipótesis (descriptiva) el docx NO trae esa columna", async () => {
    const buffer = await buildMatrizDocx({ matriz: matrizDescriptiva() });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml").async("string");
    assert.ok(!xml.includes("Hipótesis nula"));
  });

  test("el título y los nombres de variable aparecen en el documento", async () => {
    const matriz = matrizCorrelacional();
    const buffer = await buildMatrizDocx({ matriz });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml").async("string");
    assert.ok(xml.includes("Matriz de Consistencia"));
    assert.ok(xml.includes(matriz.titulo));
    assert.ok(xml.includes("Gestión administrativa"));
    assert.ok(xml.includes("Calidad de servicio"));
  });

  test("robustez total: una matriz malformada nunca lanza (se entrega el JSON crudo)", async () => {
    // "matriz" llega ya validada por parseMatriz en el flujo normal, pero
    // docx.js documenta explicitamente que prefiere un documento con el JSON
    // crudo antes que tumbar el job completo si algo en el armado falla.
    await assert.doesNotReject(() => buildMatrizDocx({ matriz: {} }));
    await assert.doesNotReject(() => buildMatrizDocx({ matriz: { variables: [] } }));
    await assert.doesNotReject(() => buildMatrizDocx({ matriz: null }));

    const buffer = await buildMatrizDocx({ matriz: {} });
    assert.ok(Buffer.isBuffer(buffer));
    const zip = await JSZip.loadAsync(buffer);
    assert.ok(zip.file("word/document.xml"), "sigue siendo un .docx válido");
  });
});
