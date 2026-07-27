// Mide el coste real (tiempo + pico de RSS) del trabajo que las 4 rutas de
// IA (Descriptiva, Titulos, Matriz, Humanizador) hacen DESPUES de recibir la
// respuesta de OpenRouter: parseo, calculo y construccion del .xlsx/.docx.
// No mide la llamada de red en si (esa la gobierna OPENROUTER_TIMEOUT_MS,
// ver lib/*/openrouter.js) sino el trabajo que corre en el mismo proceso que
// el servidor HTTP (ninguna de estas 4 rutas usa el worker aislado de
// lib/generation/, a diferencia de /generate y /cronbach).
//
// Uso (PowerShell, desde la raiz del repositorio):
//   $env:NODE_OPTIONS="--max-old-space-size=400"
//   node scripts/benchmark-ia.mjs
//
// El caso de Descriptiva corre en un PROCESO HIJO con el mismo heap que
// produccion (mismo patron que scripts/benchmark-generacion.mjs). Los otros
// tres (Titulos/Matriz/Humanizador) solo arman un .docx de texto -- se miden
// en el proceso principal porque su costo es ordenes de magnitud menor.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const NODE_APP = path.join(RAIZ, "node_app");

const HEAP_MB = process.env.BENCH_HEAP_MB ?? "400";

// ── 1) Descriptiva: construccion del Excel a partir de un JSON de IA ya
// validado (N=400 es el maximo real de la ruta; 60 items ordinales Likert es
// un cuestionario largo para una tesis real). Corre en un hijo con heap de
// produccion porque construye un workbook xlsx-populate + graficos OOXML,
// igual que /generate.
const GUION_DESCRIPTIVA = `
import { detectLikertBaremo, computeLikertPuntajes, organicizeRows } from ${JSON.stringify(pathToFileURL(path.join(NODE_APP, "lib", "descriptiva", "compute.js")).href)};
import { buildDescriptivaWorkbook } from ${JSON.stringify(pathToFileURL(path.join(NODE_APP, "lib", "descriptiva", "workbook.js")).href)};
import { postProcessWorkbook } from ${JSON.stringify(pathToFileURL(path.join(NODE_APP, "lib", "ooxml.js")).href)};
import { CHART_THEMES } from ${JSON.stringify(pathToFileURL(path.join(NODE_APP, "lib", "config.js")).href)};

const [, , nStr, itemsStr] = process.argv;
const N = Number(nStr);
const ITEMS = Number(itemsStr);
const ESCALA = ["Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre"];

const preguntas = Array.from({ length: ITEMS }, (_, i) => ({
  id: \`P\${i + 1}\`,
  tipo: "ordinal_unica",
  texto: \`Pregunta de prueba numero \${i + 1} del instrumento simulado para el benchmark de rendimiento\`,
  opciones: ESCALA,
}));

const datos_simulados = Array.from({ length: N }, () => {
  const row = {};
  for (const p of preguntas) row[p.id] = ESCALA[Math.floor(Math.random() * ESCALA.length)];
  return row;
});

const data = {
  metadata: { titulo_estudio: "Estudio de prueba (benchmark)", tipo_instrumento: "independiente", n_encuestados: N },
  preguntas,
  datos_simulados,
  baremo: null,
};

let pico = process.memoryUsage().rss;
const reloj = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 50);
const t0 = Date.now();

organicizeRows(data);
const baremoLikert = detectLikertBaremo(data);
const computed = baremoLikert ? computeLikertPuntajes(baremoLikert, data.datos_simulados) : null;
const { workbook, sheetCharts } = await buildDescriptivaWorkbook(data, computed, baremoLikert);
const plainBuffer = await workbook.outputAsync({ type: "nodebuffer" });
const excelBuffer = await postProcessWorkbook(plainBuffer, sheetCharts, CHART_THEMES.clasico.colores);

clearInterval(reloj);
pico = Math.max(pico, process.memoryUsage().rss);
console.log(JSON.stringify({
  ok: true, ms: Date.now() - t0, bytes: excelBuffer.length, picoRssMb: Math.round(pico / 1048576),
  baremoDetectado: Boolean(baremoLikert),
}));
`;

const CASOS_DESCRIPTIVA = [
  { n: 400, items: 40 },
  { n: 400, items: 40 },
  { n: 400, items: 45 },
  { n: 400, items: 50 },
  { n: 400, items: 55 },
  { n: 400, items: 60 },
  { n: 400, items: 60 },
];

const rutaGuionDescriptiva = path.join(os.tmpdir(), `tesistab-bench-ia-descriptiva-${process.pid}.mjs`);
fs.writeFileSync(rutaGuionDescriptiva, GUION_DESCRIPTIVA);

console.log(`Heap por proceso: ${HEAP_MB} MB (el de produccion, --max-old-space-size)\n`);
console.log("── Descriptiva (build del .xlsx a partir del JSON ya validado; sin llamada de red) ──");
console.log("N      items  resultado   tiempo    picoRSS   archivo    baremoLikert");
console.log("-".repeat(78));

