// Hilo de trabajo de la generacion de Excel.
//
// La construccion del workbook (xlsx-populate + post-procesado OOXML) es CPU
// pura y sincrona: corriendola en el hilo principal, el servidor entero queda
// congelado mientras dura — nadie puede iniciar sesion ni consultar un job de
// IA hasta que el Excel termine. Aqui corre aislada y el event loop del
// servidor sigue atendiendo peticiones.
//
// El worker se crea por generacion y muere al terminar: asi el pico de
// memoria del workbook se devuelve al sistema en vez de quedar en el heap del
// proceso principal (importante en el contenedor de 512 MB).
import { parentPort, workerData } from "node:worker_threads";
import { generateArtifacts, generateCronbach } from "../../generator.js";

const run = async () => {
  const { kind, config } = workerData;
  return kind === "cronbach"
    ? generateCronbach(config)
    : generateArtifacts(config);
};

run().then(
  (result) => {
    parentPort.postMessage({ ok: true, result });
  },
  (err) => {
    // Solo viaja el mensaje: el objeto Error no sobrevive intacto al clonado
    // estructurado y el servidor solo necesita el texto para el usuario.
    parentPort.postMessage({
      ok: false,
      message: err?.message ?? "Error no controlado durante la generacion.",
    });
  },
);
