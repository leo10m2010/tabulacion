// Validacion de los .docx generados usando LibreOffice Writer como lector
// real (mismo espiritu que scripts/validar-excel-libreoffice.mjs, pero para
// los cuatro documentos Word del proyecto: Matriz de Consistencia,
// Humanizador y Generador de Titulos).
//
// Por que existe: antes de este script, "el .docx es valido" solo se
// verificaba parseando el ZIP con jszip (que word/document.xml exista y
// contenga el texto esperado). Eso prueba que el OOXML esta bien formado,
// pero NO que Word/LibreOffice de verdad lo abran y lo puedan exportar a PDF
// sin errores ni paginas en blanco. Este script cierra ese hueco.
//
// Que hace por cada caso:
//   1. Construye el .docx con el generador real del proyecto (buildMatrizDocx
//      / buildHumanizadorDocx / buildTitulosDocx).
//   2. Comprueba la estructura OOXML minima (ZIP, word/document.xml) sin
//      abrirlo.
//   3. LibreOffice lo convierte a .pdf: si el proceso falla o no produce
//      archivo, el caso se marca en rojo.
//   4. Se extrae el tamano de pagina (MediaBox) del PDF resultante y se
//      compara contra la orientacion esperada (la matriz es APAISADA; el
//      humanizador y los titulos son RETRATO) — verifica en el documento REAL
//      renderizado el comportamiento de la libreria `docx` documentado en
//      lib/matriz/docx.js ("intercambia width/height por su cuenta en
//      landscape"), no solo en el XML crudo.
//
// Uso (PowerShell, desde la raiz del repositorio):
//   node scripts/validar-docx-libreoffice.mjs
//   node scripts/validar-docx-libreoffice.mjs --caso matriz-correlacional
//   node scripts/validar-docx-libreoffice.mjs --salida "D:\ruta\propia"

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildMatrizDocx } from "../node_app/lib/matriz/docx.js";
import { buildHumanizadorDocx } from "../node_app/lib/humanizador/docx.js";
import { buildTitulosDocx } from "../node_app/lib/titulos/docx.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");

// jszip es dependencia de node_app, no de la raiz del repositorio.
const requireDesdeNodeApp = createRequire(path.join(RAIZ, "node_app", "package.json"));
const JSZip = requireDesdeNodeApp("jszip");

// ── LibreOffice ──────────────────────────────────────────────────────────────
const buscarSoffice = () => {
  if (process.env.SOFFICE_PATH && fs.existsSync(process.env.SOFFICE_PATH)) {
    return process.env.SOFFICE_PATH;
  }
  const candidatos = process.platform === "win32"
    ? [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ]
    : ["/usr/bin/soffice", "/usr/local/bin/soffice", "/opt/libreoffice/program/soffice"];
  return candidatos.find((c) => fs.existsSync(c)) ?? null;
};

const perfilUri = (dir) => new URL(`file:///${dir.replace(/\\/g, "/")}`).href;

const correrSoffice = (soffice, perfil, formato, entrada, salidaDir) => {
  const inicio = Date.now();
  const r = spawnSync(soffice, [
    `-env:UserInstallation=${perfilUri(perfil)}`,
    "--headless",
    "--norestore",
    "--convert-to", formato,
    "--outdir", salidaDir,
    entrada,
  ], { encoding: "utf8", timeout: 180_000, windowsHide: true });
  return {
    code: r.status,
    ms: Date.now() - inicio,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    error: r.error ? String(r.error.message) : null,
  };
};

// ── Validacion estructural minima (sin abrir con un procesador de texto) ────
const validarOoxml = async (buffer) => {
  const problemas = [];
  const zip = await JSZip.loadAsync(buffer);
  for (const obligatoria of ["[Content_Types].xml", "word/document.xml", "_rels/.rels"]) {
    if (!zip.file(obligatoria)) problemas.push(`falta la parte ${obligatoria}`);
  }
  return { problemas, partes: Object.keys(zip.files).length };
};

