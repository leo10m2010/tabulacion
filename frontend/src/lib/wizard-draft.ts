import type { DimensionDef, TabConfig, WizardStep } from "./types";

// Borrador del asistente de tabulación.
//
// El asistente guardaba toda su configuración en memoria y la sección se
// desmonta al cambiar de herramienta: quien llenaba un instrumento de 40 ítems
// y pasaba un momento por "Mis proyectos" volvía a un formulario en blanco. Una
// recarga del navegador tenía el mismo efecto. Esto lo persiste en el navegador
// para que el trabajo sobreviva a ambas cosas.
//
// Solo se guarda lo que el usuario escribió (configuración, estructura y en qué
// paso iba). El resultado, los enlaces de descarga y los mensajes de estado son
// de un proceso concreto y no tienen sentido restaurados.

export interface WizardDraft {
  version: number;
  guardadoEn: string;
  wizardStep: WizardStep;
  config: TabConfig;
  estructuraV1: DimensionDef[];
  estructuraV2: DimensionDef[];
}

// Subir la versión invalida los borradores viejos. Es la salida limpia si algún
// día cambia la forma de `TabConfig`: es preferible que el usuario empiece de
// cero a que el asistente cargue algo que ya no sabe interpretar.
const VERSION = 1;
const PREFIJO = "tabulacion:borrador:";

// Un borrador por cuenta. En un equipo compartido —una sala de cómputo de la
// universidad es el caso normal— el instrumento de una persona no debe
// aparecerle a la siguiente que entre con otra cuenta.
export const draftKey = (email: string | undefined | null): string =>
  `${PREFIJO}${(email ?? "anonimo").trim().toLowerCase()}`;

// El borrador es un dato de comodidad: si el navegador no deja escribir (modo
// privado, cuota llena, almacenamiento bloqueado) se pierde el borrador, no la
// sesión de trabajo. Por eso todo va con captura de error y sin propagar.
export function guardarBorrador(email: string | undefined | null, draft: Omit<WizardDraft, "version" | "guardadoEn">): boolean {
  try {
    const payload: WizardDraft = { ...draft, version: VERSION, guardadoEn: new Date().toISOString() };
    localStorage.setItem(draftKey(email), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function leerBorrador(email: string | undefined | null): WizardDraft | null {
  try {
    const crudo = localStorage.getItem(draftKey(email));
    if (!crudo) return null;
    const data = JSON.parse(crudo) as unknown;
    if (!esBorradorValido(data)) {
      // Un borrador ilegible es basura, no un error que mostrar: se descarta.
      localStorage.removeItem(draftKey(email));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function borrarBorrador(email: string | undefined | null): void {
  try {
    localStorage.removeItem(draftKey(email));
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}

// Al cerrar sesión no basta con que la clave lleve el correo: el instrumento
// sigue en el disco del navegador. Se limpian todos los borradores.
export function borrarTodosLosBorradores(): void {
  try {
    const claves: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIJO)) claves.push(k);
    }
    claves.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}

// ¿Hay trabajo del usuario que merezca guardarse?
//
// La pregunta correcta no es "¿hay contenido?" sino "¿cambió algo respecto a
// como arrancó el asistente?". El asistente parte de una configuración de
// EJEMPLO ya rellena (dimensiones, ítems, baremo), así que medir "hay
// contenido" daba verdadero desde el primer render: bastaba abrir la sección y
// salir para dejar un borrador, y al volver la app anunciaba "recuperamos lo
// que habías avanzado" sin que el usuario hubiera tocado nada.
//
// Se compara contra la configuración con la que arrancó esta sesión. Construir
// estructura jerárquica siempre cuenta: empieza vacía y solo la crea el usuario.
export function hayCambios(
  config: TabConfig,
  estructuraV1: DimensionDef[],
  estructuraV2: DimensionDef[],
  configInicial: TabConfig,
): boolean {
  if (estructuraV1.length > 0 || estructuraV2.length > 0) return true;
  return JSON.stringify(config) !== JSON.stringify(configInicial);
}

function esBorradorValido(data: unknown): data is WizardDraft {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Partial<WizardDraft>;
  if (d.version !== VERSION) return false;
  if (d.wizardStep !== 1 && d.wizardStep !== 2 && d.wizardStep !== 3) return false;
  if (typeof d.config !== "object" || d.config === null || Array.isArray(d.config)) return false;
  if (!Array.isArray(d.estructuraV1) || !Array.isArray(d.estructuraV2)) return false;
  if (typeof d.guardadoEn !== "string") return false;
  return true;
}
