// Tipos compartidos de la aplicacion.
// ─── Types ───────────────────────────────────────────────────────────────────
export interface EstructuraIndicador { nombre: string; items: number }
export interface EstructuraDimension { nombre: string; indicadores: EstructuraIndicador[] }
export type ConfigValue = string | string[] | number | boolean | null | undefined | EstructuraDimension[];
export type TabConfig = Record<string, ConfigValue>;
export type TableCell = string | number | boolean | null;
export type TableRows = TableCell[][];

export interface ItemDef { id: string; nombre: string }
export interface IndicadorDef { id: string; nombre: string; items: ItemDef[] }
export interface DimensionDef { id: string; nombre: string; indicadores: IndicadorDef[] }

export interface ChartPreview {
  title: string;
  categories: string[];
  values: number[];
}

export interface SheetChartsPreview {
  sheet: string;
  charts: ChartPreview[];
}

// Resultado del control opcional de correlacion de la simulacion.
export interface CorrelationControl {
  activo: boolean;
  nivel?: string;
  etiqueta?: string;
  direccion: "directa" | "inversa";
  metodo: "spearman" | "pearson";
  obtenido: number;
  esperadoMin?: number;
  esperadoMax?: number;
  cumple?: boolean;
}

// Análisis del diseño cuasiexperimental (espejo de analyzeQuasiExperimentalData
// en node_app/lib/quasi-experimental.js).
export interface QuasiNormality {
  target: string;
  method: string;
  statistic: number | null;
  p: number | null;
  normal: boolean;
}

