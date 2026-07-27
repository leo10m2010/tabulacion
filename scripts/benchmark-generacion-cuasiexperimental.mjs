// Mide el coste real de generar un Excel cuasiexperimental, para calibrar el
// presupuesto de complejidad de ese diseño (lib/presupuesto.js). Hermano de
// scripts/benchmark-generacion.mjs, que solo cubre el flujo correlacional.
//
// POR QUE EXISTE ESTE ARCHIVO POR SEPARADO
// El benchmark correlacional nunca corrio el generador cuasiexperimental
// (genera GE/GC Pretest, Postest, Consolidado y Comparaciones — hasta 5 hojas
// completas de N filas, 7 con seguimiento — en vez de 1-2), y la formula de
// costo especifica para ese diseño en lib/presupuesto.js se escribio sin
// medir nunca el generador real. El resultado, descubierto el 2026-07-26: el
// flujo cuasiexperimental generaba con configuraciones muy por debajo de sus
// limites individuales (muestra <= 2000, items <= 60) que agotaban la
// memoria del contenedor de 512 MB. Este script es lo que faltaba para
// calibrar esa formula con datos reales, igual que se hizo para el flujo
// correlacional.
//
// Uso (PowerShell, desde la raiz del repositorio):
//   $env:NODE_OPTIONS="--max-old-space-size=400"
//   node scripts/benchmark-generacion-cuasiexperimental.mjs
//
// Con el presupuesto YA calibrado (lib/presupuesto.js, "+40"), varios de los
// CASOS de abajo salen "error" (rechazados por evaluarPresupuesto ANTES de
// generar) en vez de "OOM": eso es lo esperado y lo que demuestra que el
// arreglo funciona. Para ver los picos de RSS reales que motivaron el "+40"
// (lo que pasaba SIN el rechazo), hay que llamar generateArtifacts saltandose
// la comprobacion de presupuesto, como hace el propio test de regresion en
// node_app/test/presupuesto.test.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");

// Rejilla elegida para encontrar el borde: nExp+nCon (participantes totales,
// repartidos por igual entre los dos grupos), items de la unica variable
// dependiente, y mediciones (2 = pretest/postest, 3 = con seguimiento).
const CASOS = [
  { n: 30, items: 12, mediciones: 2 },
  { n: 100, items: 10, mediciones: 2 },
  { n: 200, items: 60, mediciones: 2 },
  { n: 500, items: 20, mediciones: 2 },
  { n: 700, items: 15, mediciones: 2 },
  { n: 600, items: 20, mediciones: 2 },
  { n: 800, items: 10, mediciones: 2 },
  { n: 900, items: 10, mediciones: 2 },
  { n: 1000, items: 10, mediciones: 2 },
  { n: 1200, items: 10, mediciones: 2 },
  { n: 500, items: 60, mediciones: 2 },
  { n: 1500, items: 15, mediciones: 2 },
  { n: 100, items: 15, mediciones: 3 },
  { n: 200, items: 15, mediciones: 3 },
  { n: 600, items: 15, mediciones: 3 },
  { n: 1000, items: 15, mediciones: 3 },
];

// Guion que corre un unico caso y reporta tiempo y pico de memoria. Construye
// un config cuasiexperimental completo (formato flat del frontend) con una
// sola dimension/indicador para que el numero de items sea exactamente el
// pedido.
const GUION_HIJO = `
import { generateArtifacts } from ${JSON.stringify(pathToFileURL(path.join(RAIZ, "node_app", "generator.js")).href)};
const [, , n, items, mediciones] = process.argv;
const nExp = Math.round(Number(n) / 2);
const nCon = Number(n) - nExp;
const cfg = {
  diseno: "cuasiexperimental",
  titulo: "Bench cuasiexperimental",
  nExperimental: nExp,
  nControl: nCon,
  efectoIntervencion: "moderado",
  direccionEfecto: "mejora",
  cambioControl: 0,
  controlarResultados: true,
  alpha: 0.05,
  conDatos: "1",
  tema: "clasico",
  mediciones: Number(mediciones) || 2,
  variable: "1",
  item: String(items),
  respuesta: "5",
  nombre_respuesta: ["Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre"],
  nombre_escala: ["Bajo", "Medio", "Alto"],
  nombre_dimension: ["Dimension unica"],
  nombre_items_v1: Array.from({ length: Number(items) }, (_, i) => "Item " + (i + 1)),
  estructura_v1: [
    { nombre: "Dimension unica", indicadores: [{ nombre: "Indicador unico", items: Number(items) }] },
  ],
};
let pico = process.memoryUsage().rss;
const reloj = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 50);
const t0 = Date.now();
const r = await generateArtifacts(cfg);
clearInterval(reloj);
pico = Math.max(pico, process.memoryUsage().rss);
console.log(JSON.stringify({ ok: true, ms: Date.now() - t0, bytes: r.excelBuffer.length, picoRssMb: Math.round(pico / 1048576) }));
`;

const rutaGuion = path.join(os.tmpdir(), `tesistab-bench-cuasi-${process.pid}.mjs`);
fs.writeFileSync(rutaGuion, GUION_HIJO);

// El techo de heap de produccion (render.yaml: --max-old-space-size=400).
const HEAP_MB = process.env.BENCH_HEAP_MB ?? "400";

console.log(`Heap por proceso: ${HEAP_MB} MB (el de produccion)\n`);
console.log("n(total) items  medic  resultado    tiempo    picoRSS   archivo");
console.log("-".repeat(78));

const resultados = [];
for (const caso of CASOS) {
  const r = spawnSync(process.execPath, [rutaGuion, String(caso.n), String(caso.items), String(caso.mediciones)], {
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}` },
  });

  const salida = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  let dato = null;
  try { dato = JSON.parse(salida); } catch { dato = null; }

  const entrada = { ...caso };
  if (dato?.ok) {
    Object.assign(entrada, { resultado: "ok", ...dato });
  } else {
    const err = (r.stderr ?? "").trim();
    entrada.resultado = /heap limit|out of memory/i.test(err) ? "OOM"
      : r.signal ? `senal:${r.signal}`
        : /Error:/.test(err) ? "error" : "desconocido";
    entrada.detalle = err.split("\n").find((l) => /Error|FATAL/.test(l))?.slice(0, 90) ?? null;
  }
  resultados.push(entrada);

  console.log([
    String(caso.n).padEnd(10),
    String(caso.items).padEnd(6),
    String(caso.mediciones).padEnd(6),
    (entrada.resultado ?? "?").padEnd(12),
    (entrada.ms ? `${entrada.ms} ms` : "-").padEnd(9),
    (entrada.picoRssMb ? `${entrada.picoRssMb} MB` : "-").padEnd(9),
    entrada.bytes ? `${Math.round(entrada.bytes / 1024)} KB` : (entrada.detalle ?? ""),
  ].join(" "));
}

fs.unlinkSync(rutaGuion);
const destino = path.join(os.tmpdir(), "tesistab-benchmark-generacion-cuasiexperimental.json");
fs.writeFileSync(destino, JSON.stringify({ heapMb: Number(HEAP_MB), generadoEn: new Date().toISOString(), resultados }, null, 2));
console.log(`\nJSON: ${destino}`);
