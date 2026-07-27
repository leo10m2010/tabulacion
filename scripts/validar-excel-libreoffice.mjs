// Validacion de los Excel generados usando LibreOffice como lector real.
//
// Por que existe: hasta ahora los archivos se validaban parseando el XML
// (openpyxl / jszip). Eso prueba que el OOXML es estructuralmente correcto,
// pero NO que una hoja de calculo de verdad lo abra, resuelva sus formulas y
// lo vuelva a guardar sin reparar nada. Este script cierra ese hueco.
//
// Que hace por cada caso:
//   1. Genera el .xlsx con el generador real del proyecto.
//   2. Comprueba la estructura OOXML (ZIP, partes, merges invertidos, nombres
//      de hoja) sin abrirlo.
//   3. LibreOffice lo convierte a .xlsx -> lo abre, RECALCULA y lo guarda.
//      Como el generador escribe formulas sin valor cacheado, el archivo
//      recalculado solo tiene valores si LibreOffice supo evaluarlas.
//   4. LibreOffice lo convierte a .pdf para revision visual.
//   5. Se escribe un manifiesto JSON con el resultado de cada paso.
//
// Uso (PowerShell, desde la raiz del repositorio):
//   node scripts/validar-excel-libreoffice.mjs
//   node scripts/validar-excel-libreoffice.mjs --caso 2-variables-spearman
//   node scripts/validar-excel-libreoffice.mjs --salida "D:\ruta\propia"
//
// Todo va a un directorio temporal del sistema salvo que se indique --salida.
// Nada se escribe dentro del repositorio.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG_PATH, generateArtifacts } from "../node_app/generator.js";
import { generateCronbach } from "../node_app/lib/cronbach.js";
import { postProcessWorkbook } from "../node_app/lib/ooxml.js";
import { CHART_THEMES } from "../node_app/lib/config.js";
import { buildDescriptivaWorkbook } from "../node_app/lib/descriptiva/workbook.js";
import {
  computeAciertos, computeLikertPuntajes, computePuntajes, detectLikertBaremo,
} from "../node_app/lib/descriptiva/compute.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");

// jszip es dependencia de node_app, no de la raiz del repositorio: se resuelve
// desde alli en vez de exigir una instalacion extra solo para este script.
const requireDesdeNodeApp = createRequire(path.join(RAIZ, "node_app", "package.json"));
const JSZip = requireDesdeNodeApp("jszip");

// ── LibreOffice ──────────────────────────────────────────────────────────────
// No se asume la ruta: se busca en el PATH y en las ubicaciones habituales de
// Windows, y si no aparece el script lo dice en vez de fallar a medias.
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

// Perfil temporal propio por ejecucion: LibreOffice se bloquea si dos procesos
// comparten perfil, y no debe tocarse el perfil personal del usuario.
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

// ── Validacion estructural (sin abrir con una hoja de calculo) ────────────────
const columnaANumero = (letras) => [...letras.toUpperCase()]
  .reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

