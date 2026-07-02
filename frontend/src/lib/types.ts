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
export type AppSection = "tabulacion" | "confiabilidad" | "forms" | "usuarios" | "cuenta";
export type WizardStep = 1 | 2 | 3;
