// Usos consumidos por un job de IA que todavia no termino.
//
// Los jobs ya tienen estado durable, pero la ejecucion inline puede morir
// entre el descuento y la finalizacion (deploy, suspension u OOM). Esta marca
// enlaza el movimiento de saldo con el job para reconciliarlo al arrancar.
//
// Aqui se anota cada uso descontado por un job en curso. Al arrancar, el
// servidor devuelve los que quedaron huerfanos.
//
// La anotacion se persiste por el store (lib/store): en Postgres, porque en el
// disco efimero del plan gratis se borraba junto con los usuarios y esta red
// de seguridad no llegaba a servir de nada.
//
// Los archivos terminados viven en R2. Un trabajo interrumpido se marca como
// fallido, libera el gate global y devuelve su uso de forma idempotente.
import { persistPending } from "./store/index.js";

let entries = [];

// Recibe lo que el store cargo al arrancar.
export const initPendingUses = (cargadas) => {
  entries = Array.isArray(cargadas) ? cargadas : [];
};

export const addPendingUse = (jobId, userId, tool) => {
  entries.push({ jobId, userId, tool, at: new Date().toISOString() });
  persistPending(entries);
};

export const clearPendingUse = (jobId) => {
  const antes = entries.length;
  entries = entries.filter((item) => item.jobId !== jobId);
  if (entries.length !== antes) persistPending(entries);
};

// Devuelve los usos huerfanos y vacia el registro ANTES de reembolsar.
//
// El orden importa: si el proceso muriera entre el vaciado y el reembolso, el
// usuario pierde el uso (exactamente lo que pasaba antes de este modulo). Al
// reves, un reinicio en el mismo punto le regalaria usos en cada arranque.
export const drainPendingUses = () => {
  const pendientes = entries;
  entries = [];
  if (pendientes.length > 0) persistPending(entries);
  return pendientes;
};
