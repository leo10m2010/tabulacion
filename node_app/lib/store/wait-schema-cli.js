import pg from "pg";
import { validateDatabaseUrl } from "../deployment/config.js";
import { latestStoreMigrationVersion, verifyStoreMigrations } from "./migrations.js";

const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
validateDatabaseUrl(databaseUrl, { production: process.env.NODE_ENV === "production" });

const timeoutSeconds = Math.max(
  10,
  Math.min(900, Number.parseInt(process.env.SCHEMA_WAIT_TIMEOUT_SECONDS ?? "300", 10) || 300),
);
const intervalMs = Math.max(
  1_000,
  Math.min(15_000, Number.parseInt(process.env.SCHEMA_WAIT_INTERVAL_MS ?? "5000", 10) || 5_000),
);
const deadline = Date.now() + timeoutSeconds * 1_000;
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  query_timeout: 15_000,
  statement_timeout: 10_000,
  lock_timeout: 5_000,
  ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: true },
});

let attempt = 0;
try {
  while (Date.now() <= deadline) {
    attempt += 1;
    try {
      const version = await verifyStoreMigrations(pool);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        event: "schema.ready",
        version,
        expectedVersion: latestStoreMigrationVersion,
        attempt,
      })}\n`);
      process.exitCode = 0;
      break;
    } catch {
      if (Date.now() + intervalMs > deadline) {
        process.stderr.write(`${JSON.stringify({
          ok: false,
          event: "schema.wait_timeout",
          expectedVersion: latestStoreMigrationVersion,
          attempts: attempt,
        })}\n`);
        process.exitCode = 1;
        break;
      }
      process.stdout.write(`${JSON.stringify({
        ok: false,
        event: "schema.not_ready",
        expectedVersion: latestStoreMigrationVersion,
        attempt,
      })}\n`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
} finally {
  await pool.end();
}
