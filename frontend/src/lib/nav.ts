import type { LucideIcon } from "lucide-react";
import { Feather, FileSpreadsheet, KeyRound, Lightbulb, ShieldCheck, Table2, Wand2 } from "lucide-react";
import type { AppSection } from "./types";

// Fuente única de verdad de las herramientas: la consumen la sidebar, los tabs
// móviles, el dashboard de inicio y el marquee de la landing.
export type NavTool = {
  id: AppSection;
  label: string;
  mobileLabel?: string;
  icon: LucideIcon;
  description: string;
};

export type NavGroup = {
  id: string;
  label: string;
  tools: NavTool[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "estadistica",
    label: "Estadística",
    tools: [
      {
        id: "tabulacion",
        label: "Tabulación",
        icon: FileSpreadsheet,
        description: "Genera el Excel de tu tesis con fórmulas reales, gráficos e interpretaciones.",
      },
      {
        id: "descriptiva",
        label: "Descriptiva",
        mobileLabel: "IA",
        icon: Wand2,
        description: "Tabulación descriptiva con IA: frecuencias, porcentajes y lectura de resultados.",
      },
      {
        id: "confiabilidad",
        label: "Confiabilidad",
        mobileLabel: "Alfa",
        icon: ShieldCheck,
        description: "Valida tu instrumento con Alfa de Cronbach y reporta la confiabilidad.",
      },
    ],
  },
  {
    id: "redaccion",
    label: "Redacción IA",
    tools: [
      {
        id: "titulos",
        label: "Generador de Títulos",
        mobileLabel: "Títulos",
        icon: Lightbulb,
        description: "Propone títulos de tesis originales verificados con búsqueda web.",
      },
      {
        id: "matriz",
        label: "Matriz de Consistencia",
        mobileLabel: "Matriz",
        icon: Table2,
        description: "Arma tu matriz de consistencia completa y descárgala en Word apaisado.",
      },
      {
        id: "humanizador",
        label: "Humanizador",
        mobileLabel: "Humanizar",
        icon: Feather,
        description: "Reescribe texto académico con estilo natural sin perder citas ni fuentes.",
      },
    ],
  },
  {
    id: "recoleccion",
    label: "Recolección",
    tools: [
      {
        id: "forms",
        label: "Forms",
        icon: KeyRound,
        description: "Rellena tus Google Forms automáticamente con la extensión Tutorica Forms.",
      },
    ],
  },
];

// Lista plana para consumidores que no agrupan (tabs móviles, marquee).
export const NAV_TOOLS: NavTool[] = NAV_GROUPS.flatMap((group) => group.tools);
