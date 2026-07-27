// Pruebas de buildMatrizDocx (lib/matriz/docx.js).
//
// Antes de esto, este generador no tenia NINGUNA prueba (a diferencia de
// buildTitulosDocx, que si valida que el buffer sea un .docx real). Cubre:
//   1. El buffer es un .docx valido (zip con word/document.xml) con 5
//      columnas cuando la matriz trae hipotesis (correlacional/explicativa) y
//      4 cuando no (descriptiva).
//   2. El contenido esperado esta en el XML (titulo, secciones, variables).
//   3. Robustez: nunca lanza, ni con una matriz incompleta o vacia (cae a
//      contenido crudo en vez de tumbar el job — ver el try/catch del propio
//      modulo).
//   4. La orientacion APAISADA: se verifica el <w:pgSz> que docx escribe de
//      verdad, porque la libreria intercambia width/height por su cuenta en
//      landscape (ver el comentario de docx.js) — si esa libreria cambiara de
//      comportamiento en una actualizacion, este test lo detectaria.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildMatrizDocx } from "../lib/matriz/docx.js";

const matrizCorrelacional = () => ({
  titulo: "Gestión del talento humano y desempeño laboral en la Municipalidad de Prueba, 2026",
  problema: {
    general: "¿Cuál es la relación entre la gestión del talento humano y el desempeño laboral?",
    especificos: [
      "¿Cuál es la relación entre la selección de personal y el desempeño laboral?",
      "¿Cuál es la relación entre la capacitación y el desempeño laboral?",
    ],
  },
  objetivos: {
    general: "Determinar la relación entre la gestión del talento humano y el desempeño laboral.",
    especificos: [
      "Determinar la relación entre la selección de personal y el desempeño laboral.",
      "Determinar la relación entre la capacitación y el desempeño laboral.",
    ],
  },
  hipotesis: {
    general: "Existe relación significativa entre la gestión del talento humano y el desempeño laboral.",
    nula: "No existe relación significativa entre la gestión del talento humano y el desempeño laboral.",
    especificas: ["Existe relación significativa entre la selección de personal y el desempeño laboral."],
  },
  variables: [
    {
      nombre: "Gestión del talento humano", rol: "independiente", autor: "Chiavenato (2019)",
      fuente: "https://example.com/chiavenato-2019", dimensiones: ["Selección de personal", "Capacitación", "Evaluación del desempeño"],
    },
    {
      nombre: "Desempeño laboral", rol: "dependiente", autor: "Robbins (2020)",
      fuente: "https://example.com/robbins-2020", dimensiones: ["Productividad", "Calidad del trabajo", "Compromiso"],
    },
  ],
  metodologia: {
    tipo: "Aplicada", enfoque: "Cuantitativo", nivel: "Correlacional", diseno: "No experimental, transversal",
    poblacion: "120 trabajadores", muestra: "92 trabajadores", muestreo: "Probabilístico aleatorio simple",
    tecnica: "Encuesta", instrumento: "Cuestionario tipo Likert",
  },
});

const matrizDescriptiva = () => ({
  titulo: "Nivel de clima organizacional en la I.E. de prueba, 2026",
  problema: { general: "¿Cuál es el nivel de clima organizacional?", especificos: [] },
  objetivos: { general: "Determinar el nivel de clima organizacional.", especificos: [] },
  hipotesis: null,
  variables: [{
    nombre: "Clima organizacional", rol: "única", autor: "Litwin y Stringer (1968)",
    fuente: "https://example.com/litwin-1968", dimensiones: ["Estructura", "Responsabilidad", "Recompensa"],
  }],
  metodologia: {
    tipo: "Básica", enfoque: "Cuantitativo", nivel: "Descriptivo", diseno: "No experimental, transversal",
    poblacion: "60 docentes", muestra: "60 docentes", muestreo: "Censal",
    tecnica: "Encuesta", instrumento: "Cuestionario",
  },
});

