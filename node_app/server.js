import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  CHART_THEMES,
  MAX_ITEMS_POR_VARIABLE,
  MAX_MUESTRA,
  NIVELES_ALFA,
  NIVELES_CORRELACION,
  generateArtifacts,
  generateCronbach,
} from "./generator.js";
import {
  DEFAULT_N as DESCRIPTIVA_DEFAULT_N,
  MAX_N as DESCRIPTIVA_MAX_N,
  MIN_N as DESCRIPTIVA_MIN_N,
  NIVELES_PREPONDERANCIA,
  generateDescriptiva,
  normalizeDescriptivaInput,
} from "./lib/descriptiva/index.js";
import { docxToMarkdown } from "./lib/descriptiva/docx.js";
import { generateTitulos, normalizeTitulosInput } from "./lib/titulos/index.js";
import { generateMatriz, normalizeMatrizInput } from "./lib/matriz/index.js";
import { generateHumanizacion, normalizeHumanizadorInput } from "./lib/humanizador/index.js";

// Tutorica Forms (rellenador de Google Forms) corre en este mismo proceso: es
// una app Express a la que se delegan las rutas /api/tesistab y /api/forms.
const require = createRequire(import.meta.url);
const formsApp = require("../forms/server.js");
const FORMS_PATH_PREFIXES = ["/api/tesistab", "/api/forms", "/_submit"];
const isFormsPath = (url) => {
  const p = String(url || "/").split("?")[0];
  return FORMS_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const MAX_BODY_BYTES = Number.parseInt(process.env.MAX_BODY_BYTES ?? "4194304", 10);
const RESULT_TTL_SECONDS = Number.parseInt(process.env.RESULT_TTL_SECONDS ?? "900", 10);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL ?? "").trim();
const ALLOWED_ORIGIN_RAW = String(process.env.CORS_ORIGIN ?? "*").trim();
const ALLOWED_ORIGINS = ALLOWED_ORIGIN_RAW.split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const AUTH_REQUIRED = !new Set(["0", "false", "no", "off"]).has(String(process.env.AUTH_REQUIRED ?? "true").trim().toLowerCase());

// Sin secreto configurado (o con el viejo valor de ejemplo) se genera uno
// aleatorio por proceso: los tokens dejan de ser validos tras un reinicio,
// pero nadie puede forjarlos con un secreto publicado en el repositorio.
const INSECURE_SECRETS = new Set(["", "change-this-token-secret"]);
const envSecret = String(process.env.AUTH_TOKEN_SECRET ?? "").trim();
const AUTH_TOKEN_SECRET = INSECURE_SECRETS.has(envSecret)
  ? crypto.randomBytes(32).toString("hex")
  : envSecret;
if (INSECURE_SECRETS.has(envSecret) && AUTH_REQUIRED) {
  // eslint-disable-next-line no-console
  console.warn(
    "[AVISO] AUTH_TOKEN_SECRET no esta configurado: se genero un secreto aleatorio para esta ejecucion. "
    + "Las sesiones se invalidan al reiniciar. Define AUTH_TOKEN_SECRET en produccion.",
  );
}

const AUTH_TOKEN_TTL_SECONDS = Number.parseInt(process.env.AUTH_TOKEN_TTL_SECONDS ?? "86400", 10);

// Secreto compartido para que otros servicios (p. ej. Tutorica Forms) validen
// claves de API en /integrations/validate-key. Si esta vacio, el endpoint
// responde igual (las claves son inadivinables: 48 hex aleatorios), pero en
// produccion conviene configurarlo en ambos servicios.
const SERVICE_SHARED_SECRET = String(process.env.SERVICE_SHARED_SECRET ?? "").trim();
const USER_STORE_PATH = process.env.USER_STORE_PATH
  ? path.resolve(process.env.USER_STORE_PATH)
  : path.join(SCRIPT_DIR, "data", "users.json");
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL ?? "admin@tabulacion.local").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD ?? "").trim();
// Clave de API fija del admin (formato ttab_...): con disco efimero (plan free
// de Render) users.json se borra en cada reinicio y las claves generadas desde
// la pagina dejan de existir; esta variable la restaura en cada arranque.
const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY ?? "").trim();

// Limite de intentos de login fallidos por origen+email.
const LOGIN_MAX_ATTEMPTS = Number.parseInt(process.env.LOGIN_MAX_ATTEMPTS ?? "5", 10);
const LOGIN_WINDOW_MS = Number.parseInt(process.env.LOGIN_WINDOW_SECONDS ?? "900", 10) * 1000;

const results = new Map();
let users = [];

// Jobs de Tabulacion Descriptiva (IA): la llamada a OpenRouter puede tardar
// minutos, asi que POST /descriptiva crea un job y el frontend hace polling.
const descriptivaJobs = new Map();
const DESCRIPTIVA_JOB_TTL_MS = Number.parseInt(process.env.DESCRIPTIVA_JOB_TTL_SECONDS ?? "1800", 10) * 1000;
// Un job terminado retiene el Excel en memoria (contenedor de 512 MB): se le
// da un TTL corto propio, y aun mas corto una vez que el cliente lo descargo.
const DESCRIPTIVA_DONE_TTL_MS = Number.parseInt(process.env.DESCRIPTIVA_DONE_TTL_SECONDS ?? "600", 10) * 1000;
const DESCRIPTIVA_SERVED_TTL_MS = 120 * 1000;
const DESCRIPTIVA_MAX_CONCURRENT = Number.parseInt(process.env.DESCRIPTIVA_MAX_CONCURRENT ?? "3", 10);

// Un job cuenta como "en curso" solo dentro de su TTL: si su promesa quedara
// colgada, no debe bloquear al usuario (409) para siempre.
const isDescriptivaJobActive = (job) => job.status === "processing"
  && Date.now() - job.createdAt < DESCRIPTIVA_JOB_TTL_MS;

// Jobs del Generador de Titulos de Investigacion (IA): mismo patron que
// Tabulacion Descriptiva (la llamada a OpenRouter con web_search puede tardar
// varios minutos, asi que POST /titulos crea un job y el frontend hace
// polling).
const titulosJobs = new Map();
const TITULOS_JOB_TTL_MS = Number.parseInt(process.env.TITULOS_JOB_TTL_SECONDS ?? "1800", 10) * 1000;
const TITULOS_DONE_TTL_MS = Number.parseInt(process.env.TITULOS_DONE_TTL_SECONDS ?? "600", 10) * 1000;
const TITULOS_SERVED_TTL_MS = 120 * 1000;
const TITULOS_MAX_CONCURRENT = Number.parseInt(process.env.TITULOS_MAX_CONCURRENT ?? "3", 10);

const isTitulosJobActive = (job) => job.status === "processing"
  && Date.now() - job.createdAt < TITULOS_JOB_TTL_MS;

// Jobs de la Matriz de Consistencia (IA): mismo patron que Titulos (dos
// llamadas a OpenRouter + busquedas dirigidas pueden tardar minutos, asi que
// POST /matriz crea un job y el frontend hace polling).
const matrizJobs = new Map();
const MATRIZ_JOB_TTL_MS = Number.parseInt(process.env.MATRIZ_JOB_TTL_SECONDS ?? "1800", 10) * 1000;
const MATRIZ_DONE_TTL_MS = Number.parseInt(process.env.MATRIZ_DONE_TTL_SECONDS ?? "600", 10) * 1000;
const MATRIZ_SERVED_TTL_MS = 120 * 1000;
const MATRIZ_MAX_CONCURRENT = Number.parseInt(process.env.MATRIZ_MAX_CONCURRENT ?? "3", 10);

const isMatrizJobActive = (job) => job.status === "processing"
  && Date.now() - job.createdAt < MATRIZ_JOB_TTL_MS;

