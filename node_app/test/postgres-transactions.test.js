import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const HAY_DB = Boolean(String(process.env.DATABASE_URL ?? "").trim());
const PREFIX = `tx_${process.pid}_`;
const USER_ID = "postgres-transaction-user";
const OTHER_USER_ID = "postgres-transaction-user-2";

let store;
let tempDir;

const dropOwnTables = async () => {
  if (!HAY_DB) return;
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const result = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE $1",
    [`${PREFIX}%`],
  );
  for (const { tablename } of result.rows) {
    if (!tablename.startsWith(PREFIX) || !/^[a-z_][a-z0-9_]*$/i.test(tablename)) {
      throw new Error("Tabla PostgreSQL de prueba fuera del prefijo esperado.");
    }
    await pool.query(`DROP TABLE IF EXISTS ${tablename} CASCADE`);
  }
  await pool.end();
};

describe("ledger y cola transaccional en PostgreSQL", {
  skip: HAY_DB ? false : "sin DATABASE_URL",
}, () => {
  before(async () => {
    process.env.STORE_TABLE_PREFIX = PREFIX;
    process.env.STORE_AUTO_MIGRATE = "true";
    process.env.NODE_ENV = "test";
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tesishub-pg-transactions-"));
    await dropOwnTables();
    store = await import(`../lib/store/index.js?transactions=${Date.now()}`);
    await store.initStore(path.join(tempDir, "users.json"));
    store.persistUsers([{
      id: USER_ID,
      email: "transactions@test.local",
      emailLower: "transactions@test.local",
      role: "user",
      status: "active",
      plan: "tesista",
      passwordEnabled: false,
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
      uses: { forms: 2000, tabulacion: 2 },
      usesConsumed: { forms: 0, tabulacion: 0 },
      deviceCredentials: [],
    }, {
      id: OTHER_USER_ID,
      email: "transactions-2@test.local",
      emailLower: "transactions-2@test.local",
      role: "user",
      status: "active",
      plan: "tesista",
      passwordEnabled: false,
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
      uses: { forms: 0, tabulacion: 2 },
      usesConsumed: { forms: 0, tabulacion: 0 },
      deviceCredentials: [],
    }]);
    await store.flushStore();
    await store.setEntitlementBalances(USER_ID, {
      forms: { available: 2000, consumed: 0, reserved: 0 },
      tabulacion: { available: 2, consumed: 0, reserved: 0 },
    });
  });

  after(async () => {
    await store?.closeStore();
    await dropOwnTables();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("serializa saldo, webhook y leases sin duplicar movimientos", async () => {
    const consumeInput = {
      userId: USER_ID,
      tool: "tabulacion",
      amount: 1,
      idempotencyKey: "same-consume",
    };
    const consumed = await Promise.all([
      store.consumeEntitlement(consumeInput),
      store.consumeEntitlement(consumeInput),
    ]);
    assert.ok(consumed.every((result) => result.ok));
    assert.deepEqual(await store.getEntitlementBalance(USER_ID, "tabulacion"), {
      available: 1, consumed: 1, reserved: 0,
    });

    const reservationInput = {
      userId: USER_ID,
      tool: "forms",
      amount: 1200,
      idempotencyKey: "same-reservation",
    };
    const reservations = await Promise.all([
      store.reserveEntitlement({ ...reservationInput, reservationId: "reservation-a" }),
      store.reserveEntitlement({ ...reservationInput, reservationId: "reservation-b" }),
    ]);
    assert.ok(reservations.every((result) => result.ok));
    assert.equal(reservations[0].reservation.id, reservations[1].reservation.id);
    assert.deepEqual(await store.getEntitlementBalance(USER_ID, "forms"), {
      available: 800, consumed: 0, reserved: 1200,
    });

    const reservationId = reservations[0].reservation.id;
    const settlements = await Promise.all([
      store.settleEntitlement({ userId: USER_ID, reservationId, accepted: 1100 }),
      store.settleEntitlement({ userId: USER_ID, reservationId, accepted: 1100 }),
    ]);
    assert.ok(settlements.every((result) => result.ok));
    assert.deepEqual(await store.getEntitlementBalance(USER_ID, "forms"), {
      available: 900, consumed: 1100, reserved: 0,
    });

    const order = {
      userId: USER_ID,
      provider: "taypi",
      providerOrderId: "33333333-3333-4333-8333-333333333333",
      amountMinor: 4900,
      currency: "PEN",
    };
    await store.recordPaymentAndCredit({ ...order, status: "pending" });
    const paid = await Promise.all([
      store.recordPaymentAndCredit({
        ...order, status: "paid", credits: { tabulacion: 2, forms: 500 },
      }),
      store.recordPaymentAndCredit({
        ...order, status: "paid", credits: { tabulacion: 2, forms: 500 },
      }),
    ]);
    assert.equal(paid.filter((result) => result.credited).length, 1);
    assert.deepEqual(await store.getEntitlementBalance(USER_ID, "tabulacion"), {
      available: 3, consumed: 1, reserved: 0,
    });
    assert.deepEqual(await store.getEntitlementBalance(USER_ID, "forms"), {
      available: 1400, consumed: 1100, reserved: 0,
    });

    await store.createDurableJob({
      id: "postgres-job-1",
      userId: USER_ID,
      type: "forms",
      status: "queued",
      parameters: { payload: { marker: "kept" }, job: { sent: 5 } },
      progress: { accepted: 5 },
      idempotencyKey: "postgres-job-idempotency",
    });
    const claims = await Promise.all([
      store.claimDurableJob({ type: "forms", workerId: "worker-a", leaseMs: 30_000 }),
      store.claimDurableJob({ type: "forms", workerId: "worker-b", leaseMs: 30_000 }),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find(Boolean);
    assert.equal(claimed.status, "processing");
    const running = await store.updateDurableJob(claimed.id, {
      status: "running",
      workerId: claimed.leaseOwner,
      renewLeaseMs: 30_000,
    });
    assert.equal(running.status, "running");
    assert.ok(await store.renewDurableJobLease({
      id: claimed.id,
      workerId: claimed.leaseOwner,
      leaseMs: 30_000,
    }));
    const controlled = await store.controlDurableJob(claimed.id, {
      status: "paused",
      jobPatch: { pauseRequested: true },
    });
    assert.equal(controlled.status, "paused");
    assert.equal(controlled.parameters.job.sent, 5);
    assert.equal(controlled.parameters.job.pauseRequested, true);
    assert.deepEqual(controlled.parameters.payload, { marker: "kept" });
    assert.deepEqual(controlled.progress, { accepted: 5 });
    assert.equal(controlled.leaseOwner, claimed.leaseOwner);
    assert.equal(await store.updateDurableJob(claimed.id, {
      status: "completed",
      workerId: "worker-that-does-not-own-the-lease",
      clearLease: true,
    }), null);

    await store.createDurableJob({
      id: "postgres-job-2",
      userId: USER_ID,
      type: "forms",
      status: "queued",
      parameters: {},
      progress: {},
      idempotencyKey: "postgres-job-idempotency-2",
    });
    assert.equal(await store.claimDurableJob({
      type: "forms", workerId: "worker-c", leaseMs: 30_000,
    }), null, "una cuenta no ejecuta dos trabajos Forms a la vez");

    const heavy = await Promise.all([
      store.createDurableJob({
        id: "heavy-postgres-a",
        userId: USER_ID,
        type: "descriptiva",
        status: "processing",
        progress: { stage: "generating" },
      }),
      store.createDurableJob({
        id: "heavy-postgres-b",
        userId: OTHER_USER_ID,
        type: "titulos",
        status: "processing",
        progress: { stage: "generating" },
      }),
    ]);
    assert.equal(new Set(heavy.map((job) => job?.id).filter(Boolean)).size, 1,
      "el indice durable deja una sola generacion pesada global");
    assert.equal((await store.listDurableJobs({ limit: 100 }))
      .filter((job) => ["descriptiva", "titulos"].includes(job.type)
        && job.status === "processing").length, 1);

    await store.createSessionRecord({
      id: "44444444-4444-4444-8444-444444444444",
      userId: USER_ID,
      tokenHash: "postgres-session-hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await store.revokeSessionByTokenHash("postgres-session-hash");
    assert.ok((await store.getSessionByTokenHash("postgres-session-hash")).revoked_at);
  });
});