for (const caso of CASOS_DESCRIPTIVA) {
  const r = spawnSync(process.execPath, [rutaGuionDescriptiva, String(caso.n), String(caso.items)], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}` },
    cwd: NODE_APP,
  });
  const salida = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  let dato = null;
  try { dato = JSON.parse(salida); } catch { dato = null; }
  if (dato?.ok) {
    const kb = Math.round(dato.bytes / 1024);
    console.log(
      `${String(caso.n).padEnd(6)} ${String(caso.items).padEnd(6)} ${"ok".padEnd(11)} `
      + `${(dato.ms + " ms").padEnd(9)} ${(dato.picoRssMb + " MB").padEnd(9)} ${(kb + " KB").padEnd(10)} ${dato.baremoDetectado}`,
    );
  } else {
    const err = (r.stderr ?? "").trim();
    const resultado = /heap limit|out of memory/i.test(err) ? "OOM" : r.signal ? `senal:${r.signal}` : "error";
    console.log(`${String(caso.n).padEnd(6)} ${String(caso.items).padEnd(6)} ${resultado}`);
    if (resultado === "error") console.log(`  stderr: ${err.slice(0, 300)}`);
  }
}
fs.rmSync(rutaGuionDescriptiva, { force: true });

// ── 2) Titulos / Matriz / Humanizador: construccion del .docx a partir de
// contenido ya generado (sin llamada de red). Estas 3 rutas solo formatean
// texto/tablas con la libreria "docx" -- no hay formulas ni post-procesado
// OOXML, asi que se miden en el proceso principal (nada que aislar).
console.log("\n── Titulos / Matriz / Humanizador (build del .docx; sin llamada de red) ──");

const { buildTitulosDocx } = await import(pathToFileURL(path.join(NODE_APP, "lib", "titulos", "docx.js")).href);
const { buildMatrizDocx } = await import(pathToFileURL(path.join(NODE_APP, "lib", "matriz", "docx.js")).href);
const { buildHumanizadorDocx } = await import(pathToFileURL(path.join(NODE_APP, "lib", "humanizador", "docx.js")).href);

const medir = async (label, fn) => {
  if (global.gc) global.gc();
  const antes = process.memoryUsage().rss;
  const t0 = Date.now();
  const buffer = await fn();
  const ms = Date.now() - t0;
  const despues = process.memoryUsage().rss;
  console.log(
    `${label.padEnd(14)} tiempo: ${String(ms).padStart(4)} ms   `
    + `bytes: ${String(buffer.length).padStart(7)}   `
    + `RSS antes/despues: ${Math.round(antes / 1048576)} MB -> ${Math.round(despues / 1048576)} MB`,
  );
};

// Contenido realista: 3 titulos desarrollados (plantilla real ronda 800-1200
// palabras cada uno con antecedentes + referencias APA).
const TITULO_BLOQUE = `**TÍTULO 1**\n\nGestión del talento humano y desempeño laboral en una entidad ` + "publica de prueba. ".repeat(150) + "\n\nAntecedentes: " + "Perez (2022) encontro una relacion significativa. ".repeat(80) + "\n\nReferencias:\n" + Array.from({ length: 10 }, (_, i) => `Autor${i} (202${i % 9}). Titulo de referencia ${i}. Universidad de prueba. https://repositorio-prueba.edu.pe/tesis/${i}`).join("\n");
const CONTENIDO_TITULOS = [1, 2, 3].map((i) => TITULO_BLOQUE.replace("TÍTULO 1", `TÍTULO ${i}`)).join("\n\n---\n\n");

await medir("titulos", () => buildTitulosDocx({
  contenido: CONTENIDO_TITULOS,
  input: {
    universidad: "Universidad de Prueba", carrera: "Administracion", lugar: "Lima, Peru", numeroVariables: "2", anio: "2026",
  },
}));

const matrizEjemplo = {
  titulo: "Gestion del talento humano y desempeno laboral en una entidad publica de prueba",
  problema: { general: "¿Cual es la relacion...?", especificos: ["¿Cual es la relacion con la dimension 1?", "¿Cual es la relacion con la dimension 2?", "¿Cual es la relacion con la dimension 3?"] },
  objetivos: { general: "Determinar la relacion...", especificos: ["Determinar la relacion con la dimension 1.", "Determinar la relacion con la dimension 2.", "Determinar la relacion con la dimension 3."] },
  hipotesis: { general: "Existe relacion significativa...", nula: "No existe relacion significativa...", especificas: ["Existe relacion con la dimension 1.", "Existe relacion con la dimension 2."] },
  variables: [1, 2].map((v) => ({
    nombre: `Variable ${v}`,
    rol: v === 1 ? "independiente" : "dependiente",
    dimensiones: ["Dimension 1", "Dimension 2", "Dimension 3", "Dimension 4"],
    autor: "Autor de referencia (2020)",
    fuente: "https://repositorio-prueba.edu.pe/tesis/dimensiones",
  })),
  metodologia: {
    tipo: "Aplicada", enfoque: "Cuantitativo", nivel: "Correlacional", diseno: "No experimental",
    poblacion: "120 trabajadores", muestra: "92 trabajadores", muestreo: "Probabilistico", tecnica: "Encuesta", instrumento: "Cuestionario",
  },
};
await medir("matriz", () => buildMatrizDocx({ matriz: matrizEjemplo }));

// Humanizador: texto en el limite MAX_PALABRAS=3000 (peor caso de esta ruta).
const TEXTO_HUMANIZADO = Array.from({ length: 30 }, (_, i) => `Parrafo ${i + 1}: ` + "contenido de prueba con palabras variadas para simular un capitulo de tesis ya reescrito. ".repeat(6)).join("\n\n");
await medir("humanizador", () => buildHumanizadorDocx({ texto: TEXTO_HUMANIZADO }));