// Tamano de pagina real (MediaBox) del PDF que LibreOffice produjo, en
// puntos (1/72"). Con esto se verifica la orientacion REAL renderizada, no
// solo el <w:pgSz> que el generador escribio en el XML.
const paginaDePdf = (rutaPdf) => {
  const bin = fs.readFileSync(rutaPdf);
  const texto = bin.toString("latin1");
  const m = texto.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!m) return null;
  const [, x1, y1, x2, y2] = m.map(Number);
  return { width: Math.round((x2 - x1) * 100) / 100, height: Math.round((y2 - y1) * 100) / 100 };
};

// ── Fixtures de contenido ────────────────────────────────────────────────────
const matrizCorrelacional = {
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
      fuente: "https://example.com/chiavenato-2019",
      dimensiones: ["Selección de personal", "Capacitación", "Evaluación del desempeño"],
    },
    {
      nombre: "Desempeño laboral", rol: "dependiente", autor: "Robbins (2020)",
      fuente: "https://example.com/robbins-2020",
      dimensiones: ["Productividad", "Calidad del trabajo", "Compromiso"],
    },
  ],
  metodologia: {
    tipo: "Aplicada", enfoque: "Cuantitativo", nivel: "Correlacional", diseno: "No experimental, transversal",
    poblacion: "120 trabajadores", muestra: "92 trabajadores", muestreo: "Probabilístico aleatorio simple",
    tecnica: "Encuesta", instrumento: "Cuestionario tipo Likert",
  },
};

const matrizDescriptiva = {
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
};

// Nombres largos + caracteres especiales: mismo espiritu que los casos
// "nombres-largos"/"caracteres-especiales" del script de Excel, para que la
// tabla no se rompa con contenido real de tesis.
const matrizNombresLargos = {
  ...matrizCorrelacional,
  titulo: "Gestión & control (2026) del talento humano / atención [área RR.HH.] y su relación con el desempeño laboral de los colaboradores administrativos y operativos, Municipalidad Distrital de Prueba, 2026",
  variables: [
    {
      nombre: "Gestión & control del talento humano (dimensión ampliada, con paréntesis y símbolos)",
      rol: "independiente", autor: "Chiavenato, I. (2019)", fuente: "https://example.com/chiavenato-2019?ref=capitulo-4&lang=es",
      dimensiones: [
        "Selección de personal y reclutamiento interno/externo",
        "Capacitación & desarrollo profesional continuo",
        "Evaluación del desempeño 360°",
      ],
    },
    {
      nombre: "Desempeño laboral / satisfacción [área operativa]", rol: "dependiente", autor: "Robbins & Judge (2020)",
      fuente: "https://example.com/robbins-2020", dimensiones: ["Productividad", "Calidad del trabajo", "Compromiso organizacional"],
    },
  ],
};

const humanizadorTexto = Array.from({ length: 6 }, (_, i) => (
  `Párrafo ${i + 1} del texto humanizado: la gestión del talento humano incide de forma relevante `
  + "en el desempeño laboral de los colaboradores, según lo evidencian los resultados obtenidos "
  + "en la muestra estudiada (García et al., 2023, p. 45)."
)).join("\n\n");

const humanizadorUnParrafo = "Un único párrafo corto para el caso borde de un texto minimo.";

const titulosContenido = `**TÍTULO 1**
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
Otro parrafo de contexto con **negrita** y *cursiva* de prueba.

**TÍTULO 3**
"Tercer título con nombres largos: gestión & control (2026) del área [RR.HH.] / atención, Huánuco, 2026"

**1. PROBLEMA Y PROPÓSITO A ABORDAR**
Contenido con caracteres especiales & símbolos [de prueba].
`;

const titulosInput = {
  universidad: "Universidad de Huánuco", carrera: "Enfermería", lugar: "Huánuco", anio: "2026",
};