const validarOoxml = async (buffer) => {
  const problemas = [];
  const zip = await JSZip.loadAsync(buffer);

  for (const obligatoria of ["[Content_Types].xml", "xl/workbook.xml"]) {
    if (!zip.file(obligatoria)) problemas.push(`falta la parte ${obligatoria}`);
  }

  // Nombres de hoja: <=31, sin caracteres prohibidos, sin apostrofo al borde,
  // sin espacios al borde y sin duplicados.
  const workbook = await zip.file("xl/workbook.xml")?.async("string") ?? "";
  const nombres = [...workbook.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => m[1]);
  const vistos = new Set();
  nombres.forEach((n) => {
    const limpio = n.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
    if (limpio.length > 31) problemas.push(`nombre de hoja de ${limpio.length} caracteres: "${limpio}"`);
    if (/[[\]*?:/\\]/.test(limpio)) problemas.push(`caracteres prohibidos en la hoja "${limpio}"`);
    if (limpio !== limpio.trim()) problemas.push(`espacio al borde en la hoja "${limpio}"`);
    if (limpio.startsWith("'") || limpio.endsWith("'")) problemas.push(`apostrofo al borde en la hoja "${limpio}"`);
    const clave = limpio.toLowerCase();
    if (vistos.has(clave)) problemas.push(`nombre de hoja duplicado: "${limpio}"`);
    vistos.add(clave);
  });

  // Celdas combinadas invertidas: el defecto que producia archivos que ninguna
  // hoja de calculo abre.
  const hojas = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  for (const hoja of hojas) {
    const xml = await zip.file(hoja).async("string");
    for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)) {
      const [, c1, f1, c2, f2] = m;
      if (columnaANumero(c1) > columnaANumero(c2) || Number(f1) > Number(f2)) {
        problemas.push(`${hoja}: celda combinada invertida ${m[1]}${m[2]}:${m[3]}${m[4]}`);
      }
    }
    // Rangos invertidos dentro de formulas (SUM(K34:J34)).
    for (const m of xml.matchAll(/<f>([^<]*)<\/f>/g)) {
      for (const r of m[1].matchAll(/\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)/g)) {
        if (columnaANumero(r[1]) > columnaANumero(r[3])) {
          problemas.push(`${hoja}: rango invertido en formula "${m[1].slice(0, 60)}"`);
          break;
        }
      }
    }
  }
  return { problemas, hojas: nombres, partes: Object.keys(zip.files).length };
};

// Errores de formula en el archivo que LibreOffice recalculo y guardo.
//
// Este es el paso que de verdad valida las formulas. El generador las escribe
// SIN valor cacheado, asi que el archivo recalculado solo tiene valores porque
// LibreOffice las evaluo. Una celda que no supo resolver queda marcada con
// t="e" y su texto de error (#REF!, #NAME?, #DIV/0!, Err:xxx).
//
// Que el proceso devuelva 0 no basta: LibreOffice convierte igual un libro
// lleno de #REF!.
const erroresDeFormula = async (rutaXlsx) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(rutaXlsx));
  const hojasXml = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  const porTipo = new Map();
  let total = 0;
  const ejemplos = [];

  for (const hoja of hojasXml) {
    const xml = await zip.file(hoja).async("string");
    for (const m of xml.matchAll(/<c[^>]*r="([A-Z]+\d+)"[^>]*t="e"[^>]*>(.*?)<\/c>/gs)) {
      const valor = (m[2].match(/<v>([^<]*)<\/v>/)?.[1] ?? "?").trim();
      total += 1;
      porTipo.set(valor, (porTipo.get(valor) ?? 0) + 1);
      if (ejemplos.length < 5) ejemplos.push(`${hoja.replace("xl/worksheets/", "")}!${m[1]} = ${valor}`);
    }
  }
  return { total, porTipo: Object.fromEntries(porTipo), ejemplos };
};

// ── Casos ────────────────────────────────────────────────────────────────────
const base = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));

