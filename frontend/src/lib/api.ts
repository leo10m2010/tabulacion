// Cliente de la API de TesisHub: centraliza fetch, headers y manejo de
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
  Instrumento,
  MatrizJobResponse,
  MatrizStartResponse,
  PasoTesis,
  Proyecto,
  TabConfig,
  TemplateInfo,
  TitulosJobResponse,
  TitulosStartResponse,
  DeviceCredential,
} from "./types";

interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

// Error de la API que CONSERVA el código de estado. Antes se lanzaba un Error
// pelado con solo el mensaje, así que quien llamaba no podía distinguir una
// sesión caducada (401) de un dato inválido (400) o una caída (500) — salvo
// comparando el texto en español, que es frágil y solo se hacía en un sitio.
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly field?: string;
  readonly retryable?: boolean;
  readonly requestId?: string;
  constructor(status: number, message: string, details: {
    code?: string;
    field?: string;
    retryable?: boolean;
    requestId?: string;
  } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = details.code;
    this.field = details.field;
    this.retryable = details.retryable;
    this.requestId = details.requestId;
  }
}

// Se avisa UNA vez, de forma central, cuando el servidor rechaza la sesión.
// Así cualquier pantalla —incluidas las que se escriban en el futuro— cierra
// sesión correctamente sin tener que acordarse de manejarlo.
type UnauthorizedHandler = (mensaje: string) => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null) => {
  onUnauthorized = handler;
};

async function request<T>(apiBaseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = (await res.json().catch(() => ({}))) as T & {
    error?: string | { message?: string };
    message?: string;
    code?: string;
    field?: string;
    retryable?: boolean;
    requestId?: string;
  };
  if (!res.ok) {
    const mensaje = typeof payload.error === "string"
      ? payload.error
      : payload.error?.message ?? payload.message ?? `Error HTTP ${res.status}`;
    // 401 = el servidor no reconoce esta sesión (expiró, se cambió la
    // contraseña o se borró la cuenta). No tiene sentido que cada pantalla lo
    // resuelva por su cuenta: se cierra la sesión aquí, una sola vez.
    // Se excluye /auth/login: ahí un 401 significa "credenciales incorrectas",
    // no una sesión perdida, y cerrar sesión sería absurdo.
    if (res.status === 401 && options.token && onUnauthorized) {
      onUnauthorized("Tu sesión expiró. Vuelve a iniciar sesión para continuar.");
    }
    throw new ApiError(res.status, mensaje, {
      code: payload.code,
      field: payload.field,
      retryable: payload.retryable,
      requestId: payload.requestId,
    });
  }
  return payload;
}

// Despierta la API (hosting con arranque en frío); los errores se ignoran.
export const pingHealth = (apiBaseUrl: string) => {
  fetch(`${apiBaseUrl.replace(/\/$/, "")}/health`).catch(() => {});
};

// ── Configuración pública ────────────────────────────────────────────────────
// Se consulta ANTES de iniciar sesión: dice qué métodos de acceso ofrecer (y
// con qué Client ID de Google) y qué incluye cada plan. Es la fuente única de
// los planes; la copia de constants.ts solo sirve de valor inicial para que la
// pantalla pinte sin esperar a la red.
export interface PublicConfig {
  auth: {
    google: { enabled: boolean; clientId?: string };
    emailRegistration: boolean;
  };
  planPredeterminado: string;
  herramientas: { id: string; label: string }[];
  planes: Record<string, Record<string, number>>;
  capabilities?: Record<string, boolean>;
  quotaUnit?: Partial<Record<string, string>>;
  formsResponses?: Record<string, number>;
  paymentCurrency?: "PEN";
}

export const fetchPublicConfig = (apiBaseUrl: string) =>
  request<PublicConfig>(apiBaseUrl, "/config");

// ── Sesión ───────────────────────────────────────────────────────────────────
export const login = (apiBaseUrl: string, email: string, password: string) =>
  request<AuthLoginResponse>(apiBaseUrl, "/auth/login", { method: "POST", body: { email, password } });

// Inicio de sesión con Google. Con Google NO hay diferencia entre entrar y
// registrarse: si la cuenta no existe, el backend la crea con el plan
// gratuito. `creado` distingue los dos casos solo para poder dar la bienvenida.
export const loginWithGoogle = (apiBaseUrl: string, credential: string) =>
  request<AuthLoginResponse & { creado?: boolean }>(apiBaseUrl, "/auth/google", {
    method: "POST",
    body: { credential },
  });

export const linkGoogleIdentity = (
  apiBaseUrl: string,
  token: string,
  currentPassword: string,
  credential: string,
) => request<{ ok?: boolean; user: AuthUser }>(apiBaseUrl, "/auth/link-google", {
  method: "POST",
  token,
  body: { currentPassword, credential },
});

export const fetchMe = (apiBaseUrl: string, token: string) =>
  request<{ user?: AuthUser }>(apiBaseUrl, "/auth/me", { token });

export const logout = (apiBaseUrl: string, token: string) =>
  request<{ ok?: boolean }>(apiBaseUrl, "/auth/logout", { method: "POST", token });

