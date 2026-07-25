// Usos consumidos por un job de IA que todavia no termino.
//
// El problema que resuelve: los jobs viven solo en memoria. El uso se
// descuenta al crear el job y se devuelve en el `.catch` si la generacion
// falla — pero si el proceso se reinicia a mitad del job (deploy, suspension
// del hosting, OOM), ese `.catch` nunca corre: el usuario perdio el uso y no
// recibio nada.
//
// Aqui se anota cada uso descontado por un job en curso. Al arrancar, el
// servidor devuelve los que quedaron huerfanos.
//
// La anotacion se persiste por el store (lib/store): en Postgres, porque en el
// disco efimero del plan gratis se borraba junto con los usuarios y esta red
// de seguridad no llegaba a servir de nada.
//
// Los archivos de resultado NO se persisten (son megas de Excel en memoria):
// tras un reinicio el trabajo se pierde igual, pero el usuario recupera su uso
// y puede volver a intentarlo.
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