// Jobs del Humanizador (IA): mismo patron (varias llamadas a OpenRouter por
// bloque de ~1000 palabras pueden tardar minutos; POST /humanizador crea un
// job y el frontend hace polling).
const humanizadorJobs = new Map();
const HUMANIZADOR_JOB_TTL_MS = Number.parseInt(process.env.HUMANIZADOR_JOB_TTL_SECONDS ?? "1800", 10) * 1000;
const HUMANIZADOR_DONE_TTL_MS = Number.parseInt(process.env.HUMANIZADOR_DONE_TTL_SECONDS ?? "600", 10) * 1000;
const HUMANIZADOR_SERVED_TTL_MS = 120 * 1000;
const HUMANIZADOR_MAX_CONCURRENT = Number.parseInt(process.env.HUMANIZADOR_MAX_CONCURRENT ?? "3", 10);

const isHumanizadorJobActive = (job) => job.status === "processing"
  && Date.now() - job.createdAt < HUMANIZADOR_JOB_TTL_MS;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ttlMs = RESULT_TTL_SECONDS * 1000;

const cleanupExpired = () => {
  const now = Date.now();
  for (const [id, item] of results.entries()) {
    if (item.expiresAt <= now) {
      results.delete(id);
    }
  }
  for (const [id, job] of descriptivaJobs.entries()) {
    // A los jobs en curso se les da un margen extra (su promesa puede seguir
    // viva), pero pasado 2x TTL se consideran zombis y se eliminan.
    const hardExpiry = job.status === "processing" ? job.expiresAt + DESCRIPTIVA_JOB_TTL_MS : job.expiresAt;
    if (hardExpiry <= now) {
      descriptivaJobs.delete(id);
    }
  }
  for (const [id, job] of titulosJobs.entries()) {
    const hardExpiry = job.status === "processing" ? job.expiresAt + TITULOS_JOB_TTL_MS : job.expiresAt;
    if (hardExpiry <= now) {
      titulosJobs.delete(id);
    }
  }
  for (const [id, job] of matrizJobs.entries()) {
    const hardExpiry = job.status === "processing" ? job.expiresAt + MATRIZ_JOB_TTL_MS : job.expiresAt;
    if (hardExpiry <= now) {
      matrizJobs.delete(id);
    }
  }
  for (const [id, job] of humanizadorJobs.entries()) {
    const hardExpiry = job.status === "processing" ? job.expiresAt + HUMANIZADOR_JOB_TTL_MS : job.expiresAt;
    if (hardExpiry <= now) {
      humanizadorJobs.delete(id);
    }
  }
};

const getBaseUrl = (req) => {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, "");
  const protoHeader = String(req.headers["x-forwarded-proto"] ?? "").trim();
  const proto = protoHeader || "http";
  const host = String(req.headers.host ?? `localhost:${PORT}`);
  return `${proto}://${host}`;
};

const setCorsHeaders = (req, res) => {
  const origin = String(req.headers.origin ?? "").trim();
  // La extension Tutorica Forms inicia sesion desde su popup
  // (origen chrome-extension://...); el control de acceso real son las
  // credenciales, no el origen.
  const isExtensionOrigin = origin.startsWith("chrome-extension://");
  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && (ALLOWED_ORIGINS.includes(origin) || isExtensionOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
};

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
};

const parseJsonBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;

  req.on("data", (chunk) => {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      reject(new HttpError(413, `El cuerpo supera el limite de ${MAX_BODY_BYTES} bytes.`));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (total === 0) {
      resolve({});
      return;
    }
    try {
      const body = Buffer.concat(chunks).toString("utf-8");
      resolve(JSON.parse(body));
    } catch {
      reject(new HttpError(400, "JSON invalido."));
    }
  });

  req.on("error", (err) => {
    reject(err);
  });
});

const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

const isStrongPassword = (password) => String(password ?? "").length >= 8;

const toIsoOrNull = (input) => {
  if (input === null || input === undefined || String(input).trim() === "") return null;
  const d = new Date(String(input));
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(400, "Fecha invalida para suscripcion.");
  }
  return d.toISOString();
};

const addDaysIso = (days, fromDate = new Date()) => {
  const next = new Date(fromDate.getTime() + days * 24 * 60 * 60 * 1000);
  return next.toISOString();
};

const isSubscriptionExpired = (user) => {
  if (user.role === "admin") return false;
  if (!user.subscriptionEndsAt) return true;
  const ts = Date.parse(user.subscriptionEndsAt);
  if (!Number.isFinite(ts)) return true;
  return ts < Date.now();
};

const ensureUserStore = () => {
  fs.mkdirSync(path.dirname(USER_STORE_PATH), { recursive: true });
  if (!fs.existsSync(USER_STORE_PATH)) {
    fs.writeFileSync(USER_STORE_PATH, "[]", "utf-8");
  }
};

const readUsers = () => {
  ensureUserStore();
  try {
    const raw = fs.readFileSync(USER_STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("El store no tiene formato de arreglo.");
    users = parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[WARN] users.json ilegible (${err.message}). Iniciando con lista vacía.`);
    users = [];
  }
};

const writeUsers = () => {
  const tempPath = `${USER_STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(users, null, 2), "utf-8");
  fs.renameSync(tempPath, USER_STORE_PATH);
};

const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
  plan: user.plan,
  subscriptionEndsAt: user.subscriptionEndsAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt,
  // Metricas y usos: Tabulacion va por suscripcion (dias); Forms va por usos
  // (1 uso = 1 corrida de llenado; los admins tienen usos ilimitados: null).
  formsUsesLeft: user.role === "admin" ? null : (Number.isFinite(user.formsUsesLeft) ? user.formsUsesLeft : 0),
  formsUsesUsed: user.formsUsesUsed ?? 0,
  generationsCount: user.generationsCount ?? 0,
  lastGenerationAt: user.lastGenerationAt ?? null,
  hasApiKey: Boolean(user.apiKeyHash),
  apiKeyLast4: user.apiKeyLast4 ?? null,
});

const hashPassword = (password, saltHex) => {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.scryptSync(password, salt, 64).toString("hex");
};

const buildPassword = (password) => {
  if (!isStrongPassword(password)) {
    throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  return { passwordSalt: salt, passwordHash: hash };
};

// Claves de API por usuario (servicios externos como Tutorica Forms): se
// guarda solo el hash; la clave en claro se muestra una unica vez.
const hashApiKey = (key) => crypto.createHash("sha256").update(key).digest("hex");

const checkPassword = (password, user) => {
  const expected = Buffer.from(user.passwordHash, "hex");
  const received = Buffer.from(hashPassword(password, user.passwordSalt), "hex");
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
};

const assertUniqueEmail = (email, ignoreUserId = null) => {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new HttpError(400, "Email requerido.");
  }
  const exists = users.find((item) => item.emailLower === normalized && item.id !== ignoreUserId);
  if (exists) {
    throw new HttpError(409, "Ya existe un usuario con ese email.");
  }
  return normalized;
};

const createUser = ({
  email,
  password,
  role = "user",
  status = "active",
  plan = "pro",
  subscriptionEndsAt,
  subscriptionDays,
  formsUses,
}) => {
  const normalizedEmail = assertUniqueEmail(email);
  if (!["admin", "user"].includes(role)) {
    throw new HttpError(400, "Rol invalido.");
  }
  if (!["active", "disabled"].includes(status)) {
    throw new HttpError(400, "Estado invalido.");
  }
  const credentials = buildPassword(password);
  const nowIso = new Date().toISOString();
  let subscriptionDate = toIsoOrNull(subscriptionEndsAt);
  if (!subscriptionDate && Number.isFinite(Number(subscriptionDays))) {
    subscriptionDate = addDaysIso(Number(subscriptionDays));
  }
  if (!subscriptionDate && role === "user") {
    subscriptionDate = addDaysIso(30);
  }
  if (role === "admin") {
    subscriptionDate = subscriptionDate ?? null;
  }

  const user = {
    id: crypto.randomUUID(),
    email: String(email).trim(),
    emailLower: normalizedEmail,
    role,
    status,
    plan: String(plan ?? "").trim() || "pro",
    subscriptionEndsAt: subscriptionDate,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastLoginAt: null,
    formsUsesLeft: Number.isFinite(Number(formsUses)) && Number(formsUses) > 0
      ? Math.floor(Number(formsUses))
      : 0,
    formsUsesUsed: 0,
    generationsCount: 0,
    lastGenerationAt: null,
    activity: [],
    tokenVersion: 1,
    ...credentials,
  };
  logActivity(user, "Cuenta creada");

  users.push(user);
  writeUsers();
  return user;
};

