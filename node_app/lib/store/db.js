let sharedPoolPromise = null;
let sharedPool = null;
let poolReferences = 0;

export const acquireStorePool = async () => {
  if (!sharedPoolPromise) {
    sharedPoolPromise = (async () => {
      const url = String(process.env.DATABASE_URL ?? "").trim();
      if (!url) throw new Error("DATABASE_URL es obligatorio para abrir PostgreSQL.");
      const { default: pg } = await import("pg");
      const hostname = new URL(url).hostname.toLowerCase();
      const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
      const pool = new pg.Pool({
        connectionString: url,
        max: 4,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: Number.parseInt(process.env.DB_CONNECT_TIMEOUT_MS ?? "10000", 10),
        query_timeout: Number.parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? "20000", 10),
        statement_timeout: Number.parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? "15000", 10),
        lock_timeout: Number.parseInt(process.env.DB_LOCK_TIMEOUT_MS ?? "5000", 10),
        idle_in_transaction_session_timeout: Number.parseInt(
          process.env.DB_TRANSACTION_TIMEOUT_MS ?? "15000",
          10,
        ),
        ssl: isLoopback ? undefined : { rejectUnauthorized: true },
      });
      sharedPool = pool;
      return pool;
    })();
  }
  const pool = await sharedPoolPromise;
  poolReferences += 1;
  return pool;
};

export const releaseStorePool = async () => {
  poolReferences = Math.max(0, poolReferences - 1);
  if (poolReferences > 0 || !sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  sharedPoolPromise = null;
  await pool.end();
};
