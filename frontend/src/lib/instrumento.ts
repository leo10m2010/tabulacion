import { calcBaremoIntervalos, eid } from "./helpers";
import type { DimensionDef, Instrumento, InstrumentoVariable, TabConfig } from "./types";

// Puente entre cómo se GUARDA el instrumento y cómo se EDITA.
//
// El proyecto guarda la forma canónica (sin identificadores): es la que viaja
// al servidor y la que leerán las herramientas. El editor de jerarquía que ya
// usa el asistente de tabulación necesita un `id` por fila para que React no
// pierda el foco al reordenar. Estas dos funciones traducen entre ambas, para
// poder reutilizar ese editor en vez de escribir un segundo.

export const aEditor = (variable: InstrumentoVariable | undefined): DimensionDef[] =>
  (variable?.dimensiones ?? []).map((d) => ({
    id: eid(),
    nombre: d.nombre,
    indicadores: (d.indicadores ?? []).map((ind) => ({
      id: eid(),
      nombre: ind.nombre,
      items: (ind.items ?? []).map((nombre) => ({ id: eid(), nombre })),
    })),
  }));

export const desdeEditor = (dims: DimensionDef[]) =>
  dims.map((d) => ({
    nombre: d.nombre,
    indicadores: d.indicadores.map((ind) => ({
      nombre: ind.nombre,
      items: ind.items.map((it) => it.nombre),
    })),
  }));

export const contarItems = (dims: DimensionDef[]) =>
  dims.reduce((total, d) => total + d.indicadores.reduce((s, i) => s + i.items.length, 0), 0);

// Baremo por defecto para una variable recién definida: niveles de igual
// amplitud sobre el rango posible (nº de ítems a nº de ítems × opciones) y el
// reparto de personas repartido a partes iguales.
//
// Se propone un punto de partida coherente en vez de dejarlo vacío: los
// porcentajes deben sumar 100 y los rangos cubrir todo el recorrido, y
// acertarlo a mano es justo donde la gente se equivoca.
export const baremoPorDefecto = (totalItems: number, opcionesEscala: number, niveles = 3) => {
  if (totalItems <= 0 || opcionesEscala <= 0 || niveles <= 0) return [];
  // Los rangos salen de la misma función que usa el asistente de tabulación:
  // dos implementaciones del mismo cálculo acabarían discrepando.
  const { desde, hasta } = calcBaremoIntervalos(totalItems, opcionesEscala, niveles);
  const nombres = niveles === 3
    ? ["Bajo", "Medio", "Alto"]
    : Array.from({ length: niveles }, (_, i) => `Nivel ${i + 1}`);

  const base = Math.floor(100 / niveles);
  const resto = 100 - base * niveles;

  return Array.from({ length: niveles }, (_, i) => ({
    nombre: nombres[i],
    desde: Number(desde[i]),
    hasta: Number(hasta[i]),
    // El sobrante se suma al primero para que el total sea 100 clavado.
    porcentaje: base + (i === 0 ? resto : 0),
  }));
};

export const instrumentoVacio = (): Instrumento => ({ escala: [], variables: [] });

// ¿Hay algo que traer? Un proyecto recién creado tiene el instrumento vacío, y
// ofrecer "traer del proyecto" cuando no hay nada que traer solo confunde.
export const tieneContenido = (inst: Instrumento | undefined): boolean =>
  Boolean(inst && inst.variables.some((v) => contarItems(aEditor(v)) > 0));

// ── Matriz de consistencia -> instrumento ───────────────────────────────────
// La matriz propone variables con sus dimensiones; el instrumento es eso más
// los indicadores y los ítems, que la matriz no produce y quedan por escribir.
//
// Se corta en dos variables: es el máximo que admiten tanto el instrumento
// como el generador de tabulación.
export const matrizAInstrumento = (
  variables: { nombre: string; dimensiones: string[] }[],
  escala: string[],
): Instrumento => ({
  escala,
  variables: variables.slice(0, 2).map((v) => ({
    nombre: v.nombre,
    dimensiones: v.dimensiones.map((d) => ({ nombre: d, indicadores: [] })),
    baremo: [],
  })),
});

// ── Instrumento -> asistente de tabulación ──────────────────────────────────
// Traduce el instrumento del proyecto a las claves que espera el asistente.
// Solo toca lo que el instrumento define: la muestra, el tema, el control de
// correlación y demás preferencias del usuario se quedan como estaban.
//
// Devuelve también las estructuras con id porque el asistente las guarda
// aparte (de ellas deriva indicadores, ítems y conteos por dimensión).
export const instrumentoATabConfig = (
  inst: Instrumento,
  base: TabConfig,
): { config: TabConfig; estructuraV1: DimensionDef[]; estructuraV2: DimensionDef[] } => {
  const vars = inst.variables;
  const estructuraV1 = aEditor(vars[0]);
  const estructuraV2 = aEditor(vars[1]);
  const config: TabConfig = { ...base };

  config.variable = String(Math.max(1, vars.length));
  config.nombre_dimension = vars.map((v) => v.nombre);
  config.numero_dimension = vars.map((_, i) => String(i + 1));

  if (inst.escala.length > 0) {
    config.respuesta = String(inst.escala.length);
    config.nombre_respuesta = [...inst.escala];
  }

  // Las claves del baremo llevan sufijo "_v2" en la segunda variable; el resto
  // del asistente ya trabaja así.
  const aplicarVariable = (v: InstrumentoVariable | undefined, dims: DimensionDef[], sufijo: "" | "_v2") => {
    if (!v) return;
    const items = contarItems(dims);
    if (items > 0) config[sufijo ? "itemv2" : "item"] = String(items);
    config[sufijo ? "dimensiones_v2" : "dimensiones"] = String(dims.length);

    // Sin baremo guardado no se inventa uno: se deja el que ya tuviera el
    // asistente y el usuario lo recalcula ahí, que es donde está el botón.
    const baremo = v.baremo ?? [];
    if (baremo.length === 0) return;
    config[`escala${sufijo}`] = String(baremo.length);
    config[`nombre_escala${sufijo}`] = baremo.map((n) => n.nombre);
    config[`desde${sufijo}`] = baremo.map((n) => String(n.desde));
    config[`hasta${sufijo}`] = baremo.map((n) => String(n.hasta));
    config[`porcentaje${sufijo}`] = baremo.map((n) => String(n.porcentaje));
  };

  aplicarVariable(vars[0], estructuraV1, "");
  aplicarVariable(vars[1], estructuraV2, "_v2");

  return { config, estructuraV1, estructuraV2 };
};
