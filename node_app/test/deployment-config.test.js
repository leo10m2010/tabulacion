import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { validateDatabaseUrl, validateDeploymentEnvironment } from "../lib/deployment/config.js";

const API_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:secret@ep-test-pooler.us-west-2.aws.neon.tech/tesishub?sslmode=require",
  STORE_AUTO_MIGRATE: "false",
  AUTH_REQUIRED: "true",
  REGISTRATION_ENABLED: "false",
  TESISTAB_RUN_JOBS_INLINE: "false",
  AUTH_TOKEN_SECRET: "a".repeat(64),
  GOOGLE_CLIENT_ID: "123456789.apps.googleusercontent.com",
  PUBLIC_BASE_URL: "https://tabulacion-api.onrender.com",
  CHROME_EXTENSION_ID: "kdppbednjfajcjogdajmagfabidfjmem",
  CORS_ORIGIN: "https://tabulacion.vercel.app,http://localhost:5173,chrome-extension://kdppbednjfajcjogdajmagfabidfjmem",
  CORS_ALLOWED_ORIGINS: "http://localhost:5173,chrome-extension://kdppbednjfajcjogdajmagfabidfjmem,https://tabulacion.vercel.app",
  R2_ACCOUNT_ID: "2953e58cfc392b7a60cc0850b069abe7",
  R2_ENDPOINT: "https://2953e58cfc392b7a60cc0850b069abe7.r2.cloudflarestorage.com",
  R2_BUCKET: "tesishub-artifacts",
  R2_ACCESS_KEY_ID: "access-key-id-123",
  R2_SECRET_ACCESS_KEY: "s".repeat(32),
  ARTIFACT_RETENTION_DAYS: "30",
  ARTIFACT_SIGNED_URL_SECONDS: "300",
  COMMERCIAL_LAUNCH_ENABLED: "false",
  FORMS_RESPONSE_PRICE_CENTS: "10",
};
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("preflight de despliegue", () => {
  test("acepta la configuracion operativa previa al lanzamiento comercial", () => {
    const result = validateDeploymentEnvironment(API_ENV, { role: "api" });
    assert.equal(result.database.pooled, true);
    assert.equal(result.commercial, false);
  });

  test("rechaza el endpoint directo o sin SSL de Neon", () => {
    assert.throws(
      () => validateDatabaseUrl("postgresql://user:secret@ep-test.us-west-2.aws.neon.tech/db"),
      /pooled|SSL/,
    );
  });

  test("rechaza wildcard, ID de extension ausente y TTL R2 distinto", () => {
    assert.throws(
      () => validateDeploymentEnvironment({
        ...API_ENV,
        CORS_ORIGIN: "*",
        ARTIFACT_SIGNED_URL_SECONDS: "900",
      }, { role: "api" }),
      /CORS_ORIGIN|CHROME_EXTENSION_ID|300/,
    );
  });

  test("el flag comercial exige dominio, Taypi real y attestations externas", () => {
    assert.throws(
      () => validateDeploymentEnvironment({
        ...API_ENV,
        COMMERCIAL_LAUNCH_ENABLED: "true",
        TAYPI_SANDBOX: "true",
      }, { role: "api" }),
      /dominio propio|TAYPI_SANDBOX|CONFIRMED/,
    );
  });

  test("rechaza Taypi parcialmente configurado o sin timeout acotado", () => {
    assert.throws(
      () => validateDeploymentEnvironment({
        ...API_ENV,
        TAYPI_PUBLIC_KEY: "taypi_pk_test",
      }, { role: "api" }),
      /tres credenciales/,
    );
    assert.throws(
      () => validateDeploymentEnvironment({
        ...API_ENV,
        TAYPI_PUBLIC_KEY: "taypi_pk_test",
        TAYPI_SECRET_KEY: "taypi_sk_test_secret",
        TAYPI_WEBHOOK_SECRET: "whsec_test_secret",
        TAYPI_TIMEOUT_MS: "60000",
      }, { role: "api" }),
      /TAYPI_TIMEOUT_MS/,
    );
  });

  test("valida por separado el entorno minimo del worker", () => {
    const result = validateDeploymentEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: API_ENV.DATABASE_URL,
      STORE_AUTO_MIGRATE: "false",
      CHROME_EXTENSION_ID: API_ENV.CHROME_EXTENSION_ID,
      CORS_ALLOWED_ORIGINS: API_ENV.CORS_ALLOWED_ORIGINS,
      TESISTAB_WORKER_MODE: "true",
      TESISTAB_RUN_JOBS_INLINE: "false",
      TESISTAB_JOB_BATCH_SIZE: "100",
      TESISTAB_JOB_LEASE_MS: "30000",
      FORMS_WORKER_ADAPTER: "node_app/forms-worker-adapter.js",
    }, { role: "worker" });
    assert.equal(result.role, "worker");
    assert.equal(result.leaseMs, 30000);
  });

  test("una migracion productiva no arranca sin referencia del respaldo logico", () => {
    const result = spawnSync(process.execPath, [path.resolve(TEST_DIR, "../lib/store/migrate-cli.js")], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
        NEON_BACKUP_CONFIRMED: "false",
        NEON_BACKUP_REFERENCE: "",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /respaldo logico|respaldo lógico/i);
  });
});