// ── Casos ────────────────────────────────────────────────────────────────────
// `orientacionEsperada` guia la verificacion del MediaBox del PDF real.
export const CASOS = [
  {
    id: "matriz-correlacional", orientacionEsperada: "landscape",
    build: () => buildMatrizDocx({ matriz: matrizCorrelacional }),
  },
  {
    id: "matriz-descriptiva-sin-hipotesis", orientacionEsperada: "landscape",
    build: () => buildMatrizDocx({ matriz: matrizDescriptiva }),
  },
  {
    id: "matriz-nombres-largos-y-caracteres-especiales", orientacionEsperada: "landscape",
    build: () => buildMatrizDocx({ matriz: matrizNombresLargos }),
  },
  {
    id: "humanizador-varios-parrafos", orientacionEsperada: "portrait",
    build: () => buildHumanizadorDocx({ texto: humanizadorTexto }),
  },
  {
    id: "humanizador-un-parrafo", orientacionEsperada: "portrait",
    build: () => buildHumanizadorDocx({ texto: humanizadorUnParrafo }),
  },
  {
    id: "titulos-completo", orientacionEsperada: "portrait",
    build: () => buildTitulosDocx({ contenido: titulosContenido, input: titulosInput }),
  },
  {
    id: "titulos-contenido-vacio", orientacionEsperada: "portrait",
    build: () => buildTitulosDocx({ contenido: "", input: titulosInput }),
  },
];

// ── Programa ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : null;
};

const main = async () => {
  const soffice = buscarSoffice();
  const salidaBase = arg("--salida") ?? path.join(os.tmpdir(), "tesistab-validacion-docx");
  const dirs = {
    original: path.join(salidaBase, "original"),
    pdf: path.join(salidaBase, "pdf"),
    perfil: path.join(salidaBase, "perfil-libreoffice"),
  };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));

  console.log(`Salida:       ${salidaBase}`);
  console.log(`LibreOffice:  ${soffice ?? "NO ENCONTRADO (se omiten los pasos de LibreOffice)"}`);

  const soloCaso = arg("--caso");
  const casos = soloCaso ? CASOS.filter((c) => c.id === soloCaso) : CASOS;
  const manifiesto = [];

  for (const caso of casos) {
    const entrada = { id: caso.id };
    const t0 = Date.now();
    try {
      const buffer = await caso.build();
      entrada.generacion = { ok: true, ms: Date.now() - t0, bytes: buffer.length };

      const rutaDocx = path.join(dirs.original, `${caso.id}.docx`);
      fs.writeFileSync(rutaDocx, buffer);

      const estructura = await validarOoxml(buffer);
      entrada.estructura = { ok: estructura.problemas.length === 0, problemas: estructura.problemas, partes: estructura.partes };

      if (soffice) {
        const pdf = correrSoffice(soffice, dirs.perfil, "pdf", rutaDocx, dirs.pdf);
        const destinoPdf = path.join(dirs.pdf, `${caso.id}.pdf`);
        const existePdf = fs.existsSync(destinoPdf);
        entrada.libreofficePdf = {
          code: pdf.code, ms: pdf.ms, archivo: existePdf,
          bytes: existePdf ? fs.statSync(destinoPdf).size : 0,
          stderr: pdf.stderr.slice(0, 400) || null,
        };
        if (existePdf) {
          const pagina = paginaDePdf(destinoPdf);
          entrada.pagina = pagina;
          if (pagina) {
            const esApaisada = pagina.width > pagina.height;
            const orientacionReal = esApaisada ? "landscape" : "portrait";
            entrada.orientacion = {
              esperada: caso.orientacionEsperada, real: orientacionReal,
              ok: orientacionReal === caso.orientacionEsperada,
            };
          }
        }
      }
    } catch (err) {
      entrada.generacion = { ok: false, ms: Date.now() - t0, error: String(err.message) };
    }
    manifiesto.push(entrada);
    const marca = !entrada.generacion.ok ? "FALLO-GENERACION"
      : entrada.estructura?.ok === false ? "FALLO-ESTRUCTURA"
        : entrada.libreofficePdf && !entrada.libreofficePdf.archivo ? "FALLO-PDF"
          : entrada.orientacion && !entrada.orientacion.ok ? `ORIENTACION(${entrada.orientacion.real}!=${entrada.orientacion.esperada})`
            : "ok";
    entrada.veredicto = marca;
    const detallePagina = entrada.pagina ? ` (${entrada.pagina.width}x${entrada.pagina.height}pt)` : "";
    console.log(`  [${marca}] ${caso.id}${detallePagina}`);
  }

  const rutaManifiesto = path.join(salidaBase, "manifiesto.json");
  fs.writeFileSync(rutaManifiesto, JSON.stringify({
    generadoEn: new Date().toISOString(), libreoffice: soffice, casos: manifiesto,
  }, null, 2));
  console.log(`\nManifiesto: ${rutaManifiesto}`);
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
