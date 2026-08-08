import pg from "pg";
import {
  latestStoreMigrationVersion,
  runStoreMigrations,
  storeTables,
  verifyStoreMigrations,
} from "./migrations.js";

const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL es obligatoria para migrar Neon.");
}
const productionMigration = process.env.NODE_ENV === "production"
  && !process.argv.includes("--dry-run")
  && !process.argv.includes("--inventory");
if (productionMigration) {
  const backupConfirmed = String(process.env.NEON_BACKUP_CONFIRMED ?? "").toLowerCase() === "true";
  const backupReference = String(process.env.NEON_BACKUP_REFERENCE ?? "").trim();
  if (!backupConfirmed || backupReference.length < 8) {
    throw new Error(
      "Migracion de produccion bloqueada: confirma el respaldo logico de Neon "
      + "con NEON_BACKUP_CONFIRMED=true y NEON_BACKUP_REFERENCE.",
    );
  }
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  query_timeout: 120_000,
  statement_timeout: 120_000,
  lock_timeout: 10_000,
  idle_in_transaction_session_timeout: 180_000,
  ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: true },
});

const inventory = async () => {
  const names = [
    storeTables.users,
    storeTables.identities,
    storeTables.devices,
    storeTables.balances,
    storeTables.ledger,
    storeTables.reservations,
    storeTables.projects,
    storeTables.jobs,
    storeTables.artifacts,
    storeTables.payments,
  ];
  const rows = [];
  for (const table of names) {
    const exists = await pool.query("SELECT to_regclass($1) AS table_name", [table]);
    if (!exists.rows[0]?.table_name) {
      rows.push({ table, exists: false, rows: null });
      continue;
    }
    const count = await pool.query(`SELECT count(*)::bigint AS rows FROM ${table}`);
    rows.push({ table, exists: true, rows: Number(count.rows[0].rows) });
  }
  return rows;
};

const integrityInventory = async () => {
  const tableExists = async (table) => Boolean((await pool.query(
    "SELECT to_regclass($1) AS table_name", [table],
  )).rows[0]?.table_name);
  const summary = {};
  if (await tableExists(storeTables.balances)) {
    const balances = await pool.query(`
      SELECT tool, count(*)::int AS owners,
             COALESCE(sum(available),0)::bigint AS available,
             COALESCE(sum(consumed),0)::bigint AS consumed,
             COALESCE(sum(reserved),0)::bigint AS reserved,
             count(*) FILTER (WHERE available < 0 OR consumed < 0 OR reserved < 0)::int AS invalid
        FROM ${storeTables.balances}
       GROUP BY tool ORDER BY tool
    `);
    summary.balances = balances.rows.map((row) => ({
      ...row,
      available: Number(row.available),
      consumed: Number(row.consumed),
      reserved: Number(row.reserved),
    }));
  }
  if (await tableExists(storeTables.users)) {
    const users = await pool.query(`
      SELECT count(*)::int AS users,
             count(*) FILTER (WHERE email_lower IS NULL OR status IS NULL)::int AS incomplete
        FROM ${storeTables.users}
    `).catch(() => ({ rows: [{ users: 0, incomplete: 0 }] }));
    summary.users = users.rows[0];
  }
  for (const [label, table] of [
    ["projects", storeTables.projects],
    ["jobs", storeTables.jobs],
    ["artifacts", storeTables.artifacts],
  ]) {
    if (!(await tableExists(table)) || !(await tableExists(storeTables.users))) continue;
    const orphaned = await pool.query(`
      SELECT count(*)::int AS count
        FROM ${table} child
        LEFT JOIN ${storeTables.users} owner ON owner.id=child.user_id
       WHERE owner.id IS NULL
    `);
    summary[`${label}WithoutOwner`] = Number(orphaned.rows[0].count);
  }
  return summary;
};

try {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--inventory");
  const before = await inventory();
  const integrityBefore = await integrityInventory();
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.table(before);
    console.log(JSON.stringify({ integrity: integrityBefore }, null, 2));
    try {
      const current = await verifyStoreMigrations(pool);
      // eslint-disable-next-line no-console
      console.log(`Esquema al dia: ${current}/${latestStoreMigrationVersion}.`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`Migracion pendiente: ${err.message}`);
    }
  } else {
    await runStoreMigrations(pool);
    const current = await verifyStoreMigrations(pool);
    const after = await inventory();
    const integrityAfter = await integrityInventory();
    // eslint-disable-next-line no-console
    console.log(`Migraciones aplicadas. Esquema ${current}/${latestStoreMigrationVersion}.`);
    // eslint-disable-next-line no-console
    console.table(after);
    console.log(JSON.stringify({ integrity: integrityAfter }, null, 2));
  }
} finally {
  await pool.end();
}