// Cada caso conserva las funciones que el producto ofrece hoy; ninguno existe
// para comprobar que algo se haya desactivado.
export const CASOS = [
  { id: "1-variable-sin-datos", cfg: { ...base, variable: "1", conDatos: "0" } },
  { id: "1-variable-simulada", cfg: { ...base, variable: "1" } },
  { id: "2-variables-spearman", cfg: { ...base, metodoCorrelacion: "spearman" } },
  { id: "2-variables-pearson", cfg: { ...base, metodoCorrelacion: "pearson", muestra: "40" } },
  { id: "correlacion-positiva-muy-alta", cfg: { ...base, controlCorrelacion: "1", nivelCorrelacion: "muy_alta", relacionversa: "0" } },
  { id: "correlacion-negativa-moderada", cfg: { ...base, controlCorrelacion: "1", nivelCorrelacion: "moderada", relacionversa: "1" } },
  { id: "correlacion-nula", cfg: { ...base, controlCorrelacion: "1", nivelCorrelacion: "nula" } },
  { id: "correlacion-sin-control", cfg: { ...base, controlCorrelacion: "0" } },
  { id: "likert-3-niveles", cfg: { ...base, respuesta: "3", nombre_respuesta: ["Nunca", "A veces", "Siempre"] } },
  { id: "likert-7-niveles", cfg: { ...base, respuesta: "7" } },
  { id: "escala-personalizada", cfg: { ...base, respuesta: "4", nombre_respuesta: ["Deficiente", "Regular", "Bueno", "Excelente"] } },
  { id: "baremo-automatico-5", cfg: { ...base, escala: "5", nombre_escala: ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"] } },
  { id: "baremo-manual", cfg: { ...base, escala: "3", nombre_escala: ["Bajo", "Medio", "Alto"], desde: ["18", "43", "67"], hasta: ["42", "66", "90"] } },
  { id: "muestra-minima", cfg: { ...base, muestra: "5" } },
  { id: "muestra-mediana", cfg: { ...base, muestra: "289" } },
  { id: "nombres-largos", cfg: { ...base, nombre_dimension: ["Calidad percibida del servicio educativo universitario", "Satisfaccion general de los estudiantes matriculados"] } },
  { id: "caracteres-especiales", cfg: { ...base, nombre_dimension: ["Gestion & control (2026)", "Servicio / atencion [area]"] } },
  { id: "cuasiexperimental", cfg: null, ejemplo: "Tabulacion_cuasiexperimental.json" },
  { id: "cuasiexperimental-seguimiento", cfg: null, ejemplo: "Tabulacion_cuasiexperimental_seguimiento.json" },
];

// ── Alfa de Cronbach (lib/cronbach.js) ──────────────────────────────────────
// Hueco real que este script no cubria: la prueba de confiabilidad tiene su
// propio orquestador (generateCronbach), separado por completo de
// generateArtifacts. Antes de esto, su Excel solo se habia validado
// parseandolo con xlsx-populate/jszip (test/server.test.js, generator.test.js)
// pero JAMAS abierto por una hoja de calculo real que recalcule VARP/COUNT y
// el alfa en celda. Los casos cubren 1 y varias dimensiones, la muestra minima
// permitida (5, borde de VARP con pocos datos) y los tres niveles de alfa.
const casoCronbach = (id, cfg) => ({
  id,
  build: async () => {
    const r = await generateCronbach(cfg);
    return { excelBuffer: r.excelBuffer, correlation: null, warnings: r.warnings };
  },
});

const CRONBACH_CASOS = [
  casoCronbach("cronbach-una-dimension", {
    variable: "Satisfacción laboral", encuestados: 30,
    dimensiones: [{ nombre: "Dimensión única", items: 10 }], nivelAlfa: "excelente",
  }),
  casoCronbach("cronbach-multidimensional", {
    variable: "Clima organizacional", encuestados: 45,
    dimensiones: [
      { nombre: "Comunicación", items: 6 },
      { nombre: "Liderazgo", items: 5 },
      { nombre: "Reconocimiento", items: 4 },
    ],
    nivelAlfa: "bueno",
  }),
  casoCronbach("cronbach-nivel-aceptable", {
    variable: "Motivación docente", encuestados: 20,
    dimensiones: [{ nombre: "Motivación", items: 8 }], nivelAlfa: "aceptable",
  }),
  casoCronbach("cronbach-muestra-minima", {
    // N=5 es el minimo que acepta normalizeCronbachConfig: borde real para
    // VARP (varianza poblacional con muy pocos datos).
    variable: "Prueba piloto", encuestados: 5,
    dimensiones: [{ nombre: "Única", items: 4 }], nivelAlfa: "excelente",
  }),
  casoCronbach("cronbach-escala-personalizada", {
    variable: "Calidad percibida", encuestados: 25,
    respuesta: 4, nombre_respuesta: ["Deficiente", "Regular", "Bueno", "Excelente"],
    dimensiones: [{ nombre: "Percepción", items: 12 }], nivelAlfa: "bueno",
  }),
];

// ── Descriptiva (lib/descriptiva/workbook.js) ───────────────────────────────
// Segundo hueco: descriptiva tambien construye su Excel fuera de
// generateArtifacts (buildDescriptivaWorkbook). Se llama al constructor del
// documento directamente con datos fijos (mismo enfoque que
// test/descriptiva.test.js) en vez de generateDescriptiva completo, porque
// ese orquestador llama a OpenRouter (red + API key) y lo que este script
// valida es el documento, no la IA. Cubre los tres tipos de instrumento
// (independiente sin baremo, puntaje sumado y conocimiento con baremo propio)
// mas el baremo Likert Bajo/Medio/Alto que el propio sistema construye.
const ESCALA_LIKERT_DESC = ["Nunca", "A veces", "Casi siempre", "Siempre"];

const fixtureDescriptivaIndependiente = (n = 25) => ({
  metadata: {
    titulo_estudio: "Consumo de bebidas azucaradas, I.E. de prueba - 2026",
    n_encuestados: n, tipo_instrumento: "independiente", nivel_preponderancia: "ALTO",
  },
  preguntas: [
    { id: "p1_edad", texto: "Edad", tipo: "numerica", rango: [12, 17] },
    {
      id: "p2_genero", texto: "Género", tipo: "nominal_unica",
      opciones: ["Masculino", "Femenino"], pesos: [0.5, 0.5], es_ancla: false, depende_de: null,
    },
    {
      id: "p3_frecuencia", texto: "¿Con qué frecuencia consumes?", tipo: "ordinal_unica",
      opciones: ["Siempre", "A veces", "Nunca"], pesos: [0.5, 0.3, 0.2], es_ancla: true, depende_de: null,
    },
    {
      id: "p4_tipo", texto: "¿Qué tipos consumes?", tipo: "multirrespuesta",
      opciones: ["Gaseosa", "Jugo", "Energizante"], pesos_marca_independientes: [0.6, 0.5, 0.3],
      es_ancla: false, depende_de: "p3_frecuencia",
    },
  ],
  baremo: null,
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_edad: 12 + (i % 6),
    p2_genero: i % 2 === 0 ? "Masculino" : "Femenino",
    p3_frecuencia: ["Siempre", "A veces", "Nunca"][i % 3],
    p4_tipo__gaseosa: i % 2,
    p4_tipo__jugo: (i + 1) % 2,
    p4_tipo__energizante: i % 3 === 0 ? 1 : 0,
  })),
});

