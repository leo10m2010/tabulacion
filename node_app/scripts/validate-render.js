import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const blueprintPath = path.join(root, "render.yaml");
const blueprint = parse(fs.readFileSync(blueprintPath, "utf8"));
const issues = [];

const assert = (condition, message) => { if (!condition) issues.push(message); };
const services = Array.isArray(blueprint?.services) ? blueprint.services : [];
const api = services.find((service) => service.name === "tabulacion-api");
const worker = services.find((service) => service.name === "tabulacion-forms-worker");
const envMap = (service) => new Map((service?.envVars ?? []).map((item) => [item.key, item]));
const envValue = (service, key) => envMap(service).get(key)?.value;
const isSecret = (service, key) => envMap(service).get(key)?.sync === false
  && !("value" in (envMap(service).get(key) ?? {}));

assert(services.length === 2, "El Blueprint debe declarar exactamente API y worker Forms.");
assert(services.every((service) => new Set(["web", "worker"]).has(service.type)),
  "No se debe crear PostgreSQL ni Key Value dentro de Render.");
assert(api?.type === "web", "tabulacion-api debe ser un web service.");
assert(worker?.type === "worker", "tabulacion-forms-worker debe ser un worker.");

for (const service of [api, worker]) {
  if (!service) continue;
  assert(service.plan === "starter", `${service.name} debe usar Starter.`);
  assert(service.region === "oregon", `${service.name} debe permanecer inicialmente en Oregon.`);
  assert(service.branch === "main", `${service.name} debe desplegar desde main.`);
  assert(service.autoDeployTrigger === "checksPass", `${service.name} debe esperar checks de CI.`);
  assert(service.numInstances === 1, `${service.name} debe iniciar con una instancia.`);
  assert(envValue(service, "NODE_VERSION") === "24", `${service.name}: debe usar Node 24 LTS.`);
  assert(envValue(service, "NPM_CONFIG_ENGINE_STRICT") === "true",
    `${service.name}: npm debe rechazar una version Node incompatible.`);
  assert(envValue(service, "NODE_ENV") === "production", `${service.name}: NODE_ENV invalido.`);
  assert(envValue(service, "STORE_AUTO_MIGRATE") === "false", `${service.name}: no debe migrar al arrancar.`);
  assert(isSecret(service, "DATABASE_URL"), `${service.name}: DATABASE_URL debe ser secreto sin valor en Git.`);
}

assert(api?.buildCommand === worker?.buildCommand, "API y worker deben usar el mismo build.");
assert(api?.preDeployCommand?.includes("deploy:preflight:api"), "API debe ejecutar el preflight antes de migrar.");
assert(api?.preDeployCommand?.includes("db:migrate"), "API debe ejecutar la unica migracion pre-deploy.");
assert(!worker?.preDeployCommand?.includes("db:migrate"), "El worker no debe ejecutar migraciones.");
assert(worker?.startCommand?.includes("deploy:preflight:worker"), "El worker debe validar su entorno al arrancar.");
assert(worker?.startCommand?.includes("db:wait-schema"), "El worker debe esperar el schema antes de reclamar jobs.");
assert(worker?.startCommand?.endsWith("node forms/worker.js"), "El worker debe arrancar forms/worker.js.");
assert(api?.healthCheckPath === "/health", "Render debe usar /health para la vida del proceso API.");

for (const key of [
  "AUTH_TOKEN_SECRET", "GOOGLE_CLIENT_ID", "R2_ACCOUNT_ID", "R2_ENDPOINT", "R2_BUCKET",
  "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "TAYPI_PUBLIC_KEY", "TAYPI_SECRET_KEY",
  "TAYPI_WEBHOOK_SECRET", "OPENROUTER_API_KEY",
]) {
  assert(isSecret(api, key), `API: ${key} debe ser sync:false y no tener valor versionado.`);
}

