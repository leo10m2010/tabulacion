import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import {
  claimDurableJob,
  closeStore,
  controlDurableJob,
  createDurableJob,
  createSessionRecord,
  consumeEntitlement,
  getEntitlementBalance,
  getDurableJob,
  getSessionByTokenHash,
  initStore,
  recordPaymentAndCredit,
  reserveEntitlement,
  setEntitlementBalances,
  updateDurableJob,
  revokeSessionByTokenHash,
} from "../lib/store/index.js";

describe("transacciones durables en el backend local", () => {
  let tempDir;
  const userId = "user-store-transactions";

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tesishub-store-transactions-"));
    const usersPath = path.join(tempDir, "users.json");
    fs.writeFileSync(usersPath, JSON.stringify([{
      id: userId,
      email: "store@test.local",
      emailLower: "store@test.local",
      role: "user",
      status: "active",
      plan: "free",
      uses: { forms: 0, tabulacion: 0 },
      usesConsumed: { forms: 0, tabulacion: 0 },
    }]), "utf8");
    await initStore(usersPath);
  });

  after(async () => {
    await closeStore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("un webhook duplicado no acredita dos veces y una discrepancia se rechaza", async () => {
    const order = {
      userId,
      provider: "taypi",
      providerOrderId: "11111111-1111-4111-8111-111111111111",
      amountMinor: 4900,
      currency: "PEN",
      payload: { order: { planId: "esencial" } },
    };
    await recordPaymentAndCredit({ ...order, status: "pending" });
    const first = await recordPaymentAndCredit({
      ...order,
      status: "paid",
      credits: { forms: 500, tabulacion: 10 },
    });
    const duplicate = await recordPaymentAndCredit({
      ...order,
      status: "paid",
      credits: { forms: 500, tabulacion: 10 },
    });

    assert.equal(first.credited, true);
    assert.equal(duplicate.credited, false);
    assert.equal((await getEntitlementBalance(userId, "forms")).available, 500);
    assert.equal((await getEntitlementBalance(userId, "tabulacion")).available, 10);
    await assert.rejects(
      recordPaymentAndCredit({ ...order, status: "paid", amountMinor: 1, credits: { forms: 500 } }),
      { code: "PAYMENT_ORDER_MISMATCH" },
    );
  });

  test("una sesion revocada conserva el registro y queda marcada", async () => {
    await createSessionRecord({
      id: "22222222-2222-4222-8222-222222222222",
      userId,
      tokenHash: "token-hash-test",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal((await getSessionByTokenHash("token-hash-test")).revokedAt, undefined);
    await revokeSessionByTokenHash("token-hash-test");
    assert.ok((await getSessionByTokenHash("token-hash-test")).revokedAt);
  });

  test("un job queued se reclama una sola vez y recibe lease", async () => {
    await createDurableJob({
      id: "forms-job-queued",
      userId,
      type: "forms",
      status: "queued",
      parameters: { payload: { requestedResponses: 1200 } },
      progress: { requested: 1200 },
      idempotencyKey: "forms-1200",
    });
    const claimed = await claimDurableJob({ type: "forms", workerId: "worker-a", leaseMs: 30_000 });
    const second = await claimDurableJob({ type: "forms", workerId: "worker-b", leaseMs: 30_000 });
    assert.equal(claimed.id, "forms-job-queued");
    assert.equal(claimed.status, "processing");
    assert.equal(claimed.leaseOwner, "worker-a");
    assert.equal(second, null);

    await controlDurableJob(claimed.id, {
      status: "paused",
      jobPatch: { pauseRequested: true },
    });
    const controlled = await getDurableJob(claimed.id);
    assert.equal(controlled.status, "paused");
    assert.equal(controlled.parameters.job.pauseRequested, true);
    assert.deepEqual(controlled.parameters.payload, { requestedResponses: 1200 });
    assert.deepEqual(controlled.progress, { requested: 1200 });
    assert.equal(controlled.leaseOwner, "worker-a");
  });

  test("solo una generacion pesada global puede quedar activa", async () => {
    const first = await createDurableJob({
      id: "heavy-generation-a",
      userId,
      type: "descriptiva",
      status: "processing",
      parameters: { input: { texto: "instrumento" } },
      progress: { stage: "generating" },
    });
    const blocked = await createDurableJob({
      id: "heavy-generation-b",
      userId: "another-user",
      type: "titulos",
      status: "processing",
      parameters: { input: { tema: "gestion" } },
      progress: { stage: "generating" },
    });
    assert.equal(first.id, "heavy-generation-a");
    assert.equal(blocked.id, first.id, "el gate devuelve el job que ocupa la capacidad");

    await updateDurableJob(first.id, {
      status: "completed",
      parameters: { artifactId: "artifact-a" },
      progress: { stage: "completed", result: { resumen: { n: 60 } } },
    });
    const afterCompletion = await createDurableJob({
      id: "heavy-generation-b",
      userId: "another-user",
      type: "titulos",
      status: "processing",
      progress: { stage: "generating" },
    });
    assert.equal(afterCompletion.id, "heavy-generation-b");
  });

  test("consumos y reservas repetidos conservan exactamente un movimiento", async () => {
    await setEntitlementBalances(userId, {
      forms: { available: 1200, consumed: 0, reserved: 0 },
      tabulacion: { available: 2, consumed: 0, reserved: 0 },
    });

    const [firstConsume, duplicateConsume] = await Promise.all([
      consumeEntitlement({
        userId, tool: "tabulacion", amount: 1, idempotencyKey: "consume-same-1",
      }),
      consumeEntitlement({
        userId, tool: "tabulacion", amount: 1, idempotencyKey: "consume-same-1",
      }),
    ]);
    assert.equal(firstConsume.ok, true);
    assert.equal(duplicateConsume.ok, true);
    assert.deepEqual(await getEntitlementBalance(userId, "tabulacion"), {
      available: 1, consumed: 1, reserved: 0,
    });

    const reservation = {
      userId,
      tool: "forms",
      amount: 1200,
      reservationId: "reservation-1200",
      idempotencyKey: "reserve-same-1200",
    };
    const [firstReserve, duplicateReserve] = await Promise.all([
      reserveEntitlement(reservation),
      reserveEntitlement({ ...reservation, reservationId: "reservation-retry-1200" }),
    ]);
    assert.equal(firstReserve.ok, true);
    assert.equal(duplicateReserve.ok, true);
    assert.equal(firstReserve.reservation.id, duplicateReserve.reservation.id);
    assert.deepEqual(await getEntitlementBalance(userId, "forms"), {
      available: 0, consumed: 0, reserved: 1200,
    });
  });
});
