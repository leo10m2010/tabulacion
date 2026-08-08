const validarPrefijo = (raw) => {
  const prefijo = String(raw ?? "").trim();
  if (prefijo && !/^[a-z_][a-z0-9_]*$/i.test(prefijo)) {
    throw new Error("STORE_TABLE_PREFIX solo admite letras, numeros y guion bajo.");
  }
  return prefijo;
};

export const storeTablePrefix = validarPrefijo(process.env.STORE_TABLE_PREFIX);

const tablas = (prefijo) => ({
  migrations: `${prefijo}schema_migrations`,
  users: `${prefijo}users`,
  identities: `${prefijo}identities`,
  sessions: `${prefijo}sessions`,
  devices: `${prefijo}device_credentials`,
  pairings: `${prefijo}device_pairings`,
  balances: `${prefijo}entitlement_balances`,
  ledger: `${prefijo}entitlement_ledger`,
  reservations: `${prefijo}entitlement_reservations`,
  pending: `${prefijo}pending_uses`,
  deleted: `${prefijo}deleted_accounts`,
  projects: `${prefijo}proyectos`,
  jobs: `${prefijo}jobs`,
  batches: `${prefijo}job_batches`,
  artifacts: `${prefijo}artifacts`,
  payments: `${prefijo}payments`,
  audit: `${prefijo}audit_events`,
});

export const storeTables = tablas(storeTablePrefix);