assert(envValue(api, "ARTIFACT_RETENTION_DAYS") === "30", "R2 debe retener artefactos 30 dias.");
assert(envValue(api, "ARTIFACT_SIGNED_URL_SECONDS") === "300", "Las URLs R2 deben durar 300 segundos.");
assert(envValue(api, "TAYPI_TIMEOUT_MS") === "10000", "Taypi debe tener timeout de 10 segundos por intento.");
assert(envValue(api, "REGISTRATION_ENABLED") === "false", "El registro por email debe seguir apagado.");
assert(envValue(api, "TESISTAB_RUN_JOBS_INLINE") === "false", "API no debe ejecutar Forms inline.");
assert(!envMap(api).has("ADMIN_API_KEY"),
  "La extension no debe restaurar una clave fija global de administrador.");
assert(envValue(worker, "TESISTAB_WORKER_MODE") === "true", "El worker debe estar en modo worker.");
assert(envValue(worker, "TESISTAB_JOB_BATCH_SIZE") === "100", "Forms debe usar lotes de 100.");
assert(envValue(api, "COMMERCIAL_LAUNCH_ENABLED") === "false",
  "El lanzamiento comercial debe permanecer bloqueado hasta completar los gates externos.");
for (const key of [
  "NEON_BACKUP_CONFIRMED", "NEON_BACKUP_REFERENCE", "NEON_STAGING_BRANCH_CONFIRMED",
  "R2_BUCKET_SCOPE_CONFIRMED", "R2_LIFECYCLE_CONFIRMED",
  "RENDER_REQUIRED_CHECKS_CONFIRMED", "RENDER_STARTER_SERVICES_CONFIRMED",
]) {
  assert(isSecret(api, key), `API: ${key} debe quedar bajo control operativo (sync:false).`);
}

const expectedExtensionId = envValue(api, "CHROME_EXTENSION_ID");
assert(/^[a-p]{32}$/.test(expectedExtensionId ?? ""), "CHROME_EXTENSION_ID no es valido.");
const extensionManifest = JSON.parse(fs.readFileSync(
  path.join(root, "forms/tutorica-chrome-extension/manifest.json"),
  "utf8",
));
const extensionKey = String(extensionManifest.key ?? "");
const extensionIdFromKey = extensionKey
  ? [...crypto.createHash("sha256").update(Buffer.from(extensionKey, "base64")).digest("hex").slice(0, 32)]
    .map((character) => String.fromCharCode(97 + Number.parseInt(character, 16))).join("")
  : "";
assert(Boolean(extensionKey), "El manifest de la extension debe fijar su clave publica.");
assert(extensionIdFromKey === expectedExtensionId,
  "La clave publica del manifest no genera el CHROME_EXTENSION_ID configurado.");
for (const [service, key] of [[api, "CORS_ORIGIN"], [api, "CORS_ALLOWED_ORIGINS"], [worker, "CORS_ALLOWED_ORIGINS"]]) {
  const cors = String(envValue(service, key) ?? "").split(",").map((item) => item.trim());
  assert(!cors.includes("*"), `${service?.name}: ${key} no puede contener wildcard.`);
  assert(cors.includes(`chrome-extension://${expectedExtensionId}`), `${service?.name}: falta el origen de la extension.`);
  assert(cors.includes("https://tabulacion.vercel.app"), `${service?.name}: falta Vercel en CORS.`);
  assert(cors.includes("http://localhost:5173"), `${service?.name}: falta localhost en CORS.`);
}

for (const directory of ["node_app", "forms", "frontend"]) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, directory, "package.json"), "utf8"));
  assert(packageJson.engines?.node === ">=24 <25", `${directory}: engines.node debe fijar Node 24 LTS.`);
}
const ciSource = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
assert((ciSource.match(/node-version:\s*["']24["']/g) ?? []).length === 4,
  "Todos los jobs CI deben usar Node 24.");
assert(/permissions:\s*\n\s+contents:\s*read/.test(ciSource),
  "CI debe declarar permisos minimos contents: read.");

if (issues.length) {
  process.stderr.write(`${issues.map((issue) => `- ${issue}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("render.yaml valido: API Starter + worker Starter, una migracion y gates cerrados.\n");
}