const fixtureDescriptivaPuntaje = (n = 20) => ({
  metadata: {
    titulo_estudio: "Test de riesgo (FINDRISC adaptado) - 2026",
    n_encuestados: n, tipo_instrumento: "puntaje_sumado", nivel_preponderancia: "MODERADO",
  },
  preguntas: [
    {
      id: "p1_imc", texto: "IMC", tipo: "ordinal_unica",
      opciones: ["Menor de 25", "25 a 30", "Mayor de 30"],
      pesos: [0.3, 0.4, 0.3], puntos_por_opcion: [0, 1, 3], es_ancla: true, depende_de: null,
    },
    {
      id: "p2_actividad", texto: "¿Realiza actividad física?", tipo: "nominal_unica",
      opciones: ["Sí", "No"], pesos: [0.4, 0.6], puntos_por_opcion: [0, 2], es_ancla: false, depende_de: "p1_imc",
    },
  ],
  baremo: {
    variable_base: "puntaje_total",
    rangos: [
      { min: 0, max: 1, categoria: "Riesgo bajo" },
      { min: 2, max: 3, categoria: "Riesgo moderado" },
      { min: 4, max: 5, categoria: "Riesgo alto" },
    ],
  },
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_imc: ["Menor de 25", "25 a 30", "Mayor de 30"][i % 3],
    p2_actividad: i % 2 === 0 ? "Sí" : "No",
  })),
});

