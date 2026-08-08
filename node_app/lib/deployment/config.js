const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const CHROME_EXTENSION_ID_RE = /^[a-p]{32}$/;
const NEON_HOST_RE = /(^|\.)neon\.tech$/i;
const R2_HOST_RE = /(^|\.)r2\.cloudflarestorage\.com$/i;

const value = (env, key) => String(env[key] ?? "").trim();

const enabled = (env, key, fallback = false) => {
  const raw = value(env, key).toLowerCase();
  if (!raw) return fallback;
  if (TRUE_VALUES.has(raw)) return true;
  if (FALSE_VALUES.has(raw)) return false;
  return null;
};

const integer = (env, key) => {
  const parsed = Number.parseInt(value(env, key), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const parseUrl = (raw, label, issues) => {
  try {
    return new URL(raw);
  } catch {
    issues.push(`${label} no es una URL valida.`);
    return null;
  }
};

const parseOrigins = (raw, label, issues) => {
  const origins = String(raw ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (origins.length === 0) issues.push(`${label} debe declarar origenes explicitos.`);
  if (origins.includes("*")) issues.push(`${label} no puede contener '*'.`);
  for (const origin of origins) {
    const parsed = parseUrl(origin, `${label}: ${origin}`, issues);
    if (!parsed) continue;
    const canonicalOrigin = parsed.protocol === "chrome-extension:"
      ? `chrome-extension://${parsed.hostname}`
      : parsed.origin;
    if (canonicalOrigin !== origin || parsed.username || parsed.password
      || (parsed.protocol === "chrome-extension:" && !CHROME_EXTENSION_ID_RE.test(parsed.hostname))) {
      issues.push(`${label} solo admite origenes exactos, sin ruta, credenciales ni query.`);
    }
    if (!new Set(["https:", "http:", "chrome-extension:"]).has(parsed.protocol)) {
      issues.push(`${label} contiene un protocolo no permitido.`);
    }
    if (parsed.protocol === "http:" && !new Set(["localhost", "127.0.0.1"]).has(parsed.hostname)) {
      issues.push(`${label} solo admite HTTP para localhost.`);
    }
  }
  return [...new Set(origins)].sort();
};

const requireBoolean = (env, key, expected, issues) => {
  const current = enabled(env, key);
  if (current !== expected) issues.push(`${key} debe ser '${expected}'.`);
};

const requireSecret = (env, key, issues, minimumLength = 1) => {
  const current = value(env, key);
  if (current.length < minimumLength) issues.push(`${key} no esta configurada o es demasiado corta.`);
  return current;
};

export class DeploymentConfigError extends Error {
  constructor(issues) {
    super(`Configuracion de despliegue invalida:\n- ${issues.join("\n- ")}`);
    this.name = "DeploymentConfigError";
    this.code = "DEPLOYMENT_CONFIG_INVALID";
    this.issues = issues;
  }
}

export const validateDatabaseUrl = (raw, { production = true } = {}) => {
  const issues = [];
  const parsed = parseUrl(String(raw ?? "").trim(), "DATABASE_URL", issues);
  if (parsed && !new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    issues.push("DATABASE_URL debe usar postgresql://.");
  }
  if (parsed && (!parsed.username || !parsed.hostname || !parsed.pathname.slice(1))) {
    issues.push("DATABASE_URL debe incluir usuario, host y base de datos.");
  }
  if (parsed && production) {
    if (!NEON_HOST_RE.test(parsed.hostname)) {
      issues.push("DATABASE_URL de produccion debe apuntar a Neon.");
    }
    if (!parsed.hostname.toLowerCase().includes("-pooler.")) {
      issues.push("DATABASE_URL debe usar el endpoint pooled de Neon (-pooler en el host).");
    }
    const sslMode = String(parsed.searchParams.get("sslmode") ?? "").toLowerCase();
    if (!new Set(["require", "verify-ca", "verify-full"]).has(sslMode)) {
      issues.push("DATABASE_URL debe exigir SSL mediante sslmode=require o verify-full.");
    }
  }
  if (issues.length) throw new DeploymentConfigError(issues);
  return {
    host: parsed.hostname,
    database: parsed.pathname.slice(1),
    pooled: parsed.hostname.toLowerCase().includes("-pooler."),
    sslMode: parsed.searchParams.get("sslmode"),
  };
};

const validateCommon = (env, issues) => {
  if (value(env, "NODE_ENV") !== "production") issues.push("NODE_ENV debe ser 'production'.");
  requireBoolean(env, "STORE_AUTO_MIGRATE", false, issues);
  if (value(env, "STORE_TABLE_PREFIX")) {
    issues.push("STORE_TABLE_PREFIX debe permanecer vacio en produccion.");
  }
  let database = null;
  try {
    database = validateDatabaseUrl(value(env, "DATABASE_URL"));
  } catch (error) {
    issues.push(...(error.issues ?? [error.message]));
  }
  return database;
};

const validateExtensionAndCors = (env, key, issues) => {
  const extensionId = value(env, "CHROME_EXTENSION_ID");
  if (!CHROME_EXTENSION_ID_RE.test(extensionId)) {
    issues.push("CHROME_EXTENSION_ID debe ser el ID definitivo de 32 caracteres de Chrome.");
  }
  const origins = parseOrigins(env[key], key, issues);
  if (extensionId && !origins.includes(`chrome-extension://${extensionId}`)) {
    issues.push(`${key} debe incluir el origen exacto de CHROME_EXTENSION_ID.`);
  }
  if (!origins.includes("https://tabulacion.vercel.app")) {
    issues.push(`${key} debe incluir https://tabulacion.vercel.app mientras sea el frontend activo.`);
  }
  if (!origins.some((origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    issues.push(`${key} debe incluir un origen localhost explicito para desarrollo.`);
  }
  return { extensionId, origins };
};

const validateR2 = (env, issues) => {
  const accountId = requireSecret(env, "R2_ACCOUNT_ID", issues, 16);
  const endpoint = parseUrl(value(env, "R2_ENDPOINT"), "R2_ENDPOINT", issues);
  const bucket = requireSecret(env, "R2_BUCKET", issues, 3);
  requireSecret(env, "R2_ACCESS_KEY_ID", issues, 12);
  requireSecret(env, "R2_SECRET_ACCESS_KEY", issues, 24);
  if (endpoint) {
    if (endpoint.protocol !== "https:" || !R2_HOST_RE.test(endpoint.hostname)) {
      issues.push("R2_ENDPOINT debe ser un endpoint HTTPS de Cloudflare R2.");
    }
    if (accountId && endpoint.hostname.split(".")[0] !== accountId) {
      issues.push("R2_ENDPOINT no coincide con R2_ACCOUNT_ID.");
    }
    if (endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
      issues.push("R2_ENDPOINT no debe contener ruta, query ni fragmento.");
    }
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    issues.push("R2_BUCKET no tiene un nombre de bucket valido.");
  }
  if (integer(env, "ARTIFACT_RETENTION_DAYS") !== 30) {
    issues.push("ARTIFACT_RETENTION_DAYS debe ser 30.");
  }
  if (integer(env, "ARTIFACT_SIGNED_URL_SECONDS") !== 300) {
    issues.push("ARTIFACT_SIGNED_URL_SECONDS debe ser 300.");
  }
  return { endpointHost: endpoint?.hostname ?? null, bucket };
};

const validateTaypi = (env, issues) => {
  const secretKeys = ["TAYPI_PUBLIC_KEY", "TAYPI_SECRET_KEY", "TAYPI_WEBHOOK_SECRET"];
  const configured = secretKeys.filter((key) => value(env, key)).length;
  if (configured > 0 && configured < secretKeys.length) {
    issues.push("Taypi debe configurarse con sus tres credenciales o permanecer totalmente desactivado.");
  }
  const sandbox = enabled(env, "TAYPI_SANDBOX", true);
  if (sandbox === null) issues.push("TAYPI_SANDBOX debe ser booleano.");
  const timeoutMs = integer(env, "TAYPI_TIMEOUT_MS");
  if (configured > 0 && (timeoutMs === null || timeoutMs < 3_000 || timeoutMs > 30_000)) {
    issues.push("TAYPI_TIMEOUT_MS debe estar entre 3000 y 30000 ms.");
  }
  return { enabled: configured === secretKeys.length, sandbox, timeoutMs };
};

const validateCommercialGate = (env, context, issues) => {
  const commercial = enabled(env, "COMMERCIAL_LAUNCH_ENABLED", false);
  if (commercial === null) issues.push("COMMERCIAL_LAUNCH_ENABLED debe ser booleano.");
  if (!commercial) return false;

  const attestations = [
    "NEON_BACKUP_CONFIRMED",
    "NEON_STAGING_BRANCH_CONFIRMED",
    "R2_BUCKET_SCOPE_CONFIRMED",
    "R2_LIFECYCLE_CONFIRMED",
    "RENDER_REQUIRED_CHECKS_CONFIRMED",
    "RENDER_STARTER_SERVICES_CONFIRMED",
  ];
  for (const key of attestations) requireBoolean(env, key, true, issues);
  requireSecret(env, "NEON_BACKUP_REFERENCE", issues, 8);
  requireBoolean(env, "TAYPI_SANDBOX", false, issues);
  requireSecret(env, "TAYPI_PUBLIC_KEY", issues, 8);
  requireSecret(env, "TAYPI_SECRET_KEY", issues, 16);
  requireSecret(env, "TAYPI_WEBHOOK_SECRET", issues, 16);
  const formsResponsePrice = integer(env, "FORMS_RESPONSE_PRICE_CENTS");
  if (formsResponsePrice === null || formsResponsePrice < 1) {
    issues.push("FORMS_RESPONSE_PRICE_CENTS debe ser un entero positivo para recargas.");
  }

  if (context.publicBaseHost.endsWith(".onrender.com")) {
    issues.push("El lanzamiento comercial exige dominio propio para PUBLIC_BASE_URL.");
  }
  if (!context.origins.some((origin) => {
    try {
      const host = new URL(origin).hostname;
      return origin.startsWith("https://") && !host.endsWith(".vercel.app");
    } catch {
      return false;
    }
  })) {
    issues.push("El lanzamiento comercial exige el origen HTTPS del dominio propio en CORS.");
  }
  return true;
};

const validateApi = (env, issues, database) => {
  requireBoolean(env, "AUTH_REQUIRED", true, issues);
  requireBoolean(env, "REGISTRATION_ENABLED", false, issues);
  requireBoolean(env, "TESISTAB_RUN_JOBS_INLINE", false, issues);
  requireSecret(env, "AUTH_TOKEN_SECRET", issues, 32);
  const googleClientId = requireSecret(env, "GOOGLE_CLIENT_ID", issues, 12);
  if (googleClientId && !googleClientId.endsWith(".apps.googleusercontent.com")) {
    issues.push("GOOGLE_CLIENT_ID no tiene el formato de un cliente web de Google.");
  }

  const publicBase = parseUrl(value(env, "PUBLIC_BASE_URL"), "PUBLIC_BASE_URL", issues);
  if (publicBase && (publicBase.protocol !== "https:" || publicBase.origin !== publicBase.href.replace(/\/$/, ""))) {
    issues.push("PUBLIC_BASE_URL debe ser un origen HTTPS sin ruta ni query.");
  }
  const apiCors = validateExtensionAndCors(env, "CORS_ORIGIN", issues);
  const formsCors = parseOrigins(env.CORS_ALLOWED_ORIGINS, "CORS_ALLOWED_ORIGINS", issues);
  if (apiCors.origins.join("\n") !== formsCors.join("\n")) {
    issues.push("CORS_ORIGIN y CORS_ALLOWED_ORIGINS deben declarar el mismo conjunto.");
  }
  const r2 = validateR2(env, issues);
  const taypi = validateTaypi(env, issues);
  const commercial = validateCommercialGate(env, {
    publicBaseHost: publicBase?.hostname ?? "",
    origins: apiCors.origins,
  }, issues);
  return { role: "api", database, r2, taypi, origins: apiCors.origins, commercial };
};

const validateWorker = (env, issues, database) => {
  requireBoolean(env, "TESISTAB_WORKER_MODE", true, issues);
  requireBoolean(env, "TESISTAB_RUN_JOBS_INLINE", false, issues);
  if (integer(env, "TESISTAB_JOB_BATCH_SIZE") !== 100) {
    issues.push("TESISTAB_JOB_BATCH_SIZE debe ser 100.");
  }
  const lease = integer(env, "TESISTAB_JOB_LEASE_MS");
  if (lease === null || lease < 15_000 || lease > 300_000) {
    issues.push("TESISTAB_JOB_LEASE_MS debe estar entre 15000 y 300000 ms.");
  }
  if (!value(env, "FORMS_WORKER_ADAPTER")) issues.push("FORMS_WORKER_ADAPTER es obligatorio.");
  const cors = validateExtensionAndCors(env, "CORS_ALLOWED_ORIGINS", issues);
  return { role: "worker", database, origins: cors.origins, leaseMs: lease };
};

export const validateDeploymentEnvironment = (env = process.env, { role = "api" } = {}) => {
  const issues = [];
  const database = validateCommon(env, issues);
  const summary = role === "worker"
    ? validateWorker(env, issues, database)
    : role === "api"
      ? validateApi(env, issues, database)
      : (issues.push("El rol debe ser 'api' o 'worker'."), { role });
  if (issues.length) throw new DeploymentConfigError([...new Set(issues)]);
  return summary;
};
