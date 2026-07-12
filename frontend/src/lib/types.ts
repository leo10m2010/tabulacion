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

export interface InlineGenerateResponse {
  correlation: number | null;
  correlationControl?: CorrelationControl | null;
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
  // Tabulación va por suscripción (días); Forms va por usos (1 uso = 1
  // corrida de llenado; null = ilimitados, admins).
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

export type ThemeMode = "light" | "dark";
export type AppView = "landing" | "app";
export type AppSection = "tabulacion" | "descriptiva" | "confiabilidad" | "forms" | "titulos" | "matriz" | "usuarios" | "cuenta";
export type WizardStep = 1 | 2 | 3;