const fixtureDescriptivaConocimiento = (n = 18) => ({
  metadata: {
    titulo_estudio: "Cuestionario de conocimiento en RCP - 2026",
    n_encuestados: n, tipo_instrumento: "conocimiento", nivel_preponderancia: "MODERADO",
  },
  preguntas: [
    {
      id: "p1_rcp", texto: "¿Qué significa RCP?", tipo: "nominal_unica",
      opciones: ["a) Reanimación cardiopulmonar", "b) Revisión clínica", "c) Rescate primario"],
      pesos: [0.6, 0.2, 0.2], respuesta_correcta: "a) Reanimación cardiopulmonar", es_ancla: false, depende_de: null,
    },
    {
      id: "p2_compresiones", texto: "¿Frecuencia de compresiones?", tipo: "nominal_unica",
      opciones: ["a) 60/min", "b) 100-120/min", "c) 140/min"],
      pesos: [0.2, 0.5, 0.3], respuesta_correcta: "b) 100-120/min", es_ancla: false, depende_de: null,
    },
  ],
  baremo: {
    variable_base: "porcentaje_aciertos",
    rangos: [
      { min: 0, max: 49, categoria: "Conocimiento bajo" },
      { min: 50, max: 74, categoria: "Conocimiento medio" },
      { min: 75, max: 100, categoria: "Conocimiento alto" },
    ],
  },
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_rcp: i % 2 === 0 ? "a) Reanimación cardiopulmonar" : "b) Revisión clínica",
    p2_compresiones: i % 4 === 0 ? "b) 100-120/min" : "a) 60/min",
  })),
});

const fixtureDescriptivaLikert = (n = 24) => ({
  metadata: {
    titulo_estudio: "Clima organizacional, empresa de prueba - 2026",
    n_encuestados: n, tipo_instrumento: "independiente", nivel_preponderancia: "MODERADO",
  },
  preguntas: [
    { id: "p1_edad", texto: "Edad", tipo: "numerica", rango: [20, 60] },
    ...[1, 2, 3, 4].map((k) => ({
      id: `p${k + 1}_item`, texto: `Ítem Likert ${k}`, tipo: "ordinal_unica",
      opciones: [...ESCALA_LIKERT_DESC], pesos: [0.2, 0.3, 0.3, 0.2], es_ancla: k === 1, depende_de: null,
    })),
  ],
  baremo: null,
  datos_simulados: Array.from({ length: n }, (_, i) => ({
    p1_edad: 20 + (i * 3) % 40,
    p2_item: ESCALA_LIKERT_DESC[i % 4],
    p3_item: ESCALA_LIKERT_DESC[(i + 1) % 4],
    p4_item: ESCALA_LIKERT_DESC[(i + 2) % 4],
    p5_item: ESCALA_LIKERT_DESC[i % 4],
  })),
});

const casoDescriptiva = (id, { data, computed = null, baremoLikert = null }) => ({
  id,
  build: async () => {
    const { workbook, sheetCharts } = await buildDescriptivaWorkbook(data, computed, baremoLikert);
    const plainBuffer = await workbook.outputAsync({ type: "nodebuffer" });
    const excelBuffer = await postProcessWorkbook(plainBuffer, sheetCharts, CHART_THEMES.clasico.colores);
    return { excelBuffer, correlation: null, warnings: [] };
  },
});

const descIndependiente = fixtureDescriptivaIndependiente();
const descPuntaje = fixtureDescriptivaPuntaje();
const descConocimiento = fixtureDescriptivaConocimiento();
const descLikertData = fixtureDescriptivaLikert();
const descLikertBaremo = detectLikertBaremo(descLikertData);

const DESCRIPTIVA_CASOS = [
  casoDescriptiva("descriptiva-independiente-sin-baremo", { data: descIndependiente }),
  casoDescriptiva("descriptiva-puntaje-sumado", {
    data: descPuntaje,
    computed: computePuntajes(descPuntaje.preguntas, descPuntaje.datos_simulados, descPuntaje.baremo),
  }),
  casoDescriptiva("descriptiva-conocimiento", {
    data: descConocimiento,
    computed: computeAciertos(descConocimiento.preguntas, descConocimiento.datos_simulados, descConocimiento.baremo),
  }),
  casoDescriptiva("descriptiva-likert-baremo-generado", {
    data: descLikertData,
    computed: computeLikertPuntajes(descLikertBaremo, descLikertData.datos_simulados),
    baremoLikert: descLikertBaremo,
  }),
];

CASOS.push(...CRONBACH_CASOS, ...DESCRIPTIVA_CASOS);

const construirConfig = (caso) => {
  if (caso.cfg) return caso.cfg;
  return JSON.parse(fs.readFileSync(path.join(RAIZ, "examples", caso.ejemplo), "utf-8"));
};

// ── Programa ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : null;
};

