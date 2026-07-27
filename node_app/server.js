import crypto from "crypto";
import http from "http";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  ITEMS_EQUIVALENTES_POR_VARIABLE_EXTRA,
  PRESUPUESTO_MAXIMO,
} from "./lib/presupuesto.js";
import {
  CHART_THEMES,
  MAX_ITEMS_POR_VARIABLE,
  MAX_MUESTRA,
  NIVELES_ALFA,
  NIVELES_CORRELACION,
} from "./generator.js";
// La generacion del Excel corre en un hilo aparte: es CPU pura y sincrona, y
// en el hilo principal congelaba el servidor entero mientras duraba.
import { GenerationBusyError, runGeneration } from "./lib/generation/run.js";
import {
  addPendingUse,
  clearPendingUse,
  drainPendingUses,
  initPendingUses,
} from "./lib/pending-uses.js";
// Persistencia del almacen de usuarios: Postgres si hay DATABASE_URL, archivo
// JSON si no. En el plan gratis de Render el disco es efimero y cada deploy
// borraba todas las cuentas con sus usos y sus claves.
import { closeStore, flushStore, initStore, persistUsers } from "./lib/store/index.js";
import { googleClientId, googleEnabled, verifyGoogleIdToken } from "./lib/google-auth.js";
// Proyecto de tesis: el instrumento se define UNA vez aqui y lo reutilizan las
// herramientas, en vez de re-escribirlo en cada una.
import {
  aplicarCambios,
  crearProyecto,
  esErrorDeUsuario,
  limiteDelPlan,
  marcarPaso,
} from "./lib/proyectos/index.js";
import {
  borrarProyecto,
  borrarProyectosDeUsuario,
  contarProyectos,
  crearProyectoSiCabe,
  guardarProyecto,
  initProyectos,
  listarProyectos,
  obtenerProyecto,
} from "./lib/proyectos/store.js";
import {
  COOLDOWN_DAYS,
  initDeletedAccounts,
  recordDeletedAccount,
  wasRecentlyDeleted,
} from "./lib/deleted-accounts.js";
import {
  DEFAULT_N as DESCRIPTIVA_DEFAULT_N,
  MAX_N as DESCRIPTIVA_MAX_N,
  MIN_N as DESCRIPTIVA_MIN_N,
  NIVELES_PREPONDERANCIA,
  generateDescriptiva,
  normalizeDescriptivaInput,
} from "./lib/descriptiva/index.js";
import { docxToMarkdown } from "./lib/descriptiva/docx.js";
import { extraerTitulos, generateTitulos, normalizeTitulosInput } from "./lib/titulos/index.js";
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
// Tope adicional por IP a secas: sin el, rotando el email cada intento se
// evita por completo el limite anterior (relleno de credenciales). Mas alto
// que el de IP+email porque varias personas legitimas pueden compartir IP.
const LOGIN_MAX_ATTEMPTS_PER_IP = Number.parseInt(process.env.LOGIN_MAX_ATTEMPTS_PER_IP ?? "20", 10);
const LOGIN_WINDOW_MS = Number.parseInt(process.env.LOGIN_WINDOW_SECONDS ?? "900", 10) * 1000;

// ── Auto-registro (plan gratuito) ───────────────────────────────────────────
// Se puede apagar sin tocar codigo si hiciera falta cerrar el registro.
const REGISTRATION_ENABLED = !new Set(["0", "false", "no", "off"])
  .has(String(process.env.REGISTRATION_ENABLED ?? "true").trim().toLowerCase());
// Cuentas nuevas por IP. La ventana es larga (24 h por defecto) a proposito:
// con una ventana corta se pueden crear cuentas en tandas indefinidamente.
const REGISTER_MAX_PER_IP = Number.parseInt(process.env.REGISTER_MAX_PER_IP ?? "3", 10);
const REGISTER_WINDOW_MS = Number.parseInt(process.env.REGISTER_WINDOW_SECONDS ?? "86400", 10) * 1000;
const REGISTER_PLAN = String(process.env.REGISTER_PLAN ?? "free").trim() || "free";

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

