// Lanza la generacion del Excel en un hilo aparte (ver worker.js) y devuelve
// el mismo objeto que devolverian generateArtifacts/generateCronbach.
//
// Ademas de aislar la CPU, este modulo pone un limite de generaciones
// simultaneas: cada worker tiene su propio heap, asi que N workers a la vez
// multiplican la memoria del contenedor. Por defecto se permite UNA a la vez
// (mismo perfil de memoria que antes de mover la generacion a un worker), y
// las siguientes esperan en cola en vez de bloquear el servidor.
import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js");

const MAX_CONCURRENT = Math.max(1, Number.parseInt(process.env.GENERATION_MAX_CONCURRENT ?? "1", 10));
// Cola de espera acotada: sin tope, una rafaga dejaria peticiones colgadas
// minutos hasta que el cliente se rinda. Al llenarse se responde 429.
const MAX_QUEUED = Math.max(0, Number.parseInt(process.env.GENERATION_MAX_QUEUED ?? "8", 10));
const TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.GENERATION_TIMEOUT_MS ?? "300000", 10));

// Techo de heap del worker. Por defecto NO se fija ninguno: el worker hereda
// el presupuesto del proceso (NODE_OPTIONS), que es exactamente el que tenia
// la generacion cuando corria en el hilo principal.
//
// Medido: fijar `maxOldGenerationSizeMb` explicitamente resulta CONTRAPRODUCENTE
// — con un techo de 256 MB una muestra de 600 se quedaba sin memoria, mientras
// que sin techo (mismo proceso de 400 MB) pasaba sin problema. Node aplica
// defaults restrictivos al resto de limites en cuanto se especifica uno solo.
// Solo se aplica si se configura a proposito.
const HEAP_MB_RAW = Number.parseInt(process.env.GENERATION_WORKER_HEAP_MB ?? "", 10);
const RESOURCE_LIMITS = Number.isFinite(HEAP_MB_RAW) && HEAP_MB_RAW > 0
  ? { maxOldGenerationSizeMb: HEAP_MB_RAW }
  : undefined;

export class GenerationBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "GenerationBusyError";
  }
}

// ── Semaforo ────────────────────────────────────────────────────────────────
let running = 0;
const queue = [];

const acquire = () => new Promise((resolve, reject) => {
  if (running < MAX_CONCURRENT) {
    running += 1;
    resolve();
    return;
  }
  if (queue.length >= MAX_QUEUED) {
    reject(new GenerationBusyError(
      "El servidor esta generando otros archivos en este momento; intenta de nuevo en un minuto.",
    ));
    return;
  }
  queue.push(resolve);
});

const release = () => {
  const next = queue.shift();
  if (next) {
    // El cupo pasa directo al siguiente en la cola: `running` no baja.
    next();
    return;
  }
  running = Math.max(0, running - 1);
};

// ── Ejecucion en el worker ──────────────────────────────────────────────────

// Un Buffer que cruza el limite del worker llega como Uint8Array (el clonado
// estructurado no conserva la subclase). Si no se re-envuelve,
// `.toString("base64")` devuelve "104,111,108,97,..." en vez de base64 y el
// usuario descarga un archivo corrupto SIN ningun error visible.
const toBuffer = (value) => (
  Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength)
);

// Quedarse sin memoria es, casi siempre, una muestra demasiado grande para el
// presupuesto del contenedor. El mensaje crudo de V8 no le sirve a nadie.
const traducirError = (mensaje) => (
  /memory limit|heap out of memory/i.test(mensaje)
    ? "La configuracion es demasiado grande para la memoria del servidor. "
      + "Reduce el numero de encuestados o de items e intenta de nuevo."
    : mensaje
);

const runInWorker = (kind, config) => new Promise((resolve, reject) => {
  const worker = new Worker(WORKER_PATH, {
    workerData: { kind, config },
    ...(RESOURCE_LIMITS ? { resourceLimits: RESOURCE_LIMITS } : {}),
  });

  let settled = false;
  const settle = (fn, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker.terminate().catch(() => {});
    fn(value);
  };

  const timer = setTimeout(() => {
    settle(reject, new Error("La generacion supero el tiempo limite y fue cancelada."));
  }, TIMEOUT_MS);

  worker.on("message", (msg) => {
    if (msg?.ok) {
      const result = msg.result;
      result.excelBuffer = toBuffer(result.excelBuffer);
      settle(resolve, result);
    } else {
      settle(reject, new Error(traducirError(msg?.message ?? "Error no controlado durante la generacion.")));
    }
  });
  // Un worker que se queda sin heap no llega a responder: muere aqui.
  worker.on("error", (err) => settle(reject, new Error(traducirError(err?.message ?? String(err)))));
  // Un worker que muere sin responder (p. ej. se quedo sin heap) no debe
  // dejar la peticion colgada para siempre.
  worker.on("exit", (code) => {
    settle(reject, new Error(`El generador termino inesperadamente (codigo ${code}).`));
  });
});

// `kind`: "artifacts" (tabulacion) | "cronbach" (confiabilidad).
export const runGeneration = async (kind, config) => {
  await acquire();
  try {
    return await runInWorker(kind, config);
  } finally {
    release();
  }
};
