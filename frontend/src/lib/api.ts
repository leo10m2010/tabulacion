// Cliente de la API de TesisTab: centraliza fetch, headers y manejo de
// errores. Todas las funciones lanzan Error con el mensaje del servidor
// (payload.error) o "Error HTTP <status>".
import type {
  AuthLoginResponse,
  AuthUser,
  AuthUsersResponse,
  CronbachResponse,
  InlineGenerateResponse,
  TabConfig,
  TemplateInfo,
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