export const createTaypiCheckout = (
  apiBaseUrl: string,
  token: string,
  purchase: { plan: string; billingCycle: "monthly" | "yearly"; idempotencyKey: string },
) => request<{
  paymentId: string;
  status: "pending";
  checkoutUrl: string;
  expiresAt?: string | null;
}>(apiBaseUrl, "/payments/taypi/checkout", {
  method: "POST",
  token,
  body: purchase,
});

export const createFormsTopupCheckout = (
  apiBaseUrl: string,
  token: string,
  purchase: { requestedResponses: number; idempotencyKey: string },
) => request<{
  paymentId: string;
  status: "pending";
  checkoutUrl: string;
  expiresAt?: string | null;
  requestedResponses: number;
  amount: string;
  currency: "PEN";
}>(apiBaseUrl, "/payments/taypi/forms-topup", {
  method: "POST",
  token,
  body: purchase,
});

// El cambio de contraseña invalida las sesiones anteriores y devuelve un
// token fresco para que la sesión actual continúe.
export const changePassword = (apiBaseUrl: string, token: string, currentPassword: string, newPassword: string) =>
  request<{ ok?: boolean; token?: string; tokenExpiresAt?: string }>(apiBaseUrl, "/auth/change-password", {
    method: "POST",
    token,
    body: { currentPassword, newPassword },
  });

// Eliminar la propia cuenta. La confirmación es escribir el correo, NO la
// contraseña: quien entró con Google tiene una contraseña aleatoria que nunca
// ha visto, así que pedírsela dejaría fuera justo a la mayoría.
export const deleteOwnAccount = (apiBaseUrl: string, token: string, confirmEmail: string) =>
  request<{ ok?: boolean; mensaje?: string; avisoCuota?: string }>(apiBaseUrl, "/auth/me", {
    method: "DELETE",
    token,
    body: { confirmEmail },
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

// Prueba de confiabilidad (Alfa de Cronbach): Excel de una hoja con una base
// de alta consistencia interna.
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

// ── Proyectos de tesis ───────────────────────────────────────────────────────
// El proyecto es privado: el servidor responde 404 a cualquiera que no sea su
// dueño, así que no hace falta filtrar nada aquí.
export const listarProyectos = (apiBaseUrl: string, token: string) =>
  request<{ proyectos: Proyecto[]; limite: number }>(apiBaseUrl, "/proyectos", { token });

export const crearProyecto = (
  apiBaseUrl: string, token: string, datos: { nombre: string; instrumento?: Instrumento },
) => request<{ proyecto: Proyecto }>(apiBaseUrl, "/proyectos", { method: "POST", token, body: datos });

export const obtenerProyecto = (apiBaseUrl: string, token: string, id: string) =>
  request<{ proyecto: Proyecto }>(apiBaseUrl, `/proyectos/${id}`, { token });

export const actualizarProyecto = (
  apiBaseUrl: string, token: string, id: string,
  cambios: { nombre?: string; titulo?: string; instrumento?: Instrumento; version?: number },
) => request<{ proyecto: Proyecto }>(apiBaseUrl, `/proyectos/${id}`, {
  method: "PATCH", token, body: cambios,
});

export const eliminarProyecto = (apiBaseUrl: string, token: string, id: string) =>
  request<{ ok?: boolean }>(apiBaseUrl, `/proyectos/${id}`, { method: "DELETE", token });

// Marca un paso de la tesis como hecho. Lo llama cada herramienta al terminar,
// y nunca debe estorbar: si falla, el usuario ya tiene su resultado y lo único
// que se pierde es el tilde en la lista de proyectos.
export const marcarPaso = (apiBaseUrl: string, token: string, id: string, paso: PasoTesis) =>
  request<{ proyecto: Proyecto }>(apiBaseUrl, `/proyectos/${id}/progreso`, {
    method: "POST", token, body: { paso },
  });

// ── Usuarios (admin) ─────────────────────────────────────────────────────────
export const listUsers = (apiBaseUrl: string, token: string) =>
  request<AuthUsersResponse>(apiBaseUrl, "/auth/users", { token });

export const createUser = (
  apiBaseUrl: string,
  token: string,
  data: { email: string; password: string; role: "admin" | "user"; plan: string; uses: Record<string, number> },
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

export const approveDevicePairing = (apiBaseUrl: string, token: string, userCode: string) =>
  request<{ ok?: boolean; pairingId: string; deviceName: string; status: string }>(
    apiBaseUrl,
    "/auth/device-pairings/approve",
    { method: "POST", token, body: { userCode } },
  );

export const listDevices = (apiBaseUrl: string, token: string) =>
  request<{ ok?: boolean; devices: DeviceCredential[] }>(apiBaseUrl, "/auth/devices", { token });

export const revokeDevice = (apiBaseUrl: string, token: string, deviceId: string) =>
  request<{ ok?: boolean }>(apiBaseUrl, `/auth/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    token,
  });

export interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export const listSessions = (apiBaseUrl: string, token: string) =>
  request<{ ok?: boolean; sessions: SessionInfo[] }>(apiBaseUrl, "/auth/sessions", { token });

export const revokeOtherSessions = (apiBaseUrl: string, token: string) =>
  request<{ ok?: boolean; revoked: number }>(apiBaseUrl, "/auth/sessions/revoke-others", {
    method: "POST",
    token,
  });
