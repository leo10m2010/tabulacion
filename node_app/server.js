import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_TEMPLATE_PATH,
  generateArtifacts,
} from "./generator.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const TEMPLATE_PATH = process.env.TEMPLATE_PATH
  ? path.resolve(process.env.TEMPLATE_PATH)
  : DEFAULT_TEMPLATE_PATH;
const MAX_BODY_BYTES = Number.parseInt(process.env.MAX_BODY_BYTES ?? "4194304", 10);
const RESULT_TTL_SECONDS = Number.parseInt(process.env.RESULT_TTL_SECONDS ?? "900", 10);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL ?? "").trim();
const ALLOWED_ORIGIN_RAW = String(process.env.CORS_ORIGIN ?? "*").trim();
const ALLOWED_ORIGINS = ALLOWED_ORIGIN_RAW.split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const AUTH_REQUIRED = !new Set(["0", "false", "no", "off"]).has(String(process.env.AUTH_REQUIRED ?? "true").trim().toLowerCase());
const AUTH_TOKEN_SECRET = String(process.env.AUTH_TOKEN_SECRET ?? "change-this-token-secret").trim();
const AUTH_TOKEN_TTL_SECONDS = Number.parseInt(process.env.AUTH_TOKEN_TTL_SECONDS ?? "86400", 10);
const USER_STORE_PATH = process.env.USER_STORE_PATH
  ? path.resolve(process.env.USER_STORE_PATH)
  : path.join(SCRIPT_DIR, "data", "users.json");
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL ?? "admin@tabulacion.local").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD ?? "Admin12345!").trim();

const results = new Map();
let users = [];

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
  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
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
  const raw = fs.readFileSync(USER_STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("El store de usuarios no tiene formato de arreglo.");
  }
  users = parsed;
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
    ...credentials,
  };

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
  }

  next.updatedAt = new Date().toISOString();
  return next;
};

const ensureBootstrapAdmin = () => {
  if (users.length > 0) return;
  const admin = createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: "admin",
    status: "active",
    plan: "enterprise",
    subscriptionEndsAt: null,
  });
  // eslint-disable-next-line no-console
  console.log(`Admin inicial creado: ${admin.email} | cambia la contraseña luego de ingresar.`);
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
  if (!opts.allowExpiredSubscription && isSubscriptionExpired(user)) {
    throw new HttpError(403, `Suscripcion vencida (${user.subscriptionEndsAt ?? "sin fecha"}).`);
  }
  if (opts.adminOnly && user.role !== "admin") {
    throw new HttpError(403, "Se requiere rol administrador.");
  }
  return user;
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

const server = http.createServer(async (req, res) => {
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
        templatePath: TEMPLATE_PATH,
        inMemoryResults: results.size,
        authRequired: AUTH_REQUIRED,
        userStorePath: USER_STORE_PATH,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      const payload = await parseJsonBody(req);
      const email = normalizeEmail(payload?.email);
      const password = String(payload?.password ?? "");
      const user = users.find((item) => item.emailLower === email);
      if (!user || !checkPassword(password, user)) {
        throw new HttpError(401, "Credenciales invalidas.");
      }
      if (user.status !== "active") {
        throw new HttpError(403, "Usuario inactivo.");
      }
      if (isSubscriptionExpired(user)) {
        throw new HttpError(403, `Suscripcion vencida (${user.subscriptionEndsAt ?? "sin fecha"}).`);
      }
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

    if (req.method === "GET" && pathname === "/auth/users") {
      requireAuth(req, { adminOnly: true, allowExpiredSubscription: true });
      const list = [...users]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((item) => sanitizeUser(item));
      sendJson(res, 200, { ok: true, users: list });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/users") {
      requireAuth(req, { adminOnly: true, allowExpiredSubscription: true });
      const payload = await parseJsonBody(req);
      const user = createUser({
        email: payload?.email,
        password: payload?.password,
        role: payload?.role ?? "user",
        status: payload?.status ?? "active",
        plan: payload?.plan ?? "pro",
        subscriptionEndsAt: payload?.subscriptionEndsAt,
        subscriptionDays: payload?.subscriptionDays,
      });
      sendJson(res, 201, { ok: true, user: sanitizeUser(user) });
      return;
    }

    const authUserRoute = pathname.match(/^\/auth\/users\/([0-9a-fA-F-]+)$/);
    if (authUserRoute && req.method === "PATCH") {
      const admin = requireAuth(req, { adminOnly: true, allowExpiredSubscription: true });
      const targetId = authUserRoute[1];
      const target = users.find((item) => item.id === targetId);
      if (!target) throw new HttpError(404, "Usuario no encontrado.");

      const payload = await parseJsonBody(req);
      if (target.id === admin.id && payload?.status === "disabled") {
        throw new HttpError(400, "No puedes desactivar tu propio usuario admin.");
      }

      const updated = patchUser(target, payload ?? {});
      const idx = users.findIndex((item) => item.id === target.id);
      users[idx] = updated;
      writeUsers();
      sendJson(res, 200, { ok: true, user: sanitizeUser(updated) });
      return;
    }

    if (authUserRoute && req.method === "DELETE") {
      const admin = requireAuth(req, { adminOnly: true, allowExpiredSubscription: true });
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

    if (req.method === "POST" && pathname === "/generate") {
      const authUser = requireAuth(req, { adminOnly: true });
      const payload = await parseJsonBody(req);
      const config = payload?.config && typeof payload.config === "object"
        ? payload.config
        : payload;

      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new HttpError(400, "Debes enviar una configuracion valida (objeto JSON).");
      }

      const artifacts = await generateArtifacts(config, { templatePath: TEMPLATE_PATH });
      const responseMode = String(payload?.responseMode ?? "links").toLowerCase();

      if (responseMode === "inline") {
        sendJson(res, 200, {
          correlation: artifacts.correlation,
          baseCsv: artifacts.baseCsv,
          excelBase64: artifacts.excelBuffer.toString("base64"),
          excelFileName: "Tabulacion_generada.xlsx",
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
        expiresAt: new Date(expiresAt).toISOString(),
        links: {
          meta: `${baseUrl}/results/${id}`,
          xlsx: `${baseUrl}/results/${id}/xlsx`,
          csv: `${baseUrl}/results/${id}/csv`,
        },
      });
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
  console.log(`API lista en puerto ${PORT} | template=${TEMPLATE_PATH}`);
});
