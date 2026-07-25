// Registro de cuentas eliminadas por su propio dueño.
//
// POR QUE EXISTE. Si borrar la cuenta fuera gratis e inmediato, cualquiera
// podria: gastar sus usos gratuitos -> borrar la cuenta -> volver a entrar con
// Google -> usos gratuitos otra vez. Usos gratis infinitos. Hoy el plan free
// no incluye herramientas de IA, asi que el fraude no cuesta dinero; en cuanto
// se regale algo que si cueste, si.
//
// QUE SE GUARDA. Solo un hash del correo y la fecha. Nunca el correo, ni el
// nombre, ni nada mas: es lo minimo para reconocer "esta cuenta ya recibio su
// cuota gratuita" sin conservar datos personales de alguien que pidio
// justamente que se los borraran. Pasado el periodo de espera, el registro se
// descarta solo.
import crypto from "crypto";
import { persistDeleted } from "./store/index.js";

// Cuanto tiempo una cuenta borrada no vuelve a recibir cuota gratuita.
export const COOLDOWN_DAYS = Number.parseInt(process.env.DELETED_ACCOUNT_COOLDOWN_DAYS ?? "30", 10);
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

let entries = [];

const hashEmail = (emailLower) => crypto
  .createHash("sha256")
  .update(String(emailLower ?? "").trim().toLowerCase())
  .digest("hex");

// Descarta lo que ya cumplio el periodo: el registro no crece sin limite y no
// se conserva mas de lo necesario.
const purge = () => {
  const limite = Date.now() - COOLDOWN_MS;
  const antes = entries.length;
  entries = entries.filter((item) => Date.parse(item.at) > limite);
  return entries.length !== antes;
};

export const initDeletedAccounts = (cargadas) => {
  entries = Array.isArray(cargadas) ? cargadas : [];
  if (purge()) persistDeleted(entries);
};

export const recordDeletedAccount = (emailLower) => {
  const emailHash = hashEmail(emailLower);
  entries = entries.filter((item) => item.emailHash !== emailHash);
  entries.push({ emailHash, at: new Date().toISOString() });
  purge();
  persistDeleted(entries);
};

// True si ese correo borro su cuenta hace poco: la cuenta se crea igual (nadie
// queda excluido del servicio), pero sin la cuota de cortesia.
export const wasRecentlyDeleted = (emailLower) => {
  purge();
  const emailHash = hashEmail(emailLower);
  return entries.some((item) => item.emailHash === emailHash);
};
