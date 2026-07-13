// Cliente de la API de TesisTab: centraliza fetch, headers y manejo de
// errores. Todas las funciones lanzan Error con el mensaje del servidor
// (payload.error) o "Error HTTP <status>".
import type {
  AuthLoginResponse,
  AuthUser,
  AuthUsersResponse,
  CronbachResponse,
  DescriptivaInfo,
  DescriptivaJobResponse,
  DescriptivaStartResponse,
  HumanizadorJobResponse,
  HumanizadorStartResponse,
  InlineGenerateResponse,
  MatrizJobResponse,
  MatrizStartResponse,
  TabConfig,
  TemplateInfo,
  TitulosJobResponse,
  TitulosStartResponse,
} from "./types";

interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

async function request<T>(apiBaseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
  return payload;
}

// Despierta la API (hosting con arranque en frío); los errores se ignoran.
export const pingHealth = (apiBaseUrl: string) => {
  fetch(`${apiBaseUrl.replace(/\/$/, "")}/health`).catch(() => {});
};

// ── Sesión ───────────────────────────────────────────────────────────────────
export const login = (apiBaseUrl: string, email: string, password: string) =>
  request<AuthLoginResponse>(apiBaseUrl, "/auth/login", { method: "POST", body: { email, password } });

export const fetchMe = (apiBaseUrl: string, token: string) =>
  request<{ user?: AuthUser }>(apiBaseUrl, "/auth/me", { token });

// El cambio de contraseña invalida las sesiones anteriores y devuelve un
// token fresco para que la sesión actual continúe.
export const changePassword = (apiBaseUrl: string, token: string, currentPassword: string, newPassword: string) =>
  request<{ ok?: boolean; token?: string; tokenExpiresAt?: string }>(apiBaseUrl, "/auth/change-password", {
    method: "POST",
    token,
    body: { currentPassword, newPassword },
  });

export const fetchTemplateInfo = (apiBaseUrl: string, token: string) =>
  request<Partial<TemplateInfo>>(apiBaseUrl, "/template-info", { token });

// ── Generación ───────────────────────────────────────────────────────────────
export const generateTabulacion = (apiBaseUrl: string, token: string, config: TabConfig) =>
  request<InlineGenerateResponse>(apiBaseUrl, "/generate", {
    method: "POST",
    token,
    body: { config, responseMode: "inline" },
  });

// Prueba de confiabilidad (Alfa de Cronbach): Excel de una hoja con datos
// simulados de alta consistencia interna.
export interface CronbachConfig {
  variable: string;
  encuestados: number;
  respuesta: number;
  dimensiones: { nombre: string; items: number }[];
  nivelAlfa: string;
}

export const generateCronbach = (apiBaseUrl: string, token: string, config: CronbachConfig) =>
  request<CronbachResponse>(apiBaseUrl, "/cronbach", { method: "POST", token, body: { config } });

// Tabulación Descriptiva (IA): crea un job en el servidor (la llamada a la IA
// tarda minutos) y luego se consulta su estado hasta obtener el Excel.
export interface DescriptivaInput {
  texto?: string;
  docxBase64?: string;
  config: { n: number; nivel?: string };
}

export const getDescriptivaInfo = (apiBaseUrl: string, token: string) =>
  request<DescriptivaInfo>(apiBaseUrl, "/descriptiva/info", { token });

export const startDescriptiva = (apiBaseUrl: string, token: string, input: DescriptivaInput) =>
  request<DescriptivaStartResponse>(apiBaseUrl, "/descriptiva", { method: "POST", token, body: input });

export const getDescriptivaJob = (apiBaseUrl: string, token: string, jobId: string) =>
  request<DescriptivaJobResponse>(apiBaseUrl, `/descriptiva/jobs/${jobId}`, { token });

// Generador de Títulos de Investigación (IA): formulario de una sola
// pantalla (universidad, carrera, lugar, número de variables y año
// opcional). El backend crea un job (GLM-5.2 + búsqueda web puede tardar
// minutos) y aquí se hace polling hasta recibir el markdown final.
export interface TitulosInput {
  universidad: string;
  carrera: string;
  lugar: string;
  numero_variables: "1" | "2";
  anio?: string;
}

export const startTitulos = (apiBaseUrl: string, token: string, input: TitulosInput) =>
  request<TitulosStartResponse>(apiBaseUrl, "/titulos", { method: "POST", token, body: input });

export const getTitulosJob = (apiBaseUrl: string, token: string, jobId: string) =>
  request<TitulosJobResponse>(apiBaseUrl, `/titulos/jobs/${jobId}`, { token });