const patchUser = (user, payload) => {
  const next = { ...user };

  if (payload.email !== undefined) {
    const normalized = assertUniqueEmail(payload.email, user.id);
    next.email = String(payload.email).trim();
    next.emailLower = normalized;
  }
  if (payload.role !== undefined) {
    if (!["admin", "user"].includes(payload.role)) {
      throw new HttpError(400, "Rol invalido.");
    }
    next.role = payload.role;
    if (next.role === "admin" && !next.subscriptionEndsAt) {
      next.subscriptionEndsAt = null;
    }
  }
  if (payload.status !== undefined) {
    if (!["active", "disabled"].includes(payload.status)) {
      throw new HttpError(400, "Estado invalido.");
    }
    next.status = payload.status;
  }
  if (payload.plan !== undefined) {
    next.plan = String(payload.plan ?? "").trim() || next.plan;
  }
  if (payload.subscriptionEndsAt !== undefined) {
    next.subscriptionEndsAt = toIsoOrNull(payload.subscriptionEndsAt);
  }
  if (payload.subscriptionDays !== undefined) {
    const days = Number(payload.subscriptionDays);
    if (!Number.isFinite(days) || days <= 0) {
      throw new HttpError(400, "subscriptionDays debe ser mayor a 0.");
    }
    next.subscriptionEndsAt = addDaysIso(days);
  }
  if (payload.subscriptionDaysDelta !== undefined) {
    const days = Number(payload.subscriptionDaysDelta);
    if (!Number.isFinite(days) || days === 0) {
      throw new HttpError(400, "subscriptionDaysDelta debe ser diferente de 0.");
    }
    const base = next.subscriptionEndsAt ? new Date(next.subscriptionEndsAt) : new Date();
    const baseDate = base.getTime() > Date.now() ? base : new Date();
    next.subscriptionEndsAt = addDaysIso(days, baseDate);
  }
  if (payload.password !== undefined) {
    Object.assign(next, buildPassword(String(payload.password)));
    // Restablecer la contraseña invalida todas las sesiones abiertas.
    next.tokenVersion = (next.tokenVersion ?? 1) + 1;
  }
  // Usos de Forms: valor absoluto o recarga incremental (puede ser negativa
  // para corregir, sin bajar de 0).
  if (payload.formsUses !== undefined) {
    const uses = Number(payload.formsUses);
    if (!Number.isFinite(uses) || uses < 0) {
      throw new HttpError(400, "formsUses debe ser 0 o mayor.");
    }
    next.formsUsesLeft = Math.floor(uses);
  }
  if (payload.formsUsesDelta !== undefined) {
    const delta = Number(payload.formsUsesDelta);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new HttpError(400, "formsUsesDelta debe ser diferente de 0.");
    }
    const current = Number.isFinite(next.formsUsesLeft) ? next.formsUsesLeft : 0;
    next.formsUsesLeft = Math.max(0, Math.floor(current + delta));
  }

  next.updatedAt = new Date().toISOString();
  return next;
};

const syncAdminApiKey = (admin) => {
  if (!ADMIN_API_KEY) return false;
  if (!ADMIN_API_KEY.startsWith("ttab_") || ADMIN_API_KEY.length < 20) {
    // eslint-disable-next-line no-console
    console.warn("[WARN] ADMIN_API_KEY ignorada: debe empezar con ttab_ y tener al menos 20 caracteres.");
    return false;
  }
  const hash = hashApiKey(ADMIN_API_KEY);
  if (admin.apiKeyHash === hash) return false;
  admin.apiKeyHash = hash;
  admin.apiKeyLast4 = ADMIN_API_KEY.slice(-4);
  admin.apiKeyCreatedAt = new Date().toISOString();
  admin.updatedAt = admin.apiKeyCreatedAt;
  // eslint-disable-next-line no-console
  console.log(`Admin ${admin.email}: clave de API restaurada desde ADMIN_API_KEY (···${admin.apiKeyLast4}).`);
  return true;
};

const ensureBootstrapAdmin = () => {
  // Idempotente: el admin definido por ADMIN_EMAIL/ADMIN_PASSWORD debe poder
  // entrar siempre, aunque el almacen ya tenga usuarios (con disco efimero el
  // store puede regenerarse o venir de otro entorno).
  const normalized = normalizeEmail(ADMIN_EMAIL);
  const existing = users.find((item) => item.emailLower === normalized);
  if (existing) {
    let changed = false;
    if (ADMIN_PASSWORD && !checkPassword(ADMIN_PASSWORD, existing)) {
      Object.assign(existing, buildPassword(ADMIN_PASSWORD));
      existing.role = "admin";
      existing.status = "active";
      existing.tokenVersion = (existing.tokenVersion ?? 1) + 1;
      existing.updatedAt = new Date().toISOString();
      changed = true;
      // eslint-disable-next-line no-console
      console.log(`Admin ${existing.email}: contraseña sincronizada desde ADMIN_PASSWORD.`);
    }
    if (syncAdminApiKey(existing)) changed = true;
    if (changed) writeUsers();
    return;
  }
  // Sin ADMIN_PASSWORD y con usuarios existentes no se inventan admins.
  if (users.length > 0 && !ADMIN_PASSWORD) return;
  // Si no hay contraseña configurada se genera una aleatoria y se muestra una
  // sola vez; nunca se usa una contraseña por defecto conocida.
  const generated = !ADMIN_PASSWORD;
  const password = ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const admin = createUser({
    email: ADMIN_EMAIL,
    password,
    role: "admin",
    status: "active",
    plan: "enterprise",
    subscriptionEndsAt: null,
  });
  if (syncAdminApiKey(admin)) writeUsers();
  // eslint-disable-next-line no-console
  console.log(
    generated
      ? `Admin inicial creado: ${admin.email} | contraseña generada (guardala y cambiala): ${password}`
      : `Admin inicial creado: ${admin.email} | cambia la contraseña luego de ingresar.`,
  );
};

const base64UrlJson = (obj) => Buffer.from(JSON.stringify(obj), "utf-8").toString("base64url");

