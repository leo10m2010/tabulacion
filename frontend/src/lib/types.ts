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

export interface InlineGenerateResponse {
  correlation: number | null;
  warnings?: string[];
  baseCsv: string;
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
  warnings: string[];
  csvRows: TableRows;
  sheetNames: string[];
  sheetData: Record<string, TableRows>;
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
export type AppSection = "tabulacion" | "integraciones" | "usuarios";
export type WizardStep = 1 | 2 | 3;