// Matriz de Consistencia (IA): título obligatorio + campos opcionales. El
// backend crea un job (análisis del título + búsqueda de dimensiones +
// redacción pueden tardar minutos) y aquí se hace polling hasta recibir la
// matriz en JSON + el Word apaisado en base64.
export interface MatrizInput {
  titulo: string;
  universidad?: string;
  carrera?: string;
  poblacion?: string;
  lugar?: string;
  anio?: string;
}

export const startMatriz = (apiBaseUrl: string, token: string, input: MatrizInput) =>
  request<MatrizStartResponse>(apiBaseUrl, "/matriz", { method: "POST", token, body: input });

export const getMatrizJob = (apiBaseUrl: string, token: string, jobId: string) =>
  request<MatrizJobResponse>(apiBaseUrl, `/matriz/jobs/${jobId}`, { token });

// Humanizador (IA): texto pegado o .docx (50-3000 palabras). El backend crea
// un job (reescritura por bloques + métricas + repasada dirigida pueden
// tardar minutos) y aquí se hace polling hasta recibir el texto + métricas.
export interface HumanizadorInput {
  texto?: string;
  docxBase64?: string;
}

export const startHumanizador = (apiBaseUrl: string, token: string, input: HumanizadorInput) =>
  request<HumanizadorStartResponse>(apiBaseUrl, "/humanizador", { method: "POST", token, body: input });

export const getHumanizadorJob = (apiBaseUrl: string, token: string, jobId: string) =>
  request<HumanizadorJobResponse>(apiBaseUrl, `/humanizador/jobs/${jobId}`, { token });

// ── Usuarios (admin) ─────────────────────────────────────────────────────────
export const listUsers = (apiBaseUrl: string, token: string) =>
  request<AuthUsersResponse>(apiBaseUrl, "/auth/users", { token });

export const createUser = (
  apiBaseUrl: string,
  token: string,
  data: { email: string; password: string; role: "admin" | "user"; plan: string; subscriptionDays: number; formsUses: number },
) => request<{ ok?: boolean }>(apiBaseUrl, "/auth/users", { method: "POST", token, body: data });

export const patchUser = (apiBaseUrl: string, token: string, userId: string, patch: Record<string, unknown>) =>
  request<{ ok?: boolean }>(apiBaseUrl, `/auth/users/${userId}`, { method: "PATCH", token, body: patch });

export const deleteUser = (apiBaseUrl: string, token: string, userId: string) =>
  request<{ ok?: boolean }>(apiBaseUrl, `/auth/users/${userId}`, { method: "DELETE", token });

// Revoca la clave de API de la extensión de un usuario (solo admin).
export const revokeUserApiKey = (apiBaseUrl: string, token: string, userId: string) =>
  request<{ ok?: boolean }>(apiBaseUrl, `/auth/users/${userId}/api-key`, { method: "DELETE", token });

// Respaldo del almacén de usuarios (solo admin): con disco efímero en el
// hosting, exportar/importar evita perder cuentas, claves y usos.
export const getUsersBackup = (apiBaseUrl: string, token: string) =>
  request<{ exportedAt: string; users: unknown[] }>(apiBaseUrl, "/auth/users/backup", { token });

export const restoreUsersBackup = (apiBaseUrl: string, token: string, users: unknown[]) =>
  request<{ ok?: boolean; restored?: number }>(apiBaseUrl, "/auth/users/restore", {
    method: "POST",
    token,
    body: { users },
  });

// ── Clave de API (extensión Tutorica Forms) ──────────────────────────────────
export interface ApiKeyInfo {
  hasKey: boolean;
  last4: string | null;
  createdAt: string | null;
}

export const getApiKeyInfo = async (apiBaseUrl: string, token: string): Promise<ApiKeyInfo> => {
  const body = await request<{ hasKey?: boolean; last4?: string | null; createdAt?: string | null }>(
    apiBaseUrl, "/auth/api-key", { token },
  );
  return { hasKey: Boolean(body.hasKey), last4: body.last4 ?? null, createdAt: body.createdAt ?? null };
};

export const createApiKey = (apiBaseUrl: string, token: string) =>
  request<{ apiKey: string; last4?: string | null; createdAt?: string | null }>(
    apiBaseUrl, "/auth/api-key", { method: "POST", token },
  );

export const revokeApiKey = (apiBaseUrl: string, token: string) =>
  request<{ ok?: boolean }>(apiBaseUrl, "/auth/api-key", { method: "DELETE", token });