const main = async () => {
  const soffice = buscarSoffice();
  const salidaBase = arg("--salida")
    ?? path.join(os.tmpdir(), "tesistab-validacion-excel");
  const dirs = {
    original: path.join(salidaBase, "original"),
    recalculado: path.join(salidaBase, "recalculado"),
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
      // Casos "build" (Cronbach, Descriptiva) traen su propio constructor de
      // Excel, separado de generateArtifacts/normalizeConfig: no tienen cfg
      // ni ejemplo que pasarle a construirConfig.
      const resultado = caso.build ? await caso.build() : await generateArtifacts(construirConfig(caso));
      entrada.generacion = { ok: true, ms: Date.now() - t0, bytes: resultado.excelBuffer.length };
      entrada.correlacion = typeof resultado.correlation === "number"
        ? Number(resultado.correlation.toFixed(4)) : null;
      entrada.avisos = resultado.warnings ?? [];

      const rutaXlsx = path.join(dirs.original, `${caso.id}.xlsx`);
      fs.writeFileSync(rutaXlsx, resultado.excelBuffer);

      const estructura = await validarOoxml(resultado.excelBuffer);
      entrada.estructura = {
        ok: estructura.problemas.length === 0,
        problemas: estructura.problemas,
        hojas: estructura.hojas.length,
        partes: estructura.partes,
      };

      if (soffice) {
        const conv = correrSoffice(soffice, dirs.perfil, "xlsx", rutaXlsx, dirs.recalculado);
        const destino = path.join(dirs.recalculado, `${caso.id}.xlsx`);
        entrada.libreofficeXlsx = {
          code: conv.code,
          ms: conv.ms,
          // El archivo debe EXISTIR: un codigo 0 sin archivo es un fallo
          // silencioso, que es justo lo que no debe darse por bueno.
          archivo: fs.existsSync(destino),
          bytes: fs.existsSync(destino) ? fs.statSync(destino).size : 0,
          stderr: conv.stderr.slice(0, 400) || null,
        };
        if (fs.existsSync(destino)) {
          entrada.formulas = await erroresDeFormula(destino);
        }

        const pdf = correrSoffice(soffice, dirs.perfil, "pdf", rutaXlsx, dirs.pdf);
        const destinoPdf = path.join(dirs.pdf, `${caso.id}.pdf`);
        const existePdf = fs.existsSync(destinoPdf);
        let paginas = 0;
        if (existePdf) {
          const bin = fs.readFileSync(destinoPdf);
          paginas = (bin.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
        }
        entrada.libreofficePdf = {
          code: pdf.code,
          ms: pdf.ms,
          archivo: existePdf,
          bytes: existePdf ? fs.statSync(destinoPdf).size : 0,
          paginas,
          stderr: pdf.stderr.slice(0, 400) || null,
        };
      }
    } catch (err) {
      entrada.generacion = { ok: false, ms: Date.now() - t0, error: String(err.message) };
    }
    manifiesto.push(entrada);
    // Un caso solo es "ok" si genero, la estructura esta limpia, LibreOffice
    // produjo los dos archivos y no quedo ninguna formula en error.
    const marca = !entrada.generacion.ok ? "FALLO-GENERACION"
      : entrada.estructura?.ok === false ? "FALLO-ESTRUCTURA"
        : entrada.libreofficeXlsx && !entrada.libreofficeXlsx.archivo ? "FALLO-LIBREOFFICE"
          : entrada.libreofficePdf && !entrada.libreofficePdf.archivo ? "FALLO-PDF"
            : (entrada.formulas?.total ?? 0) > 0 ? `FORMULAS(${entrada.formulas.total})`
              : "ok";
    entrada.veredicto = marca;
    const detalle = entrada.formulas?.ejemplos?.length
      ? ` -> ${entrada.formulas.ejemplos[0]}` : "";
    console.log(`  [${marca}] ${caso.id}${detalle}`);
  }

  const rutaManifiesto = path.join(salidaBase, "manifiesto.json");
  fs.writeFileSync(rutaManifiesto, JSON.stringify({
    generadoEn: new Date().toISOString(),
    libreoffice: soffice,
    casos: manifiesto,
  }, null, 2));
  console.log(`\nManifiesto: ${rutaManifiesto}`);
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
