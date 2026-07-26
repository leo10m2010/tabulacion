// Mide el coste real de generar un Excel para calibrar el presupuesto de
// complejidad. Se ejecuta con el mismo techo de heap que produccion.
//
// Uso (PowerShell, desde la raiz del repositorio):
//   $env:NODE_OPTIONS="--max-old-space-size=400"
//   node scripts/benchmark-generacion.mjs
//
// Cada caso corre en un PROCESO HIJO propio: si agota la memoria, muere el
// hijo y el benchmark sigue con el siguiente en vez de perderse entero. Es
// tambien lo que hace produccion, donde la generacion vive en un worker.
//
// Salida: tabla por consola + JSON en el directorio temporal del sistema.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");

// Rejilla elegida para encontrar el borde, no para cubrirlo todo: combina N
// bajo con muchos items y N alto con pocos, que es donde los datos previos no
// encajaban en un modelo lineal.
const CASOS = [
  { n: 30, itemsV1: 9, itemsV2: 6 },
  { n: 60, itemsV1: 9, itemsV2: 6 },
  { n: 289, itemsV1: 18, itemsV2: 9 },
  { n: 60, itemsV1: 60, itemsV2: 60 },
  { n: 200, itemsV1: 60, itemsV2: 60 },
  { n: 300, itemsV1: 30, itemsV2: 30 },
  { n: 300, itemsV1: 60, itemsV2: 60 },
  { n: 500, itemsV1: 20, itemsV2: 20 },
  { n: 500, itemsV1: 60, itemsV2: 60 },
  { n: 800, itemsV1: 18, itemsV2: 9 },
  { n: 1000, itemsV1: 9, itemsV2: 6 },
  { n: 1200, itemsV1: 9, itemsV2: 6 },
  { n: 1500, itemsV1: 9, itemsV2: 6 },
  { n: 2000, itemsV1: 9, itemsV2: 6 },
  { n: 2000, itemsV1: 60, itemsV2: 60 },
  // Una sola variable: menos hojas y sin correlacion.
  { n: 1000, itemsV1: 18, itemsV2: 0 },
  { n: 2000, itemsV1: 18, itemsV2: 0 },
];

// Guion que corre un unico caso y reporta tiempo y pico de memoria.
const GUION_HIJO = `
import fs from "node:fs";
import { DEFAULT_CONFIG_PATH, generateArtifacts } from ${JSON.stringify(pathToFileURL(path.join(RAIZ, "node_app", "generator.js")).href)};
const [, , n, i1, i2] = process.argv;
const base = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
const cfg = { ...base, muestra: n, item: i1, itemv2: i2 };
if (Number(i2) === 0) cfg.variable = "1";
// La estructura plana manda: se limpian las jerarquicas del ejemplo para que
// el numero de items sea exactamente el pedido.
delete cfg.estructura_v1; delete cfg.estructura_v2;
cfg.nombre_dims_v1 = ["Dimension 1"]; cfg.items_por_dim_v1 = [String(i1)];
cfg.nombre_indicador = Number(i2) > 0 ? ["Ind V1", "Ind V2"] : ["Ind V1"];
cfg.numero_indicador0 = Number(i2) > 0 ? ["1", "1"] : ["1"];
if (Number(i2) > 0) { cfg.nombre_dims_v2 = ["Dimension 1"]; cfg.items_por_dim_v2 = [String(i2)]; }
let pico = process.memoryUsage().rss;
const reloj = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 50);
const t0 = Date.now();
const r = await generateArtifacts(cfg);
clearInterval(reloj);
pico = Math.max(pico, process.memoryUsage().rss);
console.log(JSON.stringify({ ok: true, ms: Date.now() - t0, bytes: r.excelBuffer.length, picoRssMb: Math.round(pico / 1048576) }));
`;

const rutaGuion = path.join(os.tmpdir(), `tesistab-bench-${process.pid}.mjs`);
fs.writeFileSync(rutaGuion, GUION_HIJO);

// El techo de heap de produccion (render.yaml: --max-old-space-size=400).
const HEAP_MB = process.env.BENCH_HEAP_MB ?? "400";

console.log(`Heap por proceso: ${HEAP_MB} MB (el de produccion)\n`);
console.log("N      itemsV1 itemsV2  celdas    resultado    tiempo    picoRSS   archivo");
console.log("-".repeat(78));

const resultados = [];
for (const caso of CASOS) {
  const r = spawnSync(process.execPath, [rutaGuion, String(caso.n), String(caso.itemsV1), String(caso.itemsV2)], {
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}` },
  });

  const salida = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  let dato = null;
  try { dato = JSON.parse(salida); } catch { dato = null; }

  const celdas = caso.n * (caso.itemsV1 + caso.itemsV2);
  const entrada = { ...caso, celdas };
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
    String(caso.n).padEnd(6),
    String(caso.itemsV1).padEnd(7),
    String(caso.itemsV2).padEnd(8),
    String(celdas).padEnd(9),
    (entrada.resultado ?? "?").padEnd(12),
    (entrada.ms ? `${entrada.ms} ms` : "-").padEnd(9),
    (entrada.picoRssMb ? `${entrada.picoRssMb} MB` : "-").padEnd(9),
    entrada.bytes ? `${Math.round(entrada.bytes / 1024)} KB` : (entrada.detalle ?? ""),
  ].join(" "));
}

fs.unlinkSync(rutaGuion);
const destino = path.join(os.tmpdir(), "tesistab-benchmark-generacion.json");
fs.writeFileSync(destino, JSON.stringify({ heapMb: Number(HEAP_MB), generadoEn: new Date().toISOString(), resultados }, null, 2));
console.log(`\nJSON: ${destino}`);
