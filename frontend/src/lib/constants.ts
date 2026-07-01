import type { TabConfig } from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────
// En produccion apunta a la API de Render por defecto; VITE_API_BASE_URL
// (variable de entorno del proyecto en Vercel) tiene prioridad si se define.
export const DEFAULT_API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL
    ?? (import.meta.env.PROD ? "https://tabulacion-api.onrender.com" : "http://localhost:8080"),
).replace(/\/$/, "");

// Tutorica Forms corre en el mismo backend que la API de tabulación; la
// extensión de Chrome usa esta URL con la clave de API del usuario.
export const FORMS_BACKEND_URL = DEFAULT_API_BASE_URL;

export const FALLBACK_CONFIG: TabConfig = {
  muestra: "289",
  item: "18",
  itemv2: "9",
  variable: "2",
  nommuestra: "Beneficiarios",
  dimensiones: "3",
  dimensiones_v2: "3",
  escala: "3",
  escala_v2: "3",
  respuesta: "5",
  relacionversa: "0",
  nombre_escala: ["Bajo", "Medio", "Alto"],
  nombre_escala_v2: ["Bajo", "Medio", "Alto"],
  nombre_respuesta: [
    "Totalmente en desacuerdo",
    "En desacuerdo",
    "Ni de acuerdo ni en desacuerdo",
    "De acuerdo",
    "Totalmente de acuerdo",
  ],
  desde: ["18", "42", "66"],
  hasta: ["41", "65", "90"],
  porcentaje: ["46", "35", "19"],
  cantidad: ["133", "101", "55"],
  desde_v2: ["9", "21", "33"],
  hasta_v2: ["20", "32", "45"],
  porcentaje_v2: ["46", "35", "19"],
  cantidad_v2: ["133", "101", "55"],
  nombre_dimension: ["Gestion de abastecimiento", "Satisfaccion del servicio"],
  numero_dimension: ["1", "2"],
  nombre_indicador: ["Planificacion", "Transparencia", "Cumplimiento normativo", "Satisfaccion del servicio"],
  numero_indicador0: ["3", "1"],
  tema: "clasico",
};

// Temas de color para los graficos del Excel y de la vista previa. Deben
// coincidir con CHART_THEMES de node_app/generator.js (alli sin "#").
export interface ChartTheme {
  id: string;
  nombre: string;
  descripcion: string;
  colores: string[];
}

export const CHART_THEMES: ChartTheme[] = [
  { id: "clasico", nombre: "Clásico", descripcion: "Azul de tesis, un solo color", colores: ["#2F5597"] },
  { id: "powerbi", nombre: "Power BI", descripcion: "Paleta vibrante multicolor", colores: ["#118DFF", "#12239E", "#E66C37", "#6B007B", "#E044A7", "#744EC2", "#D9B300", "#D64550"] },
  { id: "ejecutivo", nombre: "Ejecutivo", descripcion: "Azules sobrios con dorado", colores: ["#1F3864", "#2F5597", "#8EAADB", "#BF9000", "#767171"] },
  { id: "esmeralda", nombre: "Esmeralda", descripcion: "Verdes frescos", colores: ["#0B5345", "#148F77", "#45B39D", "#82E0AA", "#1E8449"] },
  { id: "atardecer", nombre: "Atardecer", descripcion: "Rojos y naranjas cálidos", colores: ["#9D0208", "#D00000", "#E85D04", "#F48C06", "#FFBA08"] },
  { id: "monocromo", nombre: "Monocromo", descripcion: "Escala de grises elegante", colores: ["#212529", "#495057", "#6C757D", "#ADB5BD", "#CED4DA"] },
];

export const themePalette = (temaId: string): string[] =>
  CHART_THEMES.find((t) => t.id === temaId)?.colores ?? CHART_THEMES[0].colores;

export const LIST_GROUPS = [
  {
    title: "Opciones de respuesta",
    description: "Escribe las opciones que tienen tus preguntas, en orden de menor a mayor. Ej: Totalmente en desacuerdo → Totalmente de acuerdo.",
    fields: [
      { key: "nombre_respuesta", label: "Opciones de respuesta", placeholder: "Ej: De acuerdo" },
    ],
  },
  {
    title: "Baremo de Variable 1",
    description: "¿En qué nivel queda cada encuestado? Define los nombres de los niveles (Bajo, Medio, Alto) y qué porcentaje del total cae en cada uno. Los rangos exactos se calculan solos.",
    variable: "v1" as const,
    fields: [
      { key: "nombre_escala", label: "Nombre de cada nivel", placeholder: "Ej: Bajo" },
      { key: "porcentaje", label: "Porcentaje de personas en cada nivel (%)", placeholder: "Ej: 46" },
    ],
  },
  {
    title: "Baremo de Variable 2",
    description: "Igual que el baremo anterior, pero para tu segunda variable. Puede tener niveles distintos.",
    variable: "v2" as const,
    fields: [
      { key: "nombre_escala_v2", label: "Nombre de cada nivel", placeholder: "Ej: Bajo" },
      { key: "porcentaje_v2", label: "Porcentaje de personas en cada nivel (%)", placeholder: "Ej: 46" },
    ],
  },
];

export const WIZARD_STEPS = [
  { step: 1 as const, label: "Tu encuesta", description: "Datos básicos de tu muestra" },
  { step: 2 as const, label: "Escalas y estructura", description: "Baremos, dimensiones e indicadores" },
  { step: 3 as const, label: "Generar", description: "Revisa y descarga tu Excel" },
];


export const DEFAULT_LEVEL_NAMES: Record<number, string[]> = {
  1: ["Alto"],
  2: ["Bajo", "Alto"],
  3: ["Bajo", "Medio", "Alto"],
  4: ["Muy bajo", "Bajo", "Alto", "Muy alto"],
  5: ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"],
};
