import type { AppSection, PasoTesis, Proyecto } from "./types";

// La ruta de una tesis, en el orden real en que se hace.
//
// Hasta ahora la app era un cajón de siete herramientas sueltas y cada quien
// adivinaba por dónde empezar. Esto las pone en orden: el proyecto recuerda qué
// pasos están hechos y la app puede decir cuál toca.
//
// El orden importa y NO es el del menú: primero se define qué se investiga
// (título, matriz), después con qué se mide (instrumento, confiabilidad), y al
// final qué salió (tabulación, descriptiva) y cómo se redacta.
export interface PasoRuta {
  id: PasoTesis;
  label: string;
  // Etiqueta para la franja de progreso, donde caben siete en una fila. Sin
  // esto, "Matriz de consistencia" sale como "Matriz de ...", que no dice nada.
  corto?: string;
  // Qué se lleva el usuario al terminarlo. Se muestra tal cual, así que dice
  // el resultado concreto, no el nombre de la herramienta otra vez.
  resultado: string;
  seccion: AppSection;
  // La ruta se puede saltar: no todas las tesis pasan por todos los pasos.
  opcional?: boolean;
}

export const RUTA: PasoRuta[] = [
  { id: "titulos", label: "Título", resultado: "Un título viable y verificado", seccion: "titulos" },
  { id: "matriz", label: "Matriz de consistencia", corto: "Matriz", resultado: "Problemas, objetivos, hipótesis y variables", seccion: "matriz" },
  { id: "instrumento", label: "Instrumento", resultado: "Dimensiones, indicadores, ítems y baremo", seccion: "proyectos" },
  { id: "confiabilidad", label: "Confiabilidad", resultado: "Alfa de Cronbach de tu instrumento", seccion: "confiabilidad" },
  { id: "tabulacion", label: "Tabulación", resultado: "El Excel con fórmulas, gráficos y correlación", seccion: "tabulacion" },
  { id: "descriptiva", label: "Descriptiva", resultado: "Lectura de frecuencias y porcentajes", seccion: "descriptiva", opcional: true },
  { id: "humanizador", label: "Redacción", resultado: "Tu texto con estilo natural", seccion: "humanizador", opcional: true },
];

export const hecho = (proyecto: Proyecto | null, paso: PasoTesis): boolean =>
  Boolean(proyecto?.progreso?.[paso]);

export const pasosHechos = (proyecto: Proyecto | null): number =>
  RUTA.filter((p) => hecho(proyecto, p.id)).length;

// El siguiente paso es el primero sin hacer. Los opcionales no bloquean: si
// alguien salta la descriptiva, la ruta sigue avanzando.
export const siguientePaso = (proyecto: Proyecto | null): PasoRuta | null =>
  RUTA.find((p) => !p.opcional && !hecho(proyecto, p.id))
  ?? RUTA.find((p) => !hecho(proyecto, p.id))
  ?? null;
