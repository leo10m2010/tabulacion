import { eid } from "./helpers";
import type { DimensionDef, Instrumento, InstrumentoVariable } from "./types";

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
  const min = totalItems;
  const max = totalItems * opcionesEscala;
  const amplitud = Math.max(1, Math.ceil((max - min) / niveles));
  const nombres = niveles === 3
    ? ["Bajo", "Medio", "Alto"]
    : Array.from({ length: niveles }, (_, i) => `Nivel ${i + 1}`);

  const base = Math.floor(100 / niveles);
  const resto = 100 - base * niveles;

  return Array.from({ length: niveles }, (_, i) => ({
    nombre: nombres[i],
    desde: min + i * amplitud,
    // El último nivel cierra exactamente en el máximo posible: si no, quedarían
    // puntajes sin clasificar.
    hasta: i === niveles - 1 ? max : min + (i + 1) * amplitud - 1,
    // El sobrante se suma al primero para que el total sea 100 clavado.
    porcentaje: base + (i === 0 ? resto : 0),
  }));
};

export const instrumentoVacio = (): Instrumento => ({ escala: [], variables: [] });