test("buildMatrizDocx (correlacional): zip valido, 5 columnas y contenido esperado", async () => {
  const matriz = matrizCorrelacional();
  const buffer = await buildMatrizDocx({ matriz });
  assert.ok(Buffer.isBuffer(buffer));

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("word/document.xml"), "el .docx debe traer word/document.xml");
  assert.ok(zip.file("[Content_Types].xml"), "el .docx debe traer [Content_Types].xml");
  const xml = await zip.file("word/document.xml").async("string");

  assert.ok(xml.includes("Matriz de Consistencia"));
  assert.ok(xml.includes("Gestión del talento humano"));
  assert.ok(xml.includes("Desempeño laboral"));
  assert.ok(xml.includes("Hipótesis general"));
  assert.ok(xml.includes("Chiavenato"));
  assert.ok(xml.includes("example.com/chiavenato-2019"));

  // 5 columnas: problemas/objetivos/hipotesis/variables/metodologia. Se
  // cuentan las celdas de encabezado buscando los 5 titulos de columna.
  for (const header of ["Problemas", "Objetivos", "Hipótesis", "Variables y dimensiones", "Metodología"]) {
    assert.ok(xml.includes(header), `falta el encabezado "${header}"`);
  }
});

test("buildMatrizDocx (descriptiva, sin hipotesis): 4 columnas, sin la seccion de hipotesis", async () => {
  const matriz = matrizDescriptiva();
  const buffer = await buildMatrizDocx({ matriz });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");

  assert.ok(xml.includes("Clima organizacional"));
  assert.ok(!xml.includes("Hipótesis general"), "una matriz descriptiva no debe traer la columna de hipotesis");
  for (const header of ["Problemas", "Objetivos", "Variables y dimensiones", "Metodología"]) {
    assert.ok(xml.includes(header));
  }
  assert.ok(!xml.includes(">Hipótesis<"));
});

test("buildMatrizDocx nunca lanza: matriz vacia u objeto malformado cae a contenido crudo", async () => {
  await assert.doesNotReject(() => buildMatrizDocx({ matriz: {} }));
  await assert.doesNotReject(() => buildMatrizDocx({ matriz: null }));
  await assert.doesNotReject(() => buildMatrizDocx({ matriz: { titulo: "Solo título, sin nada más" } }));

  // Con datos incompletos (falla el armado de la tabla), el documento debe
  // seguir siendo un .docx valido con el JSON crudo adentro, no un buffer roto.
  const buffer = await buildMatrizDocx({ matriz: { titulo: "Incompleta" } });
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("word/document.xml"));
});

test("buildMatrizDocx: la pagina queda APAISADA con w > h (la libreria docx intercambia width/height)", async () => {
  // Documenta y protege el comportamiento descrito en el comentario de
  // docx.js: se pasan las medidas de RETRATO (210x297mm) porque la libreria
  // `docx` las intercambia sola cuando orientation=LANDSCAPE. Si una
  // actualizacion de la libreria dejara de hacerlo, este test lo detectaria
  // (la pagina saldria con w < h pese a pedir apaisado).
  const buffer = await buildMatrizDocx({ matriz: matrizCorrelacional() });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const match = xml.match(/<w:pgSz\s+w:w="(\d+)"\s+w:h="(\d+)"\s+w:orient="landscape"\/>/);
  assert.ok(match, `debe existir <w:pgSz .../> con w:orient="landscape" (xml: ${xml.slice(0, 200)})`);
  const [, w, h] = match.map(Number);
  assert.ok(w > h, `la pagina debe quedar mas ancha que alta (w=${w}, h=${h})`);
  // A4 apaisado en twips: ~297mm de ancho (~16838) x ~210mm de alto (~11906).
  assert.ok(w > 16000 && w < 17000, `ancho fuera de rango esperado para A4 apaisado: ${w}`);
  assert.ok(h > 11000 && h < 12500, `alto fuera de rango esperado para A4 apaisado: ${h}`);
});