// Cabeceras de seguridad de la API. No habia ninguna: nada impedia enmarcar
// las respuestas, adivinar tipos de contenido ni filtrar la URL completa como
// referente hacia terceros.
const setSecurityHeaders = (res) => {
  // Una API JSON no carga recursos de ningun tipo.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // HSTS solo tiene sentido servido por HTTPS; en Render lo esta. En local
  // (http) el navegador la ignora, asi que no estorba al desarrollo.
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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

// Validacion deliberadamente laxa: sirve para atajar erratas obvias, no para
// decidir si un correo existe (eso solo lo prueba enviarle un mensaje).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

// ── Usos por herramienta ─────────────────────────────────────────────────────
// Todo el acceso funciona por usos (1 uso = 1 generacion/corrida). El admin
// recarga cada herramienta por separado; los admins tienen usos ilimitados.
const USE_TOOLS = ["tabulacion", "confiabilidad", "descriptiva", "titulos", "matriz", "humanizador", "forms"];
const TOOL_LABELS = {
  tabulacion: "Tabulación",
  confiabilidad: "Confiabilidad",
  descriptiva: "Descriptiva",
  titulos: "Generador de Títulos",
  matriz: "Matriz de Consistencia",
  humanizador: "Humanizador",
  forms: "Forms",
};

// Cuotas iniciales por plan al crear un usuario (el admin puede ajustar cada
// herramienta despues). Institucion usa la cuota Tesista por cuenta.
const PLAN_PRESETS = {
  // Plan gratuito del auto-registro. Las cuotas siguen el costo REAL de cada
  // herramienta, no un numero parejo:
  //   - tabulacion y confiabilidad no usan IA (el Excel se construye por
  //     codigo): solo cuestan CPU, asi que se pueden regalar.
  //   - humanizador es la IA mas barata (sin busqueda web, textos cortos): un
  //     uso alcanza para que el usuario vea la calidad.
  //   - descriptiva, titulos y matriz cuestan dinero de verdad por generacion
  //     (titulos ademas paga busqueda web): quedan en 0 y son el gancho de pago.
  // Con 0 usos de IA, crearse cuentas de mas no le cuesta dinero al servicio.
  free: { tabulacion: 2, confiabilidad: 2, descriptiva: 0, titulos: 0, matriz: 0, humanizador: 1, forms: 0 },
  esencial: { tabulacion: 2, confiabilidad: 2, descriptiva: 3, titulos: 3, matriz: 1, humanizador: 5, forms: 2 },
  tesista: { tabulacion: 10, confiabilidad: 10, descriptiva: 10, titulos: 10, matriz: 5, humanizador: 30, forms: 10 },
  institucion: { tabulacion: 10, confiabilidad: 10, descriptiva: 10, titulos: 10, matriz: 5, humanizador: 30, forms: 10 },
};

// Cuota inicial de una cuenta nueva. Quien borro su cuenta hace poco vuelve a
// entrar SIN cuota de cortesia: si no, bastaria con borrarse y registrarse otra
// vez para tener usos gratuitos infinitos (ver lib/deleted-accounts.js).
// `undefined` deja que createUser aplique el preset del plan.
const usesForNewAccount = (emailLower) => (
  wasRecentlyDeleted(emailLower)
    ? Object.fromEntries(USE_TOOLS.map((tool) => [tool, 0]))
    : undefined
);

// Garantiza user.uses/usesConsumed completos; migra el legado de Forms
// (formsUsesLeft/formsUsesUsed) y mantiene esos campos como espejo para la
// extension y datos antiguos.
const normalizeUses = (user) => {
  const src = user.uses && typeof user.uses === "object" ? user.uses : {};
  const consumedSrc = user.usesConsumed && typeof user.usesConsumed === "object" ? user.usesConsumed : {};
  const uses = {};
  const consumed = {};
  for (const tool of USE_TOOLS) {
    let left = Number(src[tool]);
    if (!Number.isFinite(left) || left < 0) {
      left = tool === "forms" && Number.isFinite(Number(user.formsUsesLeft))
        ? Math.max(0, Math.floor(Number(user.formsUsesLeft)))
        : 0;
    }
    uses[tool] = Math.floor(left);
    let used = Number(consumedSrc[tool]);
    if (!Number.isFinite(used) || used < 0) {
      used = tool === "forms" && Number.isFinite(Number(user.formsUsesUsed))
        ? Math.max(0, Math.floor(Number(user.formsUsesUsed)))
        : 0;
    }
    consumed[tool] = Math.floor(used);
  }
  user.uses = uses;
  user.usesConsumed = consumed;
  user.formsUsesLeft = uses.forms;
  user.formsUsesUsed = consumed.forms;
  return user;
};

const usesLeftOf = (owner, tool) => (
  owner.role === "admin" ? null : (normalizeUses(owner).uses[tool] ?? 0)
);

// Descuenta 1 uso o lanza 403. En modo dev sin store (AUTH_REQUIRED=false) el
// usuario sintetico no existe en users: acceso ilimitado.
const consumeUse = (authUser, tool) => {
  const owner = users.find((item) => item.id === authUser.id);
  if (!owner) return null;
  if (owner.role === "admin") return null;
  normalizeUses(owner);
  const left = owner.uses[tool] ?? 0;
  if (left <= 0) {
    throw new HttpError(403, `No te quedan usos de ${TOOL_LABELS[tool]}. Pide una recarga a tu administrador.`);
  }
  owner.uses[tool] = left - 1;
  owner.usesConsumed[tool] = (owner.usesConsumed[tool] ?? 0) + 1;
  owner.formsUsesLeft = owner.uses.forms;
  owner.formsUsesUsed = owner.usesConsumed.forms;
  // Forms conserva su mensaje historico ("Corrida de Forms") por
  // compatibilidad con el historial existente.
  logActivity(owner, tool === "forms"
    ? `Corrida de Forms (quedan ${owner.uses.forms} usos)`
    : `Uso de ${TOOL_LABELS[tool]} (quedan ${owner.uses[tool]})`);
  owner.updatedAt = new Date().toISOString();
  writeUsers();
  return owner.uses[tool];
};

// Devuelve el uso si el trabajo termino en error (el usuario no recibio nada).
const refundUse = (userId, tool, motivo = "la generación falló") => {
  const owner = users.find((item) => item.id === userId);
  if (!owner || owner.role === "admin") return;
  normalizeUses(owner);
  owner.uses[tool] = (owner.uses[tool] ?? 0) + 1;
  owner.usesConsumed[tool] = Math.max(0, (owner.usesConsumed[tool] ?? 0) - 1);
  owner.formsUsesLeft = owner.uses.forms;
  owner.formsUsesUsed = owner.usesConsumed.forms;
  logActivity(owner, `Uso de ${TOOL_LABELS[tool]} devuelto (${motivo})`);
  owner.updatedAt = new Date().toISOString();
  try {
    writeUsers();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[usos] no se pudo persistir el reembolso de ${tool}:`, err);
  }
};

// ── Usos de jobs de IA: consumo con red de seguridad ────────────────────────
// Los jobs viven en memoria. Anotar en disco el uso descontado permite
// devolverlo si el proceso se reinicia antes de que el job termine.

// Descuenta el uso y lo deja anotado como pendiente. `consumeUse` devuelve
// null cuando no hay a quien cobrarle (admin, o usuario sintetico de
// desarrollo): en ese caso no hay nada que anotar ni que devolver.
const consumeUseForJob = (authUser, tool, jobId) => {
  const left = consumeUse(authUser, tool);
  if (left !== null) addPendingUse(jobId, authUser.id, tool);
  return left;
};

// Cierra el job: si fallo devuelve el uso, y en ambos casos borra la anotacion
// para que el arranque no lo vuelva a reembolsar.
const settleJobUse = (jobId, userId, tool, { refund }) => {
  if (refund) refundUse(userId, tool);
  clearPendingUse(jobId);
};

// Al arrancar: todo uso anotado corresponde a un job que ya no existe (los
// jobs no sobreviven al reinicio), asi que se devuelve.
const recoverPendingUses = () => {
  const pending = drainPendingUses();
  if (pending.length === 0) return;
  for (const item of pending) {
    refundUse(item.userId, item.tool, "el servidor se reinició durante la generación");
  }
  // eslint-disable-next-line no-console
  console.log(`[usos] ${pending.length} uso(s) devuelto(s): quedaron a medias en un reinicio anterior.`);
};

// Limpia un objeto de usos recibido por API: solo herramientas conocidas,
// enteros >= 0.
const cleanUsesPayload = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  let any = false;
  for (const tool of USE_TOOLS) {
    if (raw[tool] === undefined) continue;
    const value = Number(raw[tool]);
    if (!Number.isFinite(value) || value < 0) {
      throw new HttpError(400, `Los usos de ${TOOL_LABELS[tool]} deben ser 0 o más.`);
    }
    out[tool] = Math.floor(value);
    any = true;
  }
  return any ? out : null;
};

// La escritura es diferida (ver lib/store): la memoria es la fuente de verdad
// en caliente y la persistencia sale por detras en una cola ordenada. Se
// mantiene utilizable de forma sincrona a proposito — la llaman decenas de
// sitios, incluido el callback de consumo de usos de Forms, que es sincrono
// por contrato.
//
// Devuelve la promesa del vaciado para quien SI necesite durabilidad antes de
// responder. La regla: si al usuario se le confirma algo que no puede
// reconstruir (su clave de API, su contraseña nueva, la recarga que le hizo el
// admin), hay que `await writeUsers()`. Si no, se ignora el retorno y la
// escritura sale por detras.
//
// Nunca rechaza: los errores se registran dentro de la cola, asi que ignorar
// la promesa no deja rechazos sin capturar.
const writeUsers = () => {
  persistUsers(users);
  return flushStore();
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
  // Usos por herramienta (1 uso = 1 generacion/corrida); admins ilimitados
  // (null). formsUsesLeft se mantiene como espejo para clientes antiguos.
  uses: user.role === "admin" ? null : { ...normalizeUses(user).uses },
  usesConsumed: user.role === "admin" ? {} : { ...user.usesConsumed },
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
  plan = "tesista",
  subscriptionEndsAt,
  subscriptionDays,
  formsUses,
  uses,
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
  const subscriptionDate = toIsoOrNull(subscriptionEndsAt)
    ?? (Number.isFinite(Number(subscriptionDays)) ? addDaysIso(Number(subscriptionDays)) : null);
  const planName = String(plan ?? "").trim() || "tesista";

  // Usos iniciales: lo que mande el admin > preset del plan > cero. El campo
  // legado formsUses (usos de Forms) se respeta si no vino en `uses`.
  const initialUses = cleanUsesPayload(uses)
    ?? (PLAN_PRESETS[planName] ? { ...PLAN_PRESETS[planName] } : {});
  if (Number.isFinite(Number(formsUses)) && Number(formsUses) >= 0) {
    initialUses.forms = Math.floor(Number(formsUses));
  }

  const user = {
    id: crypto.randomUUID(),
    email: String(email).trim(),
    emailLower: normalizedEmail,
    role,
    status,
    plan: planName,
    subscriptionEndsAt: subscriptionDate,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastLoginAt: null,
    uses: initialUses,
    usesConsumed: {},
    generationsCount: 0,
    lastGenerationAt: null,
    activity: [],
    tokenVersion: 1,
    ...credentials,
  };
  normalizeUses(user);
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
  // Usos por herramienta: valor absoluto (uses) o recarga incremental
  // (usesDelta, puede ser negativa para corregir, sin bajar de 0).
  normalizeUses(next);
  if (payload.uses !== undefined) {
    const absolute = cleanUsesPayload(payload.uses);
    if (absolute) {
      next.uses = { ...next.uses, ...absolute };
    }
  }
  if (payload.usesDelta !== undefined) {
    const deltas = payload.usesDelta;
    if (!deltas || typeof deltas !== "object" || Array.isArray(deltas)) {
      throw new HttpError(400, "usesDelta debe ser un objeto {herramienta: cantidad}.");
    }
    for (const tool of USE_TOOLS) {
      if (deltas[tool] === undefined) continue;
      const delta = Number(deltas[tool]);
      if (!Number.isFinite(delta) || delta === 0) {
        throw new HttpError(400, `usesDelta.${tool} debe ser diferente de 0.`);
      }
      next.uses[tool] = Math.max(0, Math.floor((next.uses[tool] ?? 0) + delta));
    }
  }
  // Campos legados de Forms: siguen funcionando mapeados a uses.forms.
  if (payload.formsUses !== undefined) {
    const uses = Number(payload.formsUses);
    if (!Number.isFinite(uses) || uses < 0) {
      throw new HttpError(400, "formsUses debe ser 0 o mayor.");
    }
    next.uses.forms = Math.floor(uses);
  }
  if (payload.formsUsesDelta !== undefined) {
    const delta = Number(payload.formsUsesDelta);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new HttpError(400, "formsUsesDelta debe ser diferente de 0.");
    }
    next.uses.forms = Math.max(0, Math.floor((next.uses.forms ?? 0) + delta));
  }
  next.formsUsesLeft = next.uses.forms;
  next.formsUsesUsed = next.usesConsumed.forms;

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
  // La sesion solo exige cuenta activa: el acceso a cada herramienta se
  // controla por usos (consumeUse) en su propio endpoint.
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

const assertLoginAllowed = (key, max = LOGIN_MAX_ATTEMPTS) => {
  cleanupLoginAttempts();
  const entry = loginAttempts.get(key);
  if (entry && entry.count >= max) {
    const retryInSec = Math.max(Math.ceil((entry.firstAt + LOGIN_WINDOW_MS - Date.now()) / 1000), 1);
    const err = new HttpError(429, `Demasiados intentos fallidos. Intenta de nuevo en ${retryInSec} segundos.`);
    err.retryAfterSeconds = retryInSec;
    throw err;
  }
};

// El limite por IP+email no frena el ataque real: probando una contraseña
// comun contra MUCHAS cuentas distintas, cada combinacion estrena su propio
// contador y nunca se llega al tope. El limite por IP (mas holgado, para no
// castigar a una universidad o un locutorio detras de un NAT) si lo corta.
//
// Seguro: si no se puede identificar la IP (proxy sin x-forwarded-for), NO se
// aplica este tope. Si no, todas las peticiones compartirian un unico contador
// y 20 fallos en total dejarian fuera a todos los usuarios a la vez. El limite
// por IP+email sigue protegiendo cada cuenta.
const assertLoginAllowedForIp = (ip) => {
  if (!ip || ip === "unknown") return;
  assertLoginAllowed(`ip|${ip}`, LOGIN_MAX_ATTEMPTS_PER_IP);
};

const registerLoginFailure = (key) => {
  const entry = loginAttempts.get(key);
  if (entry) {
    entry.count += 1;
  } else {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() });
  }
};

// ── Limite de registros por IP ──────────────────────────────────────────────
// Mapa propio (no el de login): su ventana es mucho mas larga, y mezclarlos
// haria que la limpieza de login borrara los contadores de registro antes de
// tiempo.
const registerAttempts = new Map();

const assertRegisterAllowed = (ip) => {
  const now = Date.now();
  for (const [key, entry] of registerAttempts.entries()) {
    if (now - entry.firstAt > REGISTER_WINDOW_MS) registerAttempts.delete(key);
  }
  // Sin IP identificable (proxy sin x-forwarded-for) no se aplica: un unico
  // contador compartido bloquearia el registro a todo el mundo a la vez.
  if (!ip || ip === "unknown") return;
  const entry = registerAttempts.get(ip);
  if (entry && entry.count >= REGISTER_MAX_PER_IP) {
    const retryInSec = Math.max(Math.ceil((entry.firstAt + REGISTER_WINDOW_MS - now) / 1000), 1);
    const err = new HttpError(429, "Se alcanzo el limite de cuentas nuevas desde esta conexion. "
      + "Si necesitas otra cuenta, escribenos.");
    err.retryAfterSeconds = retryInSec;
    throw err;
  }
};

const registerRegistration = (ip) => {
  if (!ip || ip === "unknown") return;
  const entry = registerAttempts.get(ip);
  if (entry) entry.count += 1;
  else registerAttempts.set(ip, { count: 1, firstAt: Date.now() });
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

// Arranque. Si la carga del almacen falla se propaga a proposito y el proceso
// no levanta: arrancar con la lista vacia y persistirla despues borraria a
// todos los usuarios.
const cargado = await initStore(USER_STORE_PATH);
users = cargado.usuarios;
initPendingUses(cargado.pendientes);
initDeletedAccounts(cargado.borradas);
await initProyectos(USER_STORE_PATH);
ensureBootstrapAdmin();
recoverPendingUses();
// El admin inicial y los reembolsos deben estar en firme antes de atender.
await flushStore();
setInterval(cleanupExpired, 60_000).unref();

// Forms valida las claves ttab_ en memoria (mismo proceso): lee la lista de
// usuarios viva, sin llamadas HTTP ni secreto compartido.
const findKeyOwner = (apiKey) => {
  const key = String(apiKey || "").trim();
  if (!key.startsWith("ttab_") || key.length < 20) return null;
  return users.find((item) => item.apiKeyHash === hashApiKey(key)) ?? null;
};

// Forms va por usos como todas las herramientas: la clave es valida mientras
// la cuenta este activa; los usos se verifican al consumir.
formsApp.setKeyValidator((apiKey) => {
  const owner = findKeyOwner(apiKey);
  if (!owner) return { valid: false, reason: "clave_desconocida" };
  if (owner.status !== "active") return { valid: false, reason: "usuario_inactivo" };
  return {
    valid: true,
    email: owner.email,
    plan: owner.plan,
    role: owner.role,
    usesLeft: usesLeftOf(owner, "forms"),
  };
});

// 1 uso de Forms = 1 corrida de llenado. El consumo ocurre al crear el job
// (los admins tienen usos ilimitados: usesLeft null).
formsApp.setUsageConsumer((apiKey) => {
  const owner = findKeyOwner(apiKey);
  if (!owner) return { ok: false, reason: "clave_desconocida" };
  if (owner.role === "admin") return { ok: true, usesLeft: null };
  try {
    const left = consumeUse(owner, "forms");
    return { ok: true, usesLeft: left };
  } catch {
    return { ok: false, reason: "sin_usos" };
  }
});

const server = http.createServer(async (req, res) => {
  // Cabeceras de seguridad para TODA la superficie HTTP, incluidas las rutas
  // de Forms (por eso van antes del despacho). La API sirve JSON: no debe
  // cargar nada, no debe poder enmarcarse y su tipo de contenido no debe
  // adivinarse. Las paginas de Forms que si son HTML fijan despues su propia
  // CSP, que sustituye a esta.
  setSecurityHeaders(res);

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

    // Configuracion publica que el frontend necesita ANTES de iniciar sesion:
    // que metodos de acceso ofrecer y que incluye cada plan.
    //
    // Sirve tambien de fuente unica de los planes: estaban duplicados a mano
    // entre este archivo y frontend/src/lib/constants.ts, sincronizados solo
    // por un comentario. El frontend conserva su copia como valor inicial (la
    // pantalla debe pintar sin esperar a la red), pero manda esta.
    //
    // El Client ID de Google es publico por diseño: identifica a la aplicacion
    // ante Google, no autoriza nada por si solo.
    if (req.method === "GET" && pathname === "/config") {
      sendJson(res, 200, {
        ok: true,
        auth: {
          google: googleEnabled ? { enabled: true, clientId: googleClientId } : { enabled: false },
          // Registro por correo: hoy apagado a proposito mientras no haya
          // verificacion por correo (ver REGISTRATION_ENABLED).
          emailRegistration: REGISTRATION_ENABLED,
        },
        planPredeterminado: REGISTER_PLAN,
        herramientas: USE_TOOLS.map((id) => ({ id, label: TOOL_LABELS[id] })),
        planes: PLAN_PRESETS,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      const payload = await parseJsonBody(req);
      const email = normalizeEmail(payload?.email);
      const password = String(payload?.password ?? "");
      const ip = getClientIp(req);
      const rateKey = `${ip}|${email}`;
      assertLoginAllowedForIp(ip);
      assertLoginAllowed(rateKey);
      const user = users.find((item) => item.emailLower === email);
      if (!user || !checkPassword(password, user)) {
        registerLoginFailure(rateKey);
        if (ip && ip !== "unknown") registerLoginFailure(`ip|${ip}`);
        throw new HttpError(401, "Credenciales invalidas.");
      }
      // Solo se limpia el contador de ESTA cuenta. El de la IP se deja correr
      // hasta que expire su ventana: si un login exitoso lo reiniciara, bastaria
      // con entrar a una cuenta propia entre tanda y tanda para probar de nuevo.
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

    // ── Auto-registro (plan gratuito) ───────────────────────────────────────
    // Publico: es lo que permite que alguien pruebe sin que un admin le cree
    // la cuenta a mano. El plan free no incluye usos de las herramientas de IA
    // (ver PLAN_PRESETS), asi que abrir el registro no expone el gasto de
    // OpenRouter a desconocidos.
    if (req.method === "POST" && pathname === "/auth/register") {
      if (!REGISTRATION_ENABLED) {
        throw new HttpError(403, "El registro esta cerrado por el momento.");
      }
      const ip = getClientIp(req);
      assertRegisterAllowed(ip);

      const payload = await parseJsonBody(req);
      const email = String(payload?.email ?? "").trim();
      const password = String(payload?.password ?? "");
      if (!EMAIL_RE.test(email)) {
        throw new HttpError(400, "Escribe un correo valido.");
      }
      if (!isStrongPassword(password)) {
        throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
      }
      // Un email ya registrado responde 409 igual que en el alta de admin. No
      // se disimula: sin verificacion por correo, ocultarlo no aporta nada
      // (quien quiera comprobarlo lo hace igual desde el login) y en cambio
      // deja al usuario sin saber por que no puede entrar.
      const user = createUser({
        email,
        password,
        role: "user",
        status: "active",
        plan: REGISTER_PLAN,
        uses: usesForNewAccount(normalizeEmail(email)),
      });
      registerRegistration(ip);
      logActivity(user, "Se registró desde la web (plan gratuito)");
      // La cuenta debe estar en firme antes de devolver la sesion.
      await writeUsers();

      const signed = signToken(user);
      sendJson(res, 201, {
        ok: true,
        token: signed.token,
        tokenExpiresAt: signed.expiresAt,
        user: sanitizeUser(user),
      });
      return;
    }

    // ── Inicio de sesion / alta con Google ──────────────────────────────────
    // Es el camino de auto-registro recomendado: una cuenta de Google trae el
    // correo YA VERIFICADO, sin necesidad de dominio propio ni de un servicio
    // de envio de correo. Tambien evita el secuestro de cuentas que permitiria
    // un registro por correo sin verificar (alguien se registra con el correo
    // de otro y se queda esperando a que el dueño real entre con Google).
    if (req.method === "POST" && pathname === "/auth/google") {
      if (!googleEnabled) {
        throw new HttpError(503, "El inicio de sesion con Google no esta disponible.");
      }
      const ip = getClientIp(req);
      const payload = await parseJsonBody(req);

      let perfil;
      try {
        perfil = await verifyGoogleIdToken(payload?.credential ?? payload?.idToken);
      } catch (err) {
        throw new HttpError(401, err.message);
      }

      const emailLower = normalizeEmail(perfil.email);
      let user = users.find((item) => item.emailLower === emailLower);
      let creado = false;

      if (!user) {
        // Alta nueva: cuenta el limite por IP, igual que el registro por
        // correo. Que Google verifique el correo no impide que alguien tenga
        // muchas cuentas de Google.
        assertRegisterAllowed(ip);
        user = createUser({
          email: perfil.email,
          // Sin contraseña utilizable: se entra por Google. Es aleatoria y no
          // se le comunica a nadie, en vez de dejar el campo vacio (que haria
          // que checkPassword se comportara de forma imprevisible).
          password: crypto.randomBytes(24).toString("base64url"),
          role: "user",
          status: "active",
          plan: REGISTER_PLAN,
          uses: usesForNewAccount(emailLower),
        });
        registerRegistration(ip);
        creado = true;
        logActivity(user, "Se registró con Google (plan gratuito)");
      } else if (user.status !== "active") {
        throw new HttpError(403, "Usuario inactivo.");
      } else {
        logActivity(user, "Inició sesión con Google");
      }

      // Se guarda el identificador estable de Google (el correo de una cuenta
      // puede cambiar; `sub` no).
      user.googleSub = perfil.sub;
      user.googleLinkedAt ??= new Date().toISOString();
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = user.lastLoginAt;
      // Una cuenta recien creada no puede confirmarse antes de estar en firme.
      await writeUsers();

      const signed = signToken(user);
      sendJson(res, creado ? 201 : 200, {
        ok: true,
        creado,
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

    // ── Eliminar la propia cuenta ───────────────────────────────────────────
    // Requisito, no cortesia: la politica de datos de usuario de Google exige
    // ofrecer la eliminacion de la cuenta a las aplicaciones que usan su inicio
    // de sesion, y el derecho de supresion del RGPD apunta a lo mismo.
    if (req.method === "DELETE" && pathname === "/auth/me") {
      const user = requireAuth(req);
      const payload = await parseJsonBody(req);

      // La confirmacion es escribir el propio correo, NO la contraseña: quien
      // entro con Google tiene una contraseña aleatoria que nunca ha visto, asi
      // que pedirsela dejaria fuera justo al grueso de los usuarios.
      if (normalizeEmail(payload?.confirmEmail) !== user.emailLower) {
        throw new HttpError(400, "Escribe tu correo exactamente como aparece en tu cuenta para confirmar.");
      }
      // El admin no se borra a si mismo: ademas de dejar el sistema sin
      // administrador, el arranque lo recrearia desde ADMIN_EMAIL y la
      // eliminacion seria una ilusion.
      if (user.role === "admin") {
        throw new HttpError(403, "Una cuenta de administrador no puede eliminarse a si misma.");
      }

      // Se anota ANTES de borrar: si el proceso muriera en medio, el peor caso
      // es que la cuenta siga viva pero marcada, no que se regale otra cuota.
      recordDeletedAccount(user.emailLower);

      // Se van tambien los datos que quedaban en memoria a su nombre.
      for (const [id, item] of results.entries()) {
        if (item.ownerUserId === user.id) results.delete(id);
      }
      for (const jobs of [descriptivaJobs, titulosJobs, matrizJobs, humanizadorJobs]) {
        for (const [id, job] of jobs.entries()) {
          if (job.ownerUserId === user.id) {
            jobs.delete(id);
            clearPendingUse(id);
          }
        }
      }

      // Sus proyectos se van con la cuenta: es parte de "eliminar tus datos".
      await borrarProyectosDeUsuario(user.id);
      users = users.filter((item) => item.id !== user.id);
      await writeUsers();
      // eslint-disable-next-line no-console
      console.log(`[cuenta] un usuario elimino su cuenta (quedan ${users.length}).`);
      sendJson(res, 200, {
        ok: true,
        mensaje: "Tu cuenta y tus datos fueron eliminados.",
        // Se dice explicitamente para que no sea una sorpresa desagradable si
        // vuelve a registrarse al dia siguiente.
        avisoCuota: `Si vuelves a registrarte con este correo dentro de ${COOLDOWN_DAYS} días, la cuenta se creará sin usos de cortesía.`,
      });
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
        await writeUsers();
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
        await writeUsers();
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
      // Forms va por usos, igual que el resto de herramientas.
      reply(true, {
        email: owner.email,
        plan: owner.plan,
        role: owner.role,
        subscriptionEndsAt: owner.subscriptionEndsAt,
        usesLeft: usesLeftOf(owner, "forms"),
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
      await writeUsers();
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
      await writeUsers();
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
        plan: payload?.plan ?? "tesista",
        subscriptionEndsAt: payload?.subscriptionEndsAt,
        subscriptionDays: payload?.subscriptionDays,
        formsUses: payload?.formsUses,
        uses: payload?.uses,
      });
      // La cuenta debe estar en firme antes de confirmarla: el admin le pasa
      // esas credenciales al usuario y no puede reconstruirlas.
      await writeUsers();
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
      await writeUsers();
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
      if (payload?.usesDelta && typeof payload.usesDelta === "object") {
        for (const [tool, delta] of Object.entries(payload.usesDelta)) {
          if (TOOL_LABELS[tool]) cambios.push(`recarga de ${delta} usos de ${TOOL_LABELS[tool]}`);
        }
      }
      if (payload?.uses && typeof payload.uses === "object") cambios.push("usos por herramienta ajustados");
      if (payload?.password !== undefined) cambios.push("contraseña restablecida");
      if (payload?.role !== undefined) cambios.push(`rol cambiado a ${payload.role}`);
      if (payload?.plan !== undefined) cambios.push(`plan cambiado a ${payload.plan}`);
      if (payload?.status !== undefined) cambios.push(payload.status === "active" ? "cuenta activada" : "cuenta desactivada");
      if (payload?.email !== undefined) cambios.push("email actualizado");
      if (cambios.length > 0) logActivity(updated, `Admin: ${cambios.join(", ")}`);
      // Se vuelcan los campos SOBRE el objeto que ya vive en `users`, en vez
      // de sustituirlo (`users[idx] = updated`). La diferencia importa: otros
      // handlers conservan una referencia a este objeto mientras esperan el
      // cuerpo de su peticion (`await parseJsonBody`). Al sustituirlo, esa
      // referencia quedaba huerfana y lo que escribieran despues se perdia al
      // persistir — p. ej. un cambio de contraseña que respondia 200 sin haber
      // cambiado nada. `patchUser` sigue validando sobre una copia, asi que un
      // payload invalido no deja al usuario a medio modificar.
      Object.assign(target, updated);
      await writeUsers();
      sendJson(res, 200, { ok: true, user: sanitizeUser(target) });
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
      await writeUsers();
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
        // Presupuesto conjunto: los maximos de arriba siguen siendo los de
        // siempre, pero no todas sus combinaciones caben en la memoria del
        // contenedor. El frontend lo usa para avisar ANTES de gastar un uso;
        // la autoridad final sigue siendo la normalizacion del backend.
        presupuestoMaximo: PRESUPUESTO_MAXIMO,
        itemsEquivalentesPorVariableExtra: ITEMS_EQUIVALENTES_POR_VARIABLE_EXTRA,
        temas: Object.entries(CHART_THEMES).map(([id, t]) => ({ id, nombre: t.nombre, colores: t.colores })),
        nivelesCorrelacion: Object.entries(NIVELES_CORRELACION)
          .map(([id, n]) => ({ id, etiqueta: n.etiqueta, min: n.min, max: n.max })),
        nivelesAlfa: Object.entries(NIVELES_ALFA)
          .map(([id, n]) => ({ id, etiqueta: n.etiqueta, min: n.min, max: n.max })),
      });
      return;
    }

    // Generar Excel consume 1 uso de Tabulación (se devuelve si la
    // generacion falla).
    if (req.method === "POST" && pathname === "/generate") {
      const authUser = requireAuth(req);
      const payload = await parseJsonBody(req);
      const config = payload?.config && typeof payload.config === "object"
        ? payload.config
        : payload;

      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new HttpError(400, "Debes enviar una configuracion valida (objeto JSON).");
      }

      consumeUse(authUser, "tabulacion");
      let artifacts;
      try {
        artifacts = await runGeneration("artifacts", config);
      } catch (err) {
        refundUse(authUser.id, "tabulacion");
        if (err instanceof GenerationBusyError) throw new HttpError(429, err.message);
        throw err;
      }
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
    // con datos simulados. Consume 1 uso de Confiabilidad (se devuelve si
    // la generacion falla).
    if (req.method === "POST" && pathname === "/cronbach") {
      const authUser = requireAuth(req);
      const payload = await parseJsonBody(req);
      const config = payload?.config && typeof payload.config === "object"
        ? payload.config
        : payload;
      consumeUse(authUser, "confiabilidad");
      let result;
      try {
        result = await runGeneration("cronbach", config);
      } catch (err) {
        refundUse(authUser.id, "confiabilidad");
        if (err instanceof GenerationBusyError) throw new HttpError(429, err.message);
        throw err;
      }
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


    // ── Proyectos de tesis ──────────────────────────────────────────────────
    // El instrumento (variables, dimensiones, indicadores, items y escala) se
    // define una sola vez por proyecto. Hoy cada herramienta lo pide de nuevo:
    // esto es lo que lo arregla.
    if (pathname === "/proyectos" && (req.method === "GET" || req.method === "POST")) {
      const user = requireAuth(req);

      if (req.method === "GET") {
        sendJson(res, 200, {
          ok: true,
          proyectos: await listarProyectos(user.id),
          limite: limiteDelPlan(user.plan),
        });
        return;
      }

      const limite = limiteDelPlan(user.plan);
      const limiteMsg = `Tu plan permite ${limite} proyecto(s) a la vez. `
        + "Elimina uno o amplía tu plan para crear otro.";
      // Comprobacion rapida: evita construir y validar el instrumento cuando
      // ya es obvio que no cabe. NO es la que garantiza el limite (ver abajo):
      // entre este await y el de mas adelante el event loop puede atender otra
      // peticion del mismo usuario, y las dos la pasarian igual.
      if (await contarProyectos(user.id) >= limite) {
        throw new HttpError(403, limiteMsg);
      }
      const payload = await parseJsonBody(req);
      let proyecto;
      try {
        proyecto = crearProyecto({
          userId: user.id,
          nombre: payload?.nombre,
          instrumento: payload?.instrumento,
        });
      } catch (err) {
        // Los errores de validacion son del usuario (400); el resto, del
        // servidor. Sin distinguirlos, un nombre vacio devolveria un 500.
        throw new HttpError(esErrorDeUsuario(err) ? 400 : 500, err.message);
      }
      // Esta es la comprobacion que de verdad cuenta: contar y guardar pasan
      // en el mismo tramo atomico (ver lib/proyectos/store.js), asi que dos
      // peticiones concurrentes del mismo usuario no pueden colarse las dos
      // aunque ambas hayan pasado la comprobacion rapida de arriba.
      const creado = await crearProyectoSiCabe(proyecto, limite);
      if (!creado.ok) {
        throw new HttpError(403, limiteMsg);
      }
      logActivity(user, `Creó el proyecto "${proyecto.nombre}"`);
      await writeUsers();
      sendJson(res, 201, { ok: true, proyecto });
      return;
    }

    // Marca un paso de la tesis como hecho. Lo llama la herramienta al
    // terminar, para que la lista de proyectos muestre en que anda cada tesis
    // sin tener que guardar los archivos generados.
    const progresoRoute = pathname.match(/^\/proyectos\/([0-9a-fA-F-]+)\/progreso$/);
    if (progresoRoute && req.method === "POST") {
      const user = requireAuth(req);
      const proyecto = await obtenerProyecto(progresoRoute[1]);
      if (!proyecto || proyecto.userId !== user.id) {
        throw new HttpError(404, "Proyecto no encontrado.");
      }
      const payload = await parseJsonBody(req);
      let actualizado;
      try {
        actualizado = marcarPaso(proyecto, String(payload?.paso ?? ""));
      } catch (err) {
        throw new HttpError(esErrorDeUsuario(err) ? 400 : 500, err.message);
      }
      await guardarProyecto(actualizado);
      sendJson(res, 200, { ok: true, proyecto: actualizado });
      return;
    }

    const proyectoRoute = pathname.match(/^\/proyectos\/([0-9a-fA-F-]+)$/);
    if (proyectoRoute) {
      const user = requireAuth(req);
      const proyecto = await obtenerProyecto(proyectoRoute[1]);
      if (!proyecto) throw new HttpError(404, "Proyecto no encontrado.");
      // Un proyecto es privado: ni siquiera un admin lo lee por accidente.
      if (proyecto.userId !== user.id) {
        throw new HttpError(404, "Proyecto no encontrado.");
      }

      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, proyecto });
        return;
      }

      if (req.method === "PATCH") {
        const payload = await parseJsonBody(req);
        let actualizado;
        try {
          actualizado = aplicarCambios(proyecto, payload ?? {});
        } catch (err) {
          throw new HttpError(esErrorDeUsuario(err) ? 400 : 500, err.message);
        }
        await guardarProyecto(actualizado);
        sendJson(res, 200, { ok: true, proyecto: actualizado });
        return;
      }

      if (req.method === "DELETE") {
        await borrarProyecto(proyecto.id);
        logActivity(user, `Eliminó el proyecto "${proyecto.nombre}"`);
        await writeUsers();
        sendJson(res, 200, { ok: true });
        return;
      }
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
      const authUser = requireAuth(req);
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
      consumeUseForJob(authUser, "descriptiva", id);
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
      // El job se registra ANTES de ceder el event loop en el await.
      //
      // Estando despues, dos peticiones simultaneas del mismo usuario pasaban
      // las dos el control de concurrencia de arriba (el mapa seguia vacio
      // cuando la segunda lo consultaba) y arrancaban dos generaciones de IA a
      // la vez, saltandose tanto el limite de una por usuario como el tope
      // global. En un contenedor de 512 MB eso es memoria y dinero.
      descriptivaJobs.set(id, job);
      // La anotacion del uso pendiente debe quedar en firme ANTES de
      // lanzar el job: es lo que permite devolver el uso si el proceso
      // muere a mitad de la generacion.
      await writeUsers();

      generateDescriptiva({ texto: input.texto, config: { n: input.n, nivel: input.nivel } })
        .then((generated) => {
          job.result = generated;
          job.warnings = generated.warnings;
          job.status = "done";
          job.expiresAt = Date.now() + DESCRIPTIVA_DONE_TTL_MS;
          settleJobUse(id, authUser.id, "descriptiva", { refund: false });
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
          settleJobUse(id, authUser.id, "descriptiva", { refund: true });
          job.status = "error";
          // Las validaciones detectadas dentro del job (p. ej. el presupuesto
          // de memoria de lib/presupuesto.js, que solo se conoce tras la
          // respuesta de la IA) SI se muestran al usuario; el detalle de
          // errores tecnicos queda solo en el log (mismo patron que humanizador).
          job.error = err?.isUserError
            ? err.message
            : "Hubo un problema generando tu base de datos, intenta de nuevo. No se descontó tu uso.";
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
      const authUser = requireAuth(req);
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
      consumeUseForJob(authUser, "titulos", id);
      const job = {
        id,
        ownerUserId: authUser.id,
        status: "processing",
        createdAt: Date.now(),
        expiresAt: Date.now() + TITULOS_JOB_TTL_MS,
        result: null,
        error: null,
      };
      // Registrar antes del await: ver la nota en el job de descriptiva.
      titulosJobs.set(id, job);
      // La anotacion del uso pendiente debe quedar en firme ANTES de
      // lanzar el job: es lo que permite devolver el uso si el proceso
      // muere a mitad de la generacion.
      await writeUsers();

      generateTitulos(input)
        .then((generated) => {
          job.result = generated;
          job.status = "done";
          job.expiresAt = Date.now() + TITULOS_DONE_TTL_MS;
          settleJobUse(id, authUser.id, "titulos", { refund: false });
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
          settleJobUse(id, authUser.id, "titulos", { refund: true });
          job.status = "error";
          job.error = "Hubo un problema generando tus títulos, intenta de nuevo. No se descontó tu uso.";
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
          // Los titulos sueltos, para poder elegir uno sin copiarlo a mano.
          titulos: extraerTitulos(job.result.contenido),
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
      const authUser = requireAuth(req);
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
      consumeUseForJob(authUser, "matriz", id);
      const job = {
        id,
        ownerUserId: authUser.id,
        status: "processing",
        createdAt: Date.now(),
        expiresAt: Date.now() + MATRIZ_JOB_TTL_MS,
        result: null,
        error: null,
      };
      // Registrar antes del await: ver la nota en el job de descriptiva.
      matrizJobs.set(id, job);
      // La anotacion del uso pendiente debe quedar en firme ANTES de
      // lanzar el job: es lo que permite devolver el uso si el proceso
      // muere a mitad de la generacion.
      await writeUsers();

      generateMatriz(input)
        .then((generated) => {
          job.result = generated;
          job.status = "done";
          job.expiresAt = Date.now() + MATRIZ_DONE_TTL_MS;
          settleJobUse(id, authUser.id, "matriz", { refund: false });
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
          settleJobUse(id, authUser.id, "matriz", { refund: true });
          job.status = "error";
          job.error = "Hubo un problema generando tu matriz de consistencia, intenta de nuevo. No se descontó tu uso.";
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
      const authUser = requireAuth(req);
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
      consumeUseForJob(authUser, "humanizador", id);
      const job = {
        id,
        ownerUserId: authUser.id,
        status: "processing",
        createdAt: Date.now(),
        expiresAt: Date.now() + HUMANIZADOR_JOB_TTL_MS,
        result: null,
        error: null,
      };
      // Registrar antes del await: ver la nota en el job de descriptiva.
      humanizadorJobs.set(id, job);
      // La anotacion del uso pendiente debe quedar en firme ANTES de
      // lanzar el job: es lo que permite devolver el uso si el proceso
      // muere a mitad de la generacion.
      await writeUsers();

      generateHumanizacion(input)
        .then((generated) => {
          job.result = generated;
          job.status = "done";
          job.expiresAt = Date.now() + HUMANIZADOR_DONE_TTL_MS;
          settleJobUse(id, authUser.id, "humanizador", { refund: false });
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
          settleJobUse(id, authUser.id, "humanizador", { refund: true });
          job.status = "error";
          // Las validaciones de entrada detectadas dentro del job (p. ej. el
          // conteo de palabras del .docx) SI se muestran al usuario; el
          // detalle de errores tecnicos queda solo en el log.
          job.error = err?.isUserError
            ? err.message
            : "Hubo un problema humanizando tu texto, intenta de nuevo. No se descontó tu uso.";
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
    // Retry-After: le dice al cliente cuando reintentar en vez de dejarlo
    // adivinar (o martillar el endpoint).
    if (statusCode === 429 && Number.isFinite(err?.retryAfterSeconds)) {
      res.setHeader("Retry-After", String(err.retryAfterSeconds));
    }
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

// Apagado ordenado: la escritura al almacen es diferida, asi que morir de
// golpe pierde lo ultimo que se haya cambiado. Render manda SIGTERM en cada
// deploy, que es justo cuando mas caro sale perderlo.
let apagando = false;
const apagar = async (senal) => {
  if (apagando) return;
  apagando = true;
  // eslint-disable-next-line no-console
  console.log(`[apagado] ${senal}: guardando lo pendiente...`);
  server.close();
  try {
    await closeStore();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[apagado] no se pudo cerrar el almacen:", err.message);
  }
  process.exit(0);
};
for (const senal of ["SIGTERM", "SIGINT"]) {
  process.on(senal, () => { apagar(senal); });
}