export interface QuasiDescriptive {
  n: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface QuasiComparison {
  name: string;
  type: "paired" | "independent";
  hypotheses: { nula: string; alterna: string };
  normality: QuasiNormality[];
  test: string;
  testLabel: string;
  statistic: number;
  df?: number | null;
  p: number;
  alpha: number;
  decision: string;
  significant: boolean;
  effectSize: number;
  effectMagnitude: string;
  interpretation: string;
}

export interface QuasiAnalysis {
  alpha: number;
  variable: string;
  descriptive: Record<string, QuasiDescriptive>;
  baseline: QuasiComparison;
  comparisons: QuasiComparison[];
}

export interface InlineGenerateResponse {
  correlation: number | null;
  correlationControl?: CorrelationControl | null;
  quasiExperimental?: QuasiAnalysis | null;
  diseno?: string;
  warnings?: string[];
  baseCsv: string;
  excelBase64: string;
  excelFileName?: string;
  chartsPreview?: SheetChartsPreview[];
  tema?: string;
  error?: string;
}

// Respuesta de la prueba de confiabilidad (Alfa de Cronbach).
export interface CronbachResponse {
  ok?: boolean;
  alpha: number;
  cumple: boolean;
  nivel: string;
  etiqueta: string;
  esperadoMin: number;
  esperadoMax: number;
  K: number;
  encuestados: number;
  variable: string;
  warnings?: string[];
  excelBase64: string;
  excelFileName?: string;
  error?: string;
}

// Tabulación Descriptiva (IA): el POST crea un job y el frontend hace polling
// hasta recibir el Excel en base64.
export interface DescriptivaResumen {
  tituloEstudio: string;
  tipoInstrumento: string;
  nEncuestados: number;
  preguntas: number;
  conBaremo: boolean;
  // "instrumento" = el cuestionario trae su propia escala (puntos/aciertos);
  // "likert" = baremo construido por el sistema sobre la escala ordinal.
  baremoOrigen?: "instrumento" | "likert" | null;
}

// Límites vigentes del servidor (GET /descriptiva/info): la UI los consume
// para no duplicar constantes que luego se desfasan.
export interface DescriptivaInfo {
  ok?: boolean;
  defaultN: number;
  minN: number;
  maxN: number;
  niveles: string[];
}

export interface DescriptivaStartResponse {
  ok?: boolean;
  jobId: string;
  status: string;
  error?: string;
}

export interface DescriptivaJobResponse {
  ok?: boolean;
  status: "processing" | "done" | "error";
  error?: string | null;
  warnings?: string[];
  resumen?: DescriptivaResumen;
  excelBase64?: string;
  excelFileName?: string;
}

// Generador de Títulos de Investigación (IA): formulario de una sola
// pantalla (NO chat). El POST crea un job (GLM-5.2 + búsqueda web puede
// tardar minutos) y el frontend hace polling hasta recibir el markdown.
export interface TitulosStartResponse {
  ok?: boolean;
  jobId: string;
  status: string;
  error?: string;
}

export interface TitulosJobResponse {
  ok?: boolean;
  status: "processing" | "done" | "error";
  error?: string | null;
  contenido?: string;
  webSearchRequests?: number | null;
  docxBase64?: string;
  docxFileName?: string;
}

// Matriz de Consistencia (IA): el backend valida y devuelve la matriz como
// JSON estructurado (espejo de parseMatriz en node_app/lib/matriz); el
// frontend arma la tabla desde este objeto y el Word llega aparte en base64.
export interface MatrizSeccion {
  general: string;
  especificos: string[];
}

export interface MatrizHipotesis {
  general: string;
  nula: string;
  especificas: string[];
}

export interface MatrizVariable {
  nombre: string;
  rol: string;
  dimensiones: string[];
  autor: string;
  fuente: string;
}

export interface MatrizMetodologia {
  tipo: string;
  enfoque: string;
  nivel: string;
  diseno: string;
  poblacion: string;
  muestra: string;
  muestreo: string;
  tecnica: string;
  instrumento: string;
}

export interface MatrizData {
  titulo: string;
  problema: MatrizSeccion;
  objetivos: MatrizSeccion;
  // null en tesis descriptivas (no llevan hipótesis).
  hipotesis: MatrizHipotesis | null;
  variables: MatrizVariable[];
  metodologia: MatrizMetodologia;
}

export interface MatrizStartResponse {
  ok?: boolean;
  jobId: string;
  status: string;
  error?: string;
}

// Humanizador (IA): métricas de burstiness/delatoras que el backend calcula
// antes y después de la reescritura (espejo de analyzeText en
// node_app/lib/humanizador/metrics.js).
export interface HumanizadorMetricasLado {
  palabras: number;
  oraciones: number;
  mediaPalabras: number;
  desviacion: number;
  cv: number;
  pctBanda1522: number;
  cortas: number;
  largas: number;
  delatoras: number;
  topDelatoras: { frase: string; veces: number }[];
}

export interface HumanizadorMetricas {
  antes: HumanizadorMetricasLado;
  despues: HumanizadorMetricasLado;
}

export interface HumanizadorStartResponse {
  ok?: boolean;
  jobId: string;
  status: string;
  error?: string;
}

export interface HumanizadorJobResponse {
  ok?: boolean;
  status: "processing" | "done" | "error";
  error?: string | null;
  textoHumanizado?: string;
  metricas?: HumanizadorMetricas;
  docxBase64?: string;
  docxFileName?: string;
}

export interface MatrizJobResponse {
  ok?: boolean;
  status: "processing" | "done" | "error";
  error?: string | null;
  matriz?: MatrizData;
  webSearchRequests?: number | null;
  docxBase64?: string;
  docxFileName?: string;
}

export interface TemplateInfo {
  maxMuestra: number;
  maxItemsV1: number;
  maxItemsV2: number;
}

export interface DownloadLinks {
  json: string;
  csv: string;
  xlsx: string;
}

export interface GeneratedResult {
  correlation: number | null;
  correlationControl: CorrelationControl | null;
  quasiExperimental: QuasiAnalysis | null;
  diseno: string;
  warnings: string[];
  csvRows: TableRows;
  sheetNames: string[];
  sheetData: Record<string, TableRows>;
  chartsPreview: SheetChartsPreview[];
  tema: string;
  generatedAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  plan: string;
  subscriptionEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  // Usos por herramienta (1 uso = 1 generación/corrida; null = ilimitados,
  // admins). formsUsesLeft/Used quedan como espejo legado de uses.forms.
  uses?: Partial<Record<UseTool, number>> | null;
  usesConsumed?: Partial<Record<UseTool, number>>;
  formsUsesLeft?: number | null;
  formsUsesUsed?: number;
  generationsCount?: number;
  lastGenerationAt?: string | null;
  hasApiKey?: boolean;
  apiKeyLast4?: string | null;
  // Historial de actividad (solo llega en el listado del admin).
  activity?: { at: string; detail: string }[];
}

export interface AuthLoginResponse {
  token?: string;
  tokenExpiresAt?: string;
  user?: AuthUser;
  error?: string;
}

export interface AuthUsersResponse {
  users?: AuthUser[];
  error?: string;
}

export type UseTool = "tabulacion" | "confiabilidad" | "descriptiva" | "titulos" | "matriz" | "humanizador" | "forms";

export type ThemeMode = "light" | "dark";
export type AppView = "landing" | "app";
export type AppSection = "inicio" | "tabulacion" | "descriptiva" | "confiabilidad" | "forms" | "titulos" | "matriz" | "humanizador" | "usuarios" | "cuenta" | "planes" | "proyectos";
export type WizardStep = 1 | 2 | 3;

// A qué vino el usuario a la pantalla de acceso. Con Google entrar y crear
// cuenta son la MISMA acción, así que esto no cambia el flujo: solo el énfasis
// (qué se explica primero y qué queda plegado).
export type AppIntent = "login" | "registro";

// ── Proyecto de tesis ────────────────────────────────────────────────────────
// El instrumento se define UNA vez aquí y lo reutilizan las herramientas, en
// vez de re-escribirlo en cada una (recomendación #1 de la auditoría UX).
export interface InstrumentoIndicador { nombre: string; items: string[] }
export interface InstrumentoDimension { nombre: string; indicadores: InstrumentoIndicador[] }
export interface InstrumentoNivel { nombre: string; desde: number; hasta: number; porcentaje: number }

export interface InstrumentoVariable {
  nombre: string;
  dimensiones: InstrumentoDimension[];
  baremo: InstrumentoNivel[];
  // Lo calcula el servidor al guardar; no se manda.
  totalItems?: number;
}

export interface Instrumento {
  escala: string[];
  variables: InstrumentoVariable[];
}

export interface Proyecto {
  id: string;
  userId: string;
  nombre: string;
  instrumento: Instrumento;
  createdAt: string;
  updatedAt: string;
}