const migrations = (t) => [
  {
    version: 1,
    name: "legacy_compatibility",
    sql: `
      CREATE TABLE IF NOT EXISTS ${t.users} (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ${t.pending} (
        job_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ${t.deleted} (
        email_hash TEXT PRIMARY KEY,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 2,
    name: "normalized_identity_and_entitlements",
    sql: `
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS email_lower TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS role TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS status TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS plan TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS password_salt TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS password_enabled BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
      UPDATE ${t.users}
         SET email = COALESCE(email, data->>'email'),
             email_lower = COALESCE(email_lower, data->>'emailLower', lower(data->>'email')),
             role = COALESCE(role, data->>'role', 'user'),
             status = COALESCE(status, data->>'status', 'active'),
             plan = COALESCE(plan, data->>'plan', 'free'),
             password_hash = COALESCE(password_hash, data->>'passwordHash'),
             password_salt = COALESCE(password_salt, data->>'passwordSalt'),
             password_enabled = COALESCE((data->>'passwordEnabled')::boolean, true),
             token_version = COALESCE((data->>'tokenVersion')::integer, 1),
             created_at = COALESCE(created_at, (data->>'createdAt')::timestamptz, now()),
             last_login_at = COALESCE(last_login_at, (data->>'lastLoginAt')::timestamptz);
      CREATE UNIQUE INDEX IF NOT EXISTS ${t.users}_email_lower_uidx
        ON ${t.users} (email_lower) WHERE email_lower IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ${t.identities} (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        verified_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (provider, subject),
        UNIQUE (user_id, provider)
      );
      CREATE INDEX IF NOT EXISTS ${t.identities}_user_idx ON ${t.identities} (user_id);

      CREATE TABLE IF NOT EXISTS ${t.balances} (
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        tool TEXT NOT NULL,
        available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
        consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, tool)
      );
      CREATE TABLE IF NOT EXISTS ${t.ledger} (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        tool TEXT NOT NULL,
        kind TEXT NOT NULL,
        available_delta INTEGER NOT NULL DEFAULT 0,
        consumed_delta INTEGER NOT NULL DEFAULT 0,
        reserved_delta INTEGER NOT NULL DEFAULT 0,
        reference_id TEXT,
        idempotency_key TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ${t.ledger}_idempotency_uidx
        ON ${t.ledger} (user_id, tool, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ${t.ledger}_user_created_idx
        ON ${t.ledger} (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ${t.reservations} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        tool TEXT NOT NULL,
        requested INTEGER NOT NULL CHECK (requested > 0),
        accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted >= 0),
        refunded INTEGER NOT NULL DEFAULT 0 CHECK (refunded >= 0),
        status TEXT NOT NULL DEFAULT 'reserved',
        idempotency_key TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        settled_at TIMESTAMPTZ,
        UNIQUE (user_id, tool, idempotency_key)
      );
    `,
  },
  {
    version: 3,
    name: "devices_jobs_artifacts_payments_audit",
    sql: `
      CREATE TABLE IF NOT EXISTS ${t.sessions} (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ${t.devices} (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        credential_hash TEXT NOT NULL UNIQUE,
        last4 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS ${t.devices}_user_idx ON ${t.devices} (user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ${t.pairings} (
        id UUID PRIMARY KEY,
        user_code_hash TEXT NOT NULL UNIQUE,
        secret_hash TEXT NOT NULL,
        device_name TEXT NOT NULL,
        user_id TEXT REFERENCES ${t.users}(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ${t.jobs} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key TEXT,
        lease_owner TEXT,
        lease_expires_at TIMESTAMPTZ,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, type, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS ${t.batches} (
        id UUID PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES ${t.jobs}(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        cursor INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (job_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS ${t.artifacts} (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES ${t.jobs}(id) ON DELETE SET NULL,
        storage_key TEXT NOT NULL UNIQUE,
        content_type TEXT NOT NULL,
        byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ${t.payments} (
        id UUID PRIMARY KEY,
        user_id TEXT REFERENCES ${t.users}(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        provider_order_id TEXT NOT NULL,
        status TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
        currency TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_order_id)
      );
      CREATE TABLE IF NOT EXISTS ${t.audit} (
        id UUID PRIMARY KEY,
        actor_user_id TEXT REFERENCES ${t.users}(id) ON DELETE SET NULL,
        subject_user_id TEXT REFERENCES ${t.users}(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        request_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 4,
    name: "versioned_projects",
    sql: `
      CREATE TABLE IF NOT EXISTS ${t.projects} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${t.users}(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        titulo TEXT NOT NULL DEFAULT '',
        instrumento JSONB NOT NULL DEFAULT '{}'::jsonb,
        progreso JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE ${t.projects} ADD COLUMN IF NOT EXISTS titulo TEXT NOT NULL DEFAULT '';
      ALTER TABLE ${t.projects} ADD COLUMN IF NOT EXISTS progreso JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE ${t.projects} ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS ${t.projects}_user_idx
        ON ${t.projects} (user_id, updated_at DESC);
    `,
  },
  {
    version: 5,
    name: "reservation_reconciliation",
    sql: `
      ALTER TABLE ${t.reservations}
        ADD COLUMN IF NOT EXISTS uncertain INTEGER NOT NULL DEFAULT 0 CHECK (uncertain >= 0);
      ALTER TABLE ${t.reservations}
        ADD COLUMN IF NOT EXISTS reserved_remaining INTEGER NOT NULL DEFAULT 0
        CHECK (reserved_remaining >= 0);
      UPDATE ${t.reservations}
         SET reserved_remaining = requested
       WHERE status = 'reserved' AND reserved_remaining = 0;
    `,
  },
  {
    version: 6,
    name: "payment_credit_tracking",
    sql: `
      ALTER TABLE ${t.payments}
        ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;
      ALTER TABLE ${t.payments}
        ADD COLUMN IF NOT EXISTS credited_tool TEXT;
      ALTER TABLE ${t.payments}
        ADD COLUMN IF NOT EXISTS credited_amount INTEGER NOT NULL DEFAULT 0
        CHECK (credited_amount >= 0);
    `,
  },
  {
    version: 7,
    name: "forms_runs_to_response_balances",
    sql: `
      INSERT INTO ${t.balances} (user_id, tool, available, consumed)
      SELECT id, 'forms',
             GREATEST(0, floor(COALESCE((data->'uses'->>'forms')::numeric, 0)))::int,
             GREATEST(0, floor(COALESCE((data->'usesConsumed'->>'forms')::numeric, 0)))::int
        FROM ${t.users}
       WHERE COALESCE(data->>'formsQuotaUnit', 'run') <> 'response'
      ON CONFLICT (user_id, tool) DO NOTHING;

      INSERT INTO ${t.ledger}
        (id,user_id,tool,kind,available_delta,consumed_delta,reserved_delta,
         reference_id,idempotency_key,metadata)
      SELECT md5('forms-response-migration:' || b.user_id)::uuid,
             b.user_id, 'forms', 'quota_unit_migration',
             b.available * 249, b.consumed * 249, 0,
             'migration-7', 'forms-runs-to-responses-v1',
             jsonb_build_object('factor', 250, 'from', 'run', 'to', 'response')
        FROM ${t.balances} b
        JOIN ${t.users} u ON u.id=b.user_id
       WHERE b.tool='forms'
         AND COALESCE(u.data->>'formsQuotaUnit', 'run') <> 'response'
      ON CONFLICT DO NOTHING;

      UPDATE ${t.balances} b
         SET available=b.available*250, consumed=b.consumed*250, updated_at=now()
        FROM ${t.users} u
       WHERE b.user_id=u.id AND b.tool='forms'
         AND COALESCE(u.data->>'formsQuotaUnit', 'run') <> 'response';

      UPDATE ${t.users}
         SET data=jsonb_set(COALESCE(data, '{}'::jsonb), '{formsQuotaUnit}', '"response"'::jsonb),
             updated_at=now()
       WHERE COALESCE(data->>'formsQuotaUnit', 'run') <> 'response';
    `,
  },
  {
    version: 8,
    name: "one_active_forms_job_per_account",
    sql: `
      WITH ranked AS (
        SELECT id,
               row_number() OVER (
                 PARTITION BY user_id
                 ORDER BY
                   CASE WHEN lease_expires_at > now() THEN 0 ELSE 1 END,
                   created_at,
                   id
               ) AS position
          FROM ${t.jobs}
         WHERE type='forms'
           AND status IN ('processing','running','paused','blocked','cancelling')
      )
      UPDATE ${t.jobs} j
         SET status='queued', lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
        FROM ranked r
       WHERE j.id=r.id AND r.position > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS ${t.jobs}_one_active_forms_per_user_idx
        ON ${t.jobs} (user_id)
        WHERE type='forms'
          AND status IN ('processing','running','paused','blocked','cancelling');
    `,
  },
  {
    version: 9,
    name: "normalized_user_profile_and_generation_jobs",
    sql: `
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS api_key_last4 TEXT;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS generations_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS last_generation_at TIMESTAMPTZ;
      ALTER TABLE ${t.users} ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

      UPDATE ${t.users}
         SET subscription_ends_at = COALESCE(
               subscription_ends_at,
               NULLIF(data->>'subscriptionEndsAt', '')::timestamptz
             ),
             api_key_hash = COALESCE(api_key_hash, NULLIF(data->>'apiKeyHash', '')),
             api_key_last4 = COALESCE(api_key_last4, NULLIF(data->>'apiKeyLast4', '')),
             generations_count = GREATEST(
               0,
               COALESCE(NULLIF(data->>'generationsCount', '')::integer, generations_count, 0)
             ),
             last_generation_at = COALESCE(
               last_generation_at,
               NULLIF(data->>'lastGenerationAt', '')::timestamptz
             ),
             profile = COALESCE(profile, '{}'::jsonb) || (
               COALESCE(data, '{}'::jsonb) - ARRAY[
                 'id','email','emailLower','role','status','plan','passwordHash',
                 'passwordSalt','passwordEnabled','tokenVersion','createdAt',
                 'lastLoginAt','updatedAt','subscriptionEndsAt','apiKeyHash',
                 'apiKeyLast4','generationsCount','lastGenerationAt','googleSub',
                 'googleLinkedAt','deviceCredentials','uses','usesConsumed',
                 'formsUsesLeft','formsUsesUsed','formsResponsesReserved','formsQuotaUnit',
                 'activity'
               ]::text[]
             );

      INSERT INTO ${t.audit}
        (id, actor_user_id, subject_user_id, event_type, metadata, created_at)
      SELECT md5(
               'legacy-activity:' || u.id || ':'
               || COALESCE(activity->>'at', '') || ':'
               || COALESCE(activity->>'detail', '')
             )::uuid,
             NULL,
             u.id,
             'user_activity',
             jsonb_build_object('detail', activity->>'detail'),
             COALESCE(NULLIF(activity->>'at', '')::timestamptz, u.updated_at, now())
        FROM ${t.users} u
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(u.data->'activity')='array'
               THEN u.data->'activity' ELSE '[]'::jsonb END
        ) activity
       WHERE NULLIF(activity->>'detail', '') IS NOT NULL
      ON CONFLICT (id) DO NOTHING;

      -- La columna data queda temporalmente como adaptador, pero ya no contiene
      -- identidad, credenciales, saldo, estado ni relaciones autoritativas.
      UPDATE ${t.users} SET data = profile;

      CREATE INDEX IF NOT EXISTS ${t.jobs}_type_status_created_idx
        ON ${t.jobs} (type, status, created_at);
      CREATE INDEX IF NOT EXISTS ${t.jobs}_user_updated_idx
        ON ${t.jobs} (user_id, updated_at DESC);

      WITH ranked AS (
        SELECT id,
               row_number() OVER (
                 ORDER BY created_at, id
               ) AS position
          FROM ${t.jobs}
         WHERE type IN ('tabulacion','descriptiva','titulos','matriz','humanizador')
           AND status IN ('pending','queued','processing','running')
      )
      UPDATE ${t.jobs} j
         SET status='failed',
             progress=COALESCE(progress, '{}'::jsonb)
               || '{"stage":"superseded_during_migration"}'::jsonb,
             lease_owner=NULL,
             lease_expires_at=NULL,
             updated_at=now()
        FROM ranked r
       WHERE j.id=r.id AND r.position > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS ${t.jobs}_one_heavy_generation_per_user_idx
        ON ${t.jobs} (user_id)
        WHERE type IN ('tabulacion','descriptiva','titulos','matriz','humanizador')
          AND status IN ('pending','queued','processing','running');

      CREATE UNIQUE INDEX IF NOT EXISTS ${t.jobs}_one_heavy_generation_global_idx
        ON ${t.jobs} ((1))
        WHERE type IN ('tabulacion','descriptiva','titulos','matriz','humanizador')
          AND status IN ('pending','queued','processing','running');
    `,
  },
];

export const latestStoreMigrationVersion = 9;

export const runStoreMigrations = async (pool) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${storeTables.migrations} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${storeTablePrefix}:tesishub_schema_migrations`,
    ]);
    const applied = await client.query(`SELECT version FROM ${storeTables.migrations}`);
    const versions = new Set(applied.rows.map((row) => Number(row.version)));
    for (const migration of migrations(storeTables)) {
      if (versions.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO ${storeTables.migrations} (version, name) VALUES ($1, $2)`,
        [migration.version, migration.name],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export const verifyStoreMigrations = async (pool) => {
  const exists = await pool.query("SELECT to_regclass($1) AS table_name", [
    storeTables.migrations,
  ]);
  if (!exists.rows[0]?.table_name) {
    throw new Error("La base de datos no esta migrada. Ejecuta `npm run db:migrate`.");
  }
  const result = await pool.query(
    `SELECT COALESCE(max(version), 0)::int AS version FROM ${storeTables.migrations}`,
  );
  const current = Number(result.rows[0]?.version ?? 0);
  if (current < latestStoreMigrationVersion) {
    throw new Error(
      `Esquema Neon desactualizado (${current}/${latestStoreMigrationVersion}). `
      + "Ejecuta `npm run db:migrate` antes de desplegar.",
    );
  }
  return current;
};