const signToken = (user) => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + AUTH_TOKEN_TTL_SECONDS;
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    sub: user.id,
    email: user.email,
    role: user.role,
    // Version de credenciales: cambiar/restablecer la contraseña la
    // incrementa y todos los tokens anteriores quedan invalidados.
    ver: user.tokenVersion ?? 1,
    iat: now,
    exp,
  });
  const sig = crypto.createHmac("sha256", AUTH_TOKEN_SECRET).update(`${header}.${payload}`).digest("base64url");
  return {
    token: `${header}.${payload}.${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
};

const verifyToken = (token) => {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "Token invalido.");
  }
  const [header, payload, signature] = parts;
  const expectedSig = crypto.createHmac("sha256", AUTH_TOKEN_SECRET).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Firma del token invalida.");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  if (!parsed?.sub || !parsed?.exp) {
    throw new HttpError(401, "Token sin payload valido.");
  }
  if (Math.floor(Date.now() / 1000) >= Number(parsed.exp)) {
    throw new HttpError(401, "Token expirado.");
  }
  return parsed;
};

const getBearerToken = (req) => {
  const authHeader = String(req.headers.authorization ?? "").trim();
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
};

const requireAuth = (req, opts = {}) => {
  if (!AUTH_REQUIRED) {
    return {
      id: "local-dev-admin",
      email: "local@dev",
      role: "admin",
      status: "active",
      subscriptionEndsAt: null,
    };
  }

  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Token requerido.");
  const claims = verifyToken(token);
  const user = users.find((item) => item.id === claims.sub);
  if (!user) throw new HttpError(401, "Usuario del token no existe.");
  if (user.status !== "active") throw new HttpError(403, "Usuario inactivo.");
  if ((claims.ver ?? 1) !== (user.tokenVersion ?? 1)) {
    throw new HttpError(401, "Sesion invalidada por un cambio de contraseña. Inicia sesion de nuevo.");
  }
  // Productos desacoplados: la sesion solo exige cuenta activa. Los dias de
  // suscripcion se exigen unicamente donde aplica (/generate, Tabulacion);
  // Forms va por usos y no depende de los dias.
  if (opts.requireSubscription && isSubscriptionExpired(user)) {
    throw new HttpError(403, `Suscripcion vencida (${user.subscriptionEndsAt ?? "sin fecha"}).`);
  }
  if (opts.adminOnly && user.role !== "admin") {
    throw new HttpError(403, "Se requiere rol administrador.");
  }
  return user;
};

// Historial de actividad por usuario (ultimos 30 eventos).
const logActivity = (user, detail) => {
  user.activity = [
    { at: new Date().toISOString(), detail },
    ...(Array.isArray(user.activity) ? user.activity : []),
  ].slice(0, 30);
};

// Metricas de generacion por usuario (Excel de tabulacion o de confiabilidad;
// el usuario dev sin store no se contabiliza).
const registerGeneration = (authUser, detail) => {
  const owner = users.find((item) => item.id === authUser.id);
  if (!owner) return;
  owner.generationsCount = (owner.generationsCount ?? 0) + 1;
  owner.lastGenerationAt = new Date().toISOString();
  owner.updatedAt = owner.lastGenerationAt;
  logActivity(owner, detail);
  writeUsers();
};

// ── Rate limiting de login (en memoria) ─────────────────────────────────────
const loginAttempts = new Map();

const cleanupLoginAttempts = () => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts.entries()) {
    if (now - entry.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
};

const assertLoginAllowed = (key) => {
  cleanupLoginAttempts();
  const entry = loginAttempts.get(key);
  if (entry && entry.count >= LOGIN_MAX_ATTEMPTS) {
    const retryInSec = Math.ceil((entry.firstAt + LOGIN_WINDOW_MS - Date.now()) / 1000);
    throw new HttpError(429, `Demasiados intentos fallidos. Intenta de nuevo en ${Math.max(retryInSec, 1)} segundos.`);
  }
};

const registerLoginFailure = (key) => {
  const entry = loginAttempts.get(key);
  if (entry) {
    entry.count += 1;
  } else {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() });
  }
};

const getClientIp = (req) => {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
};

const getStoredResult = (id) => {
  const item = results.get(id);
  if (!item) throw new HttpError(404, "Resultado no encontrado o expirado.");
  if (item.expiresAt <= Date.now()) {
    results.delete(id);
    throw new HttpError(404, "Resultado expirado.");
  }
  return item;
};

const canAccessResult = (user, item) => {
  if (!AUTH_REQUIRED) return true;
  return user.role === "admin" || item.ownerUserId === user.id;
};

readUsers();
ensureBootstrapAdmin();
setInterval(cleanupExpired, 60_000).unref();

// Forms valida las claves ttab_ en memoria (mismo proceso): lee la lista de
// usuarios viva, sin llamadas HTTP ni secreto compartido.
const findKeyOwner = (apiKey) => {
  const key = String(apiKey || "").trim();
  if (!key.startsWith("ttab_") || key.length < 20) return null;
  return users.find((item) => item.apiKeyHash === hashApiKey(key)) ?? null;
};

const formsUsesLeftOf = (owner) => (
  owner.role === "admin" ? null : (Number.isFinite(owner.formsUsesLeft) ? owner.formsUsesLeft : 0)
);

// Forms va por usos, desacoplado de la suscripcion: la clave es valida
// mientras la cuenta este activa; los usos se verifican al consumir.
formsApp.setKeyValidator((apiKey) => {
  const owner = findKeyOwner(apiKey);
  if (!owner) return { valid: false, reason: "clave_desconocida" };
  if (owner.status !== "active") return { valid: false, reason: "usuario_inactivo" };
  return {
    valid: true,
    email: owner.email,
    plan: owner.plan,
    role: owner.role,
    usesLeft: formsUsesLeftOf(owner),
  };
});

// Forms funciona por usos: 1 uso = 1 corrida de llenado. El consumo ocurre al
// crear el job (los admins tienen usos ilimitados: usesLeft null).
formsApp.setUsageConsumer((apiKey) => {
  const owner = findKeyOwner(apiKey);
  if (!owner) return { ok: false, reason: "clave_desconocida" };
  if (owner.role === "admin") return { ok: true, usesLeft: null };
  const left = formsUsesLeftOf(owner);
  if (left <= 0) return { ok: false, reason: "sin_usos" };
  owner.formsUsesLeft = left - 1;
  owner.formsUsesUsed = (owner.formsUsesUsed ?? 0) + 1;
  logActivity(owner, `Corrida de Forms (quedan ${owner.formsUsesLeft} usos)`);
  owner.updatedAt = new Date().toISOString();
  writeUsers();
  return { ok: true, usesLeft: owner.formsUsesLeft };
});

const server = http.createServer(async (req, res) => {
  // Las rutas del servicio Forms las maneja la app Express montada.
  if (isFormsPath(req.url)) {
    formsApp(req, res);
    return;
  }
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  cleanupExpired();
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const pathname = requestUrl.pathname;

  try {
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "tabulacion-api",
        now: new Date().toISOString(),
        inMemoryResults: results.size,
        authRequired: AUTH_REQUIRED,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      const payload = await parseJsonBody(req);
      const email = normalizeEmail(payload?.email);
      const password = String(payload?.password ?? "");
      const rateKey = `${getClientIp(req)}|${email}`;
      assertLoginAllowed(rateKey);
      const user = users.find((item) => item.emailLower === email);
      if (!user || !checkPassword(password, user)) {
        registerLoginFailure(rateKey);
        throw new HttpError(401, "Credenciales invalidas.");
      }
      loginAttempts.delete(rateKey);
      if (user.status !== "active") {
        throw new HttpError(403, "Usuario inactivo.");
      }
      // La suscripcion vencida NO bloquea el login: el usuario puede entrar a
      // ver su cuenta y usar Forms con sus usos; /generate si exige dias.
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = user.lastLoginAt;
      writeUsers();
      const signed = signToken(user);
      sendJson(res, 200, {
        ok: true,
        token: signed.token,
        tokenExpiresAt: signed.expiresAt,
        user: sanitizeUser(user),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/auth/me") {
      const user = requireAuth(req);
      sendJson(res, 200, { ok: true, user: sanitizeUser(user) });
      return;
    }

    // ── Clave de API del usuario (para la extension Tutorica Forms) ─────────
    if (pathname === "/auth/api-key") {
      const user = requireAuth(req);
      if (req.method === "GET") {
        sendJson(res, 200, {
          ok: true,
          hasKey: Boolean(user.apiKeyHash),
          last4: user.apiKeyLast4 ?? null,
          createdAt: user.apiKeyCreatedAt ?? null,
        });
        return;
      }
      if (req.method === "POST") {
        // El admin con ADMIN_API_KEY fija recibe siempre esa clave: si se
        // regenerara, el proximo reinicio la restauraria desde el entorno y la
        // clave recien emitida dejaria de validar sin aviso.
        const isBootstrapAdmin = user.emailLower === normalizeEmail(ADMIN_EMAIL);
        const hasFixedAdminKey =
          isBootstrapAdmin && ADMIN_API_KEY.startsWith("ttab_") && ADMIN_API_KEY.length >= 20;
        const apiKey = hasFixedAdminKey ? ADMIN_API_KEY : `ttab_${crypto.randomBytes(24).toString("hex")}`;
        user.apiKeyHash = hashApiKey(apiKey);
        user.apiKeyLast4 = apiKey.slice(-4);
        user.apiKeyCreatedAt = new Date().toISOString();
        user.updatedAt = user.apiKeyCreatedAt;
        logActivity(user, "Generó su clave de API");
        writeUsers();
        // La clave en claro solo viaja en esta respuesta.
        sendJson(res, 200, { ok: true, apiKey, last4: user.apiKeyLast4, createdAt: user.apiKeyCreatedAt });
        return;
      }
      if (req.method === "DELETE") {
        delete user.apiKeyHash;
        delete user.apiKeyLast4;
        delete user.apiKeyCreatedAt;
        user.updatedAt = new Date().toISOString();
        logActivity(user, "Revocó su clave de API");
        writeUsers();
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    // ── Validacion de claves para servicios integrados ───────────────────────
    if (req.method === "POST" && pathname === "/integrations/validate-key") {
      if (SERVICE_SHARED_SECRET) {
        const provided = Buffer.from(String(req.headers["x-service-secret"] ?? "").trim());
        const expected = Buffer.from(SERVICE_SHARED_SECRET);
        if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
          throw new HttpError(401, "Secreto de servicio invalido.");
        }
      }
      const payload = await parseJsonBody(req);
      const key = String(payload?.key ?? "").trim();
      const reply = (valid, extra = {}) => sendJson(res, 200, { ok: true, valid, ...extra });
      if (!key.startsWith("ttab_") || key.length < 20) {
        reply(false, { reason: "formato_invalido" });
        return;
      }
      const hash = hashApiKey(key);
      const owner = users.find((item) => item.apiKeyHash === hash);
      if (!owner) {
        reply(false, { reason: "clave_desconocida" });
        return;
      }
      if (owner.status !== "active") {
        reply(false, { reason: "usuario_inactivo" });
        return;
      }
      // Forms va por usos: la suscripcion vencida no invalida la clave.
      reply(true, {
        email: owner.email,
        plan: owner.plan,
        role: owner.role,
        subscriptionEndsAt: owner.subscriptionEndsAt,
        usesLeft: formsUsesLeftOf(owner),
      });
      return;
    }

    // Cambio de contraseña por el propio usuario (self-service). Con rate
    // limiting: un token robado no puede probar contraseñas sin freno.
    if (req.method === "POST" && pathname === "/auth/change-password") {
      const user = requireAuth(req);
      const payload = await parseJsonBody(req);
      const rateKey = `chpwd|${user.id}`;
      assertLoginAllowed(rateKey);
      const current = String(payload?.currentPassword ?? "");
      if (!current || !checkPassword(current, user)) {
        registerLoginFailure(rateKey);
        throw new HttpError(401, "La contraseña actual no es correcta.");
      }
      loginAttempts.delete(rateKey);
      Object.assign(user, buildPassword(String(payload?.newPassword ?? "")));
      // Invalida todas las sesiones anteriores y emite un token fresco para
      // que esta sesion continue sin re-login.
      user.tokenVersion = (user.tokenVersion ?? 1) + 1;
      logActivity(user, "Cambió su contraseña");
      user.updatedAt = new Date().toISOString();
      writeUsers();
      const signed = signToken(user);
      sendJson(res, 200, { ok: true, token: signed.token, tokenExpiresAt: signed.expiresAt });
      return;
    }

    // Respaldo del almacen de usuarios (admin): con disco efimero (Render
    // free) users.json se borra en cada reinicio; exportar/importar permite
    // no perder cuentas, claves y usos.
    if (req.method === "GET" && pathname === "/auth/users/backup") {
      requireAuth(req, { adminOnly: true });
      sendJson(res, 200, { ok: true, exportedAt: new Date().toISOString(), users });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/users/restore") {
      requireAuth(req, { adminOnly: true });
      const payload = await parseJsonBody(req);
      const incoming = Array.isArray(payload?.users) ? payload.users : null;
      if (!incoming || incoming.length === 0) {
        throw new HttpError(400, "El respaldo debe incluir un arreglo 'users' con al menos un usuario.");
      }
      const shapeOk = incoming.every((u) => u && typeof u === "object"
        && u.id && u.emailLower && u.passwordHash && u.passwordSalt);
      if (!shapeOk) {
        throw new HttpError(400, "El respaldo tiene un formato invalido (faltan campos de usuario).");
      }
      users = incoming;
      writeUsers();
      // Garantiza que el admin de ADMIN_EMAIL/ADMIN_PASSWORD siga entrando
      // aunque el respaldo venga de otro entorno.
      ensureBootstrapAdmin();
      sendJson(res, 200, { ok: true, restored: users.length });
      return;
    }

    if (req.method === "GET" && pathname === "/auth/users") {
      requireAuth(req, { adminOnly: true });
      const list = [...users]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((item) => ({ ...sanitizeUser(item), activity: (item.activity ?? []).slice(0, 20) }));
      sendJson(res, 200, { ok: true, users: list });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/users") {
      requireAuth(req, { adminOnly: true });
      const payload = await parseJsonBody(req);
      const user = createUser({
        email: payload?.email,
        password: payload?.password,
        role: payload?.role ?? "user",
        status: payload?.status ?? "active",
        plan: payload?.plan ?? "pro",
        subscriptionEndsAt: payload?.subscriptionEndsAt,
        subscriptionDays: payload?.subscriptionDays,
        formsUses: payload?.formsUses,
      });
      sendJson(res, 201, { ok: true, user: sanitizeUser(user) });
      return;
    }

    // Revocar la clave de API de un usuario (admin): la extension del usuario
    // deja de validar de inmediato.
    const userApiKeyRoute = pathname.match(/^\/auth\/users\/([0-9a-fA-F-]+)\/api-key$/);
    if (userApiKeyRoute && req.method === "DELETE") {
      requireAuth(req, { adminOnly: true });
      const target = users.find((item) => item.id === userApiKeyRoute[1]);
      if (!target) throw new HttpError(404, "Usuario no encontrado.");
      delete target.apiKeyHash;
      delete target.apiKeyLast4;
      delete target.apiKeyCreatedAt;
      target.updatedAt = new Date().toISOString();
      logActivity(target, "Clave de API revocada por el administrador");
      writeUsers();
      sendJson(res, 200, { ok: true, user: sanitizeUser(target) });
      return;
    }

    const authUserRoute = pathname.match(/^\/auth\/users\/([0-9a-fA-F-]+)$/);
    if (authUserRoute && req.method === "PATCH") {
      const admin = requireAuth(req, { adminOnly: true });
      const targetId = authUserRoute[1];
      const target = users.find((item) => item.id === targetId);
      if (!target) throw new HttpError(404, "Usuario no encontrado.");

      const payload = await parseJsonBody(req);
      if (target.id === admin.id) {
        if (payload?.status === "disabled") {
          throw new HttpError(400, "No puedes desactivar tu propio usuario.");
        }
        if (payload?.role !== undefined && payload.role !== "admin") {
          throw new HttpError(400, "No puedes cambiar tu propio rol de administrador.");
        }
      }

      const updated = patchUser(target, payload ?? {});
      // Historial: que cambio el admin en esta cuenta.
      const cambios = [];
      if (payload?.subscriptionDaysDelta !== undefined) cambios.push(`recarga de ${payload.subscriptionDaysDelta} días`);
      if (payload?.subscriptionDays !== undefined) cambios.push(`suscripción fijada en ${payload.subscriptionDays} días`);
      if (payload?.subscriptionEndsAt !== undefined) cambios.push("vencimiento de suscripción ajustado");
      if (payload?.formsUsesDelta !== undefined) cambios.push(`recarga de ${payload.formsUsesDelta} usos de Forms`);
      if (payload?.formsUses !== undefined) cambios.push(`usos de Forms fijados en ${payload.formsUses}`);
      if (payload?.password !== undefined) cambios.push("contraseña restablecida");
      if (payload?.role !== undefined) cambios.push(`rol cambiado a ${payload.role}`);
      if (payload?.plan !== undefined) cambios.push(`plan cambiado a ${payload.plan}`);
      if (payload?.status !== undefined) cambios.push(payload.status === "active" ? "cuenta activada" : "cuenta desactivada");
      if (payload?.email !== undefined) cambios.push("email actualizado");
      if (cambios.length > 0) logActivity(updated, `Admin: ${cambios.join(", ")}`);
      const idx = users.findIndex((item) => item.id === target.id);
      users[idx] = updated;
      writeUsers();
      sendJson(res, 200, { ok: true, user: sanitizeUser(updated) });
      return;
    }

    if (authUserRoute && req.method === "DELETE") {
      const admin = requireAuth(req, { adminOnly: true });
      const targetId = authUserRoute[1];
      if (targetId === admin.id) {
        throw new HttpError(400, "No puedes eliminar tu propio usuario admin.");
      }
      const target = users.find((item) => item.id === targetId);
      if (!target) throw new HttpError(404, "Usuario no encontrado.");
      users = users.filter((item) => item.id !== targetId);
      writeUsers();
      sendJson(res, 200, { ok: true });
      return;
    }

    // Limites del generador (el Excel se construye por codigo, sin plantilla).
    if (req.method === "GET" && pathname === "/template-info") {
      requireAuth(req);
      sendJson(res, 200, {
        ok: true,
        maxMuestra: MAX_MUESTRA,
        maxItemsV1: MAX_ITEMS_POR_VARIABLE,
        maxItemsV2: MAX_ITEMS_POR_VARIABLE,
        baseCapacity: MAX_MUESTRA,
        temas: Object.entries(CHART_THEMES).map(([id, t]) => ({ id, nombre: t.nombre, colores: t.colores })),
        nivelesCorrelacion: Object.entries(NIVELES_CORRELACION)
          .map(([id, n]) => ({ id, etiqueta: n.etiqueta, min: n.min, max: n.max })),
        nivelesAlfa: Object.entries(NIVELES_ALFA)
          .map(([id, n]) => ({ id, etiqueta: n.etiqueta, min: n.min, max: n.max })),
      });
      return;
    }

    // Generar Excel exige suscripcion vigente (Tabulacion va por dias; el
    // resto de la cuenta, incluido Forms por usos, no depende de los dias).
    if (req.method === "POST" && pathname === "/generate") {
      const authUser = requireAuth(req, { requireSubscription: true });
      const payload = await parseJsonBody(req);
      const config = payload?.config && typeof payload.config === "object"
        ? payload.config
        : payload;

      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new HttpError(400, "Debes enviar una configuracion valida (objeto JSON).");
      }

      const artifacts = await generateArtifacts(config);
      const responseMode = String(payload?.responseMode ?? "links").toLowerCase();
      registerGeneration(authUser, "Generó un Excel");

      if (responseMode === "inline") {
        sendJson(res, 200, {
          correlation: artifacts.correlation,
          correlationControl: artifacts.correlationControl ?? null,
          quasiExperimental: artifacts.quasiExperimental ?? null,
          diseno: artifacts.diseno ?? "correlacional",
          warnings: artifacts.warnings ?? [],
          baseCsv: artifacts.baseCsv,
          excelBase64: artifacts.excelBuffer.toString("base64"),
          excelFileName: "Tabulacion_generada.xlsx",
          chartsPreview: artifacts.chartsPreview ?? [],
          tema: artifacts.tema ?? "clasico",
        });
        return;
      }

      const id = crypto.randomUUID();
      const expiresAt = Date.now() + ttlMs;
      results.set(id, {
        createdAt: Date.now(),
        expiresAt,
        ownerUserId: authUser.id,
        correlation: artifacts.correlation,
        baseCsv: artifacts.baseCsv,
        excelBuffer: artifacts.excelBuffer,
      });

      const baseUrl = getBaseUrl(req);
      sendJson(res, 200, {
        id,
        correlation: artifacts.correlation,
        warnings: artifacts.warnings ?? [],
        expiresAt: new Date(expiresAt).toISOString(),
        links: {
          meta: `${baseUrl}/results/${id}`,
          xlsx: `${baseUrl}/results/${id}/xlsx`,
          csv: `${baseUrl}/results/${id}/csv`,
        },
      });
      return;
    }

    // Prueba de confiabilidad (Alfa de Cronbach): un solo Excel de una hoja
    // con datos simulados. Forma parte de Tabulacion, por eso exige la misma
    // suscripcion vigente que /generate.
    if (req.method === "POST" && pathname === "/cronbach") {
      const authUser = requireAuth(req, { requireSubscription: true });
      const payload = await parseJsonBody(req);
      const config = payload?.config && typeof payload.config === "object"
        ? payload.config
        : payload;
      const result = await generateCronbach(config);
      registerGeneration(authUser, `Generó una prueba de confiabilidad (α = ${result.alpha.toFixed(3)})`);

      sendJson(res, 200, {
        ok: true,
        alpha: result.alpha,
        cumple: result.cumple,
        nivel: result.nivel,
        etiqueta: result.etiqueta,
        esperadoMin: result.esperadoMin,
        esperadoMax: result.esperadoMax,
        K: result.K,
        encuestados: result.encuestados,
        variable: result.variable,
        warnings: result.warnings,
        excelBase64: result.excelBuffer.toString("base64"),
        excelFileName: "Alfa_Cronbach.xlsx",
      });
      return;
    }

    // ── Tabulacion Descriptiva (IA) ─────────────────────────────────────────
    // Info de limites para el frontend (defaults de N y niveles).
    if (req.method === "GET" && pathname === "/descriptiva/info") {
      requireAuth(req);
      sendJson(res, 200, {
        ok: true,
        defaultN: DESCRIPTIVA_DEFAULT_N,
        minN: DESCRIPTIVA_MIN_N,
        maxN: DESCRIPTIVA_MAX_N,
        niveles: NIVELES_PREPONDERANCIA,
      });
      return;
    }

    // Crea el job: valida el input de inmediato (errores claros para el
    // usuario) y deja la llamada a la IA corriendo en segundo plano.
    if (req.method === "POST" && pathname === "/descriptiva") {
      const authUser = requireAuth(req, { requireSubscription: true });
      const payload = await parseJsonBody(req);

      let input;
      try {
        input = normalizeDescriptivaInput(payload);
        if (input.docxBase64) {
          // La conversion es rapida y sus errores le sirven al usuario
          // ("no es un Word valido"); se resuelve antes de crear el job.
          input = { ...input, texto: await docxToMarkdown(input.docxBase64), docxBase64: "" };
        }
        // Validar aqui (no dentro del job): el usuario recibe el mensaje
        // accionable como 400 inmediato, no el error generico del polling.
        if (input.texto.trim().length < 30) {
          throw new Error("El cuestionario es demasiado corto; pega el instrumento completo.");
        }
      } catch (err) {
        throw new HttpError(400, err.message);
      }

      const active = [...descriptivaJobs.values()].filter(isDescriptivaJobActive);
      if (active.some((j) => j.ownerUserId === authUser.id)) {
        throw new HttpError(409, "Ya tienes una generacion en curso; espera a que termine.");
      }
      if (active.length >= DESCRIPTIVA_MAX_CONCURRENT) {
        throw new HttpError(429, "El servidor esta ocupado generando otras bases; intenta en un par de minutos.");
      }

      const id = crypto.randomUUID();
      const job = {
        id,
        ownerUserId: authUser.id,
        status: "processing",
        createdAt: Date.now(),
        expiresAt: Date.now() + DESCRIPTIVA_JOB_TTL_MS,
        result: null,
        warnings: [],
        error: null,
      };
      descriptivaJobs.set(id, job);

      generateDescriptiva({ texto: input.texto, config: { n: input.n, nivel: input.nivel } })
        .then((generated) => {
          job.result = generated;
          job.warnings = generated.warnings;
          job.status = "done";
          job.expiresAt = Date.now() + DESCRIPTIVA_DONE_TTL_MS;
          // El registro de metricas nunca debe voltear un job exitoso a
          // error (writeUsers toca disco y puede fallar).
          try {
            registerGeneration(authUser, "Generó una tabulación descriptiva");
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[descriptiva] job ${id}: no se pudo registrar la generacion:`, err);
          }
        })
        .catch((err) => {
          // El detalle tecnico queda solo en el log del servidor.
          // eslint-disable-next-line no-console
          console.error(`[descriptiva] job ${id} fallo:`, err);
          job.status = "error";
          job.error = "Hubo un problema generando tu base de datos, intenta de nuevo.";
          job.expiresAt = Date.now() + DESCRIPTIVA_DONE_TTL_MS;
        });

      sendJson(res, 202, { ok: true, jobId: id, status: job.status });
      return;
    }

    // Polling del job; al completar entrega el Excel en base64.
    const descriptivaJobRoute = pathname.match(/^\/descriptiva\/jobs\/([0-9a-fA-F-]+)$/);
    if (req.method === "GET" && descriptivaJobRoute) {
      const authUser = requireAuth(req);
      const job = descriptivaJobs.get(descriptivaJobRoute[1]);
      if (!job || (job.expiresAt <= Date.now() && job.status !== "processing")) {
        throw new HttpError(404, "Generacion no encontrada o expirada.");
      }
      if (AUTH_REQUIRED && authUser.role !== "admin" && job.ownerUserId !== authUser.id) {
        throw new HttpError(403, "No tienes acceso a esta generacion.");
      }
      if (job.status === "done") {
        sendJson(res, 200, {
          ok: true,
          status: "done",
          warnings: job.warnings,
          resumen: job.result.resumen,
          excelBase64: job.result.excelBuffer.toString("base64"),
          excelFileName: "Tabulacion_descriptiva.xlsx",
        });
        // Ya entregado: acortar la vida del buffer en memoria (el cliente
        // aun puede re-consultar un par de minutos, p. ej. tras un remount).
        job.expiresAt = Math.min(job.expiresAt, Date.now() + DESCRIPTIVA_SERVED_TTL_MS);
        return;
      }
      sendJson(res, 200, { ok: true, status: job.status, error: job.error });
      return;
    }

    // ── Generador de Titulos de Investigacion (IA) ──────────────────────────
    // Formulario de una sola pantalla (NO chat): valida el input de inmediato
    // (errores claros para el usuario) y deja la llamada a la IA (con
    // busqueda web) corriendo en segundo plano.
    if (req.method === "POST" && pathname === "/titulos") {
      const authUser = requireAuth(req, { requireSubscription: true });
      const payload = await parseJsonBody(req);

      let input;
      try {
        input = normalizeTitulosInput(payload);
      } catch (err) {
        throw new HttpError(400, err.message);
      }

      const active = [...titulosJobs.values()].filter(isTitulosJobActive);
      if (active.some((j) => j.ownerUserId === authUser.id)) {
        throw new HttpError(409, "Ya tienes una generacion de titulos en curso; espera a que termine.");
      }
      if (active.length >= TITULOS_MAX_CONCURRENT) {
        throw new HttpError(429, "El servidor esta ocupado generando otros titulos; intenta en un par de minutos.");
      }

      const id = crypto.randomUUID();
      const job = {
        id,
        ownerUserId: authUser.id,
        status: "processing",
        createdAt: Date.now(),
        expiresAt: Date.now() + TITULOS_JOB_TTL_MS,
        result: null,
        error: null,
      };
      titulosJobs.set(id, job);

      generateTitulos(input)
        .then((generated) => {
          job.result = generated;
          job.status = "done";
          job.expiresAt = Date.now() + TITULOS_DONE_TTL_MS;
          // El registro de metricas nunca debe voltear un job exitoso a
          // error (writeUsers toca disco y puede fallar).
          try {
            registerGeneration(authUser, "Generó títulos de investigación");
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[titulos] job ${id}: no se pudo registrar la generacion:`, err);
          }
        })
        .catch((err) => {
          // El detalle tecnico queda solo en el log del servidor.
          // eslint-disable-next-line no-console
          console.error(`[titulos] job ${id} fallo:`, err);
          job.status = "error";
          job.error = "Hubo un problema generando tus títulos, intenta de nuevo.";
          job.expiresAt = Date.now() + TITULOS_DONE_TTL_MS;
        });

      sendJson(res, 202, { ok: true, jobId: id, status: job.status });
      return;
    }

    // Polling del job; al completar entrega el markdown con los 3 titulos.
    const titulosJobRoute = pathname.match(/^\/titulos\/jobs\/([0-9a-fA-F-]+)$/);
    if (req.method === "GET" && titulosJobRoute) {
      const authUser = requireAuth(req);
      const job = titulosJobs.get(titulosJobRoute[1]);
      if (!job || (job.expiresAt <= Date.now() && job.status !== "processing")) {
        throw new HttpError(404, "Generacion no encontrada o expirada.");
      }
      if (AUTH_REQUIRED && authUser.role !== "admin" && job.ownerUserId !== authUser.id) {
        throw new HttpError(403, "No tienes acceso a esta generacion.");
      }
      if (job.status === "done") {
        sendJson(res, 200, {
          ok: true,
          status: "done",
          contenido: job.result.contenido,
          webSearchRequests: job.result.webSearchRequests ?? null,
          docxBase64: job.result.docxBuffer.toString("base64"),
          docxFileName: "Titulos_de_investigacion.docx",
        });
        // Ya entregado: acortar la vida del contenido en memoria (el cliente
        // aun puede re-consultar un par de minutos, p. ej. tras un remount).
        job.expiresAt = Math.min(job.expiresAt, Date.now() + TITULOS_SERVED_TTL_MS);
        return;
      }
      sendJson(res, 200, { ok: true, status: job.status, error: job.error });
      return;
    }

    // ── Matriz de Consistencia (IA) ─────────────────────────────────────────
    // Formulario de una sola pantalla: titulo obligatorio + campos opcionales.
    // Valida el input de inmediato y deja la generacion (analisis + busqueda
    // de dimensiones + redaccion) corriendo en segundo plano.
    if (req.method === "POST" && pathname === "/matriz") {
      const authUser = requireAuth(req, { requireSubscription: true });
      const payload = await parseJsonBody(req);

      let input;
      try {
        input = normalizeMatrizInput(payload);
      } catch (err) {
        throw new HttpError(400, err.message);
      }

      const active = [...matrizJobs.values()].filter(isMatrizJobActive);
      if (active.some((j) => j.ownerUserId === authUser.id)) {
        throw new HttpError(409, "Ya tienes una matriz de consistencia en curso; espera a que termine.");
      }
      if (active.length >= MATRIZ_MAX_CONCURRENT) {
        throw new HttpError(429, "El servidor esta ocupado generando otras matrices; intenta en un par de minutos.");
      }

      const id = crypto.randomUUID();
      const job = {
        id,
        ownerUserId: authUser.id,
        status: "processing",
        createdAt: Date.now(),
        expiresAt: Date.now() + MATRIZ_JOB_TTL_MS,
        result: null,
        error: null,
      };
      matrizJobs.set(id, job);

      generateMatriz(input)
        .then((generated) => {
          job.result = generated;
          job.status = "done";
          job.expiresAt = Date.now() + MATRIZ_DONE_TTL_MS;
          // El registro de metricas nunca debe voltear un job exitoso a
          // error (writeUsers toca disco y puede fallar).
          try {
            registerGeneration(authUser, "Generó matriz de consistencia");
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[matriz] job ${id}: no se pudo registrar la generacion:`, err);
          }
        })
        .catch((err) => {
          // El detalle tecnico queda solo en el log del servidor.
          // eslint-disable-next-line no-console
          console.error(`[matriz] job ${id} fallo:`, err);
          job.status = "error";
          job.error = "Hubo un problema generando tu matriz de consistencia, intenta de nuevo.";
          job.expiresAt = Date.now() + MATRIZ_DONE_TTL_MS;
        });

      sendJson(res, 202, { ok: true, jobId: id, status: job.status });
      return;
    }

    // Polling del job; al completar entrega la matriz en JSON + el Word.
    const matrizJobRoute = pathname.match(/^\/matriz\/jobs\/([0-9a-fA-F-]+)$/);
    if (req.method === "GET" && matrizJobRoute) {
      const authUser = requireAuth(req);
      const job = matrizJobs.get(matrizJobRoute[1]);
      if (!job || (job.expiresAt <= Date.now() && job.status !== "processing")) {
        throw new HttpError(404, "Generacion no encontrada o expirada.");
      }
      if (AUTH_REQUIRED && authUser.role !== "admin" && job.ownerUserId !== authUser.id) {
        throw new HttpError(403, "No tienes acceso a esta generacion.");
      }
      if (job.status === "done") {
        sendJson(res, 200, {
          ok: true,
          status: "done",
          matriz: job.result.matriz,
          webSearchRequests: job.result.webSearchRequests ?? null,
          docxBase64: job.result.docxBuffer.toString("base64"),
          docxFileName: "Matriz_de_consistencia.docx",
        });
        // Ya entregado: acortar la vida del contenido en memoria (el cliente
        // aun puede re-consultar un par de minutos, p. ej. tras un remount).
        job.expiresAt = Math.min(job.expiresAt, Date.now() + MATRIZ_SERVED_TTL_MS);
        return;
      }
      sendJson(res, 200, { ok: true, status: job.status, error: job.error });
      return;
    }

    // ── Humanizador de texto academico (IA) ─────────────────────────────────
    // Texto pegado o .docx; el limite de 50-3000 palabras del .docx se valida
    // DENTRO del job (la conversion es async) y llega como error de usuario.
    if (req.method === "POST" && pathname === "/humanizador") {
      const authUser = requireAuth(req, { requireSubscription: true });
      const payload = await parseJsonBody(req);

      let input;
      try {
        input = normalizeHumanizadorInput(payload);
      } catch (err) {
        throw new HttpError(400, err.message);
      }

      const active = [...humanizadorJobs.values()].filter(isHumanizadorJobActive);
      if (active.some((j) => j.ownerUserId === authUser.id)) {
        throw new HttpError(409, "Ya tienes una humanización en curso; espera a que termine.");
      }
      if (active.length >= HUMANIZADOR_MAX_CONCURRENT) {
        throw new HttpError(429, "El servidor esta ocupado humanizando otros textos; intenta en un par de minutos.");
      }

      const id = crypto.randomUUID();
      const job = {
        id,
        ownerUserId: authUser.id,
        status: "processing",
        createdAt: Date.now(),
        expiresAt: Date.now() + HUMANIZADOR_JOB_TTL_MS,
        result: null,
        error: null,
      };
      humanizadorJobs.set(id, job);

      generateHumanizacion(input)
        .then((generated) => {
          job.result = generated;
          job.status = "done";
          job.expiresAt = Date.now() + HUMANIZADOR_DONE_TTL_MS;
          // El registro de metricas nunca debe voltear un job exitoso a
          // error (writeUsers toca disco y puede fallar).
          try {
            registerGeneration(authUser, "Humanizó texto académico");
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[humanizador] job ${id}: no se pudo registrar la generacion:`, err);
          }
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[humanizador] job ${id} fallo:`, err);
          job.status = "error";
          // Las validaciones de entrada detectadas dentro del job (p. ej. el
          // conteo de palabras del .docx) SI se muestran al usuario; el
          // detalle de errores tecnicos queda solo en el log.
          job.error = err?.isUserError
            ? err.message
            : "Hubo un problema humanizando tu texto, intenta de nuevo.";
          job.expiresAt = Date.now() + HUMANIZADOR_DONE_TTL_MS;
        });

      sendJson(res, 202, { ok: true, jobId: id, status: job.status });
      return;
    }

    // Polling del job; al completar entrega el texto + metricas + Word.
    const humanizadorJobRoute = pathname.match(/^\/humanizador\/jobs\/([0-9a-fA-F-]+)$/);
    if (req.method === "GET" && humanizadorJobRoute) {
      const authUser = requireAuth(req);
      const job = humanizadorJobs.get(humanizadorJobRoute[1]);
      if (!job || (job.expiresAt <= Date.now() && job.status !== "processing")) {
        throw new HttpError(404, "Generacion no encontrada o expirada.");
      }
      if (AUTH_REQUIRED && authUser.role !== "admin" && job.ownerUserId !== authUser.id) {
        throw new HttpError(403, "No tienes acceso a esta generacion.");
      }
      if (job.status === "done") {
        sendJson(res, 200, {
          ok: true,
          status: "done",
          textoHumanizado: job.result.textoHumanizado,
          metricas: job.result.metricas,
          docxBase64: job.result.docxBuffer.toString("base64"),
          docxFileName: "Texto_humanizado.docx",
        });
        // Ya entregado: acortar la vida del contenido en memoria.
        job.expiresAt = Math.min(job.expiresAt, Date.now() + HUMANIZADOR_SERVED_TTL_MS);
        return;
      }
      sendJson(res, 200, { ok: true, status: job.status, error: job.error });
      return;
    }

    const resultRoute = pathname.match(/^\/results\/([0-9a-fA-F-]+)(?:\/(xlsx|csv))?$/);
    if (resultRoute) {
      const authUser = requireAuth(req);
      const id = resultRoute[1];
      const fileType = resultRoute[2] ?? "meta";
      const item = getStoredResult(id);

      if (!canAccessResult(authUser, item)) {
        throw new HttpError(403, "No tienes acceso a este resultado.");
      }

      if (req.method === "DELETE" && fileType === "meta") {
        results.delete(id);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === "GET" && fileType === "meta") {
        sendJson(res, 200, {
          id,
          correlation: item.correlation,
          expiresAt: new Date(item.expiresAt).toISOString(),
          size: {
            xlsxBytes: item.excelBuffer.length,
            csvBytes: Buffer.byteLength(item.baseCsv, "utf-8"),
          },
        });
        return;
      }

      if (req.method === "GET" && fileType === "xlsx") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="Tabulacion_generada.xlsx"');
        res.end(item.excelBuffer);
        return;
      }

      if (req.method === "GET" && fileType === "csv") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="Tabulacion_base.csv"');
        res.end(item.baseCsv);
        return;
      }
    }

    throw new HttpError(404, "Ruta no encontrada.");
  } catch (err) {
    const statusCode = err instanceof HttpError ? err.statusCode : 500;
    sendJson(res, statusCode, {
      ok: false,
      error: err instanceof Error ? err.message : "Error no controlado.",
    });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API lista en puerto ${PORT} | generador por codigo (sin plantilla)`);
});
