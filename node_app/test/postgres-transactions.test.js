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

  test("concilia 1200 respuestas inciertas por delta acumulado en PostgreSQL", async () => {
    await store.setEntitlementBalances(USER_ID, {
      forms: { available: 1200, consumed: 0, reserved: 0 },
    });
    const reservationId = "postgres-reconcile-1200";
    assert.equal((await store.reserveEntitlement({
      userId: USER_ID,
      tool: "forms",
      amount: 1200,
      reservationId,
      idempotencyKey: "postgres-reconcile-1200",
    })).ok, true);

    const initial = await store.settleEntitlement({
      userId: USER_ID, reservationId, accepted: 1100, uncertain: 100,
    });
    assert.equal(Number(initial.reservation.accepted), 1100);
    assert.equal(Number(initial.reservation.reserved_remaining), 100);
    assert.deepEqual(initial.balance, { available: 0, consumed: 1100, reserved: 100 });

    const partial = await store.settleEntitlement({
      userId: USER_ID, reservationId, accepted: 1101, uncertain: 99,
    });
    assert.equal(Number(partial.reservation.accepted), 1101);
    assert.equal(Number(partial.reservation.reserved_remaining), 99);
    assert.deepEqual(partial.balance, { available: 0, consumed: 1101, reserved: 99 });

    const duplicate = await store.settleEntitlement({
      userId: USER_ID, reservationId, accepted: 1101, uncertain: 99,
    });
    assert.deepEqual(duplicate.balance, partial.balance);

    const completed = await store.settleEntitlement({
      userId: USER_ID, reservationId, accepted: 1150, uncertain: 0,
    });
    assert.equal(Number(completed.reservation.accepted), 1150);
    assert.equal(Number(completed.reservation.refunded), 50);
    assert.equal(Number(completed.reservation.reserved_remaining), 0);
    assert.deepEqual(completed.balance, { available: 50, consumed: 1150, reserved: 0 });
  });

  test("reserve y settle concurrentes respetan el mismo orden de locks", async () => {
    for (let index = 0; index < 12; index += 1) {
      await store.setEntitlementBalances(USER_ID, {
        forms: { available: 10, consumed: 0, reserved: 0 },
      });
      const reservationId = `lock-order-${index}`;
      const input = {
        userId: USER_ID,
        tool: "forms",
        amount: 10,
        reservationId,
        idempotencyKey: reservationId,
      };
      assert.equal((await store.reserveEntitlement(input)).ok, true);

      const [settled, retried] = await Promise.all([
        store.settleEntitlement({ userId: USER_ID, reservationId, accepted: 10 }),
        store.reserveEntitlement(input),
      ]);
      assert.equal(settled.ok, true);
      assert.equal(retried.ok, true);
      assert.equal(retried.reservation.id, reservationId);
      assert.deepEqual(await store.getEntitlementBalance(USER_ID, "forms"), {
        available: 0, consumed: 10, reserved: 0,
      });
    }
  });

  test("un plan acreditado conserva plan y vencimiento normalizados tras reiniciar", async () => {
    const order = {
      userId: USER_ID,
      provider: "taypi",
      providerOrderId: "99999999-9999-4999-8999-999999999999",
      amountMinor: 9900,
      currency: "PEN",
    };
    await store.recordPaymentAndCredit({ ...order, status: "pending" });
    const paid = await store.recordPaymentAndCredit({
      ...order,
      status: "paid",
      plan: "esencial",
      subscriptionDays: 30,
      credits: { tabulacion: 1 },
    });
    assert.equal(paid.credited, true);
    assert.ok(Date.parse(paid.subscriptionEndsAt) > Date.now());

    await store.closeStore();
    const reloaded = await store.initStore(path.join(tempDir, "users.json"));
    const user = reloaded.usuarios.find((candidate) => candidate.id === USER_ID);
    assert.equal(user.plan, "esencial");
    assert.equal(user.subscriptionEndsAt, paid.subscriptionEndsAt);
  });

  test("el repositorio de identidad consulta Neon, aplica CAS y rechaza Google duplicado", async () => {
    const original = await store.findAuthoritativeUserByEmail("transactions@test.local");
    assert.equal(original.id, USER_ID);
    const expectedUpdatedAt = original.updatedAt;
    original.googleSub = "google-authoritative-sub";
    original.googleLinkedAt = new Date().toISOString();
    original.updatedAt = new Date().toISOString();
    const linked = await store.saveAuthoritativeUser(original, { expectedUpdatedAt });
    assert.ok(Date.parse(linked.updatedAt) > Date.parse(expectedUpdatedAt));
    assert.equal((await store.findAuthoritativeUserById(USER_ID)).googleSub, "google-authoritative-sub");
    assert.equal(
      (await store.findAuthoritativeUserByIdentity("google", "google-authoritative-sub")).id,
      USER_ID,
    );

    const stale = { ...linked, plan: "free", updatedAt: new Date().toISOString() };
    const current = { ...linked, plan: "esencial", updatedAt: new Date().toISOString() };
    const currentSaved = await store.saveAuthoritativeUser(current, {
      expectedUpdatedAt: linked.updatedAt,
    });
    assert.ok(Date.parse(currentSaved.updatedAt) > Date.parse(linked.updatedAt));
    await assert.rejects(
      () => store.saveAuthoritativeUser(stale, { expectedUpdatedAt: linked.updatedAt }),
      (error) => error?.code === "USER_VERSION_CONFLICT",
    );

    const baseUser = (id, email) => ({
      id,
      email,
      emailLower: email,
      role: "user",
      status: "active",
      plan: "free",
      passwordEnabled: false,
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uses: {},
      usesConsumed: {},
      deviceCredentials: [],
      googleSub: "concurrent-google-sub",
      googleLinkedAt: new Date().toISOString(),
    });
    const concurrent = await Promise.allSettled([
      store.saveAuthoritativeUser(baseUser("google-concurrent-a", "google-a@test.local")),
      store.saveAuthoritativeUser(baseUser("google-concurrent-b", "google-b@test.local")),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(
      (result) => result.status === "rejected" && result.reason?.code === "23505",
    ).length, 1);

    await store.closeStore();
    const reloaded = await store.initStore(path.join(tempDir, "users.json"));
    assert.equal(reloaded.usuarios.find((user) => user.id === USER_ID).plan, "esencial");
    assert.equal(
      (await store.findAuthoritativeUserByIdentity("google", "google-authoritative-sub")).id,
      USER_ID,
    );
  });
});
