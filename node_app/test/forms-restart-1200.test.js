import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claimDurableJob,
  closeStore,
  createDurableJob,
  createDurableJobBatches,
  getDurableJob,
  initStore,
  listDurableJobBatches,
  reserveEntitlement,
  setEntitlementBalances,
  settleEntitlement,
  updateDurableJob,
} from "../lib/store/index.js";

test("1,200 respuestas sobreviven un reinicio controlado sin perdida ni duplicados", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tesishub-forms-restart-"));
  const userId = "forms-restart-user";
  const jobId = "forms-restart-job";
  const reservationId = "forms-restart-reservation";
  try {
    await initStore(path.join(dir, "users.json"));
    await setEntitlementBalances(userId, {
      forms: { available: 1200, consumed: 0, reserved: 0 },
    });
    const reservation = await reserveEntitlement({
      userId,
      tool: "forms",
      amount: 1200,
      reservationId,
      idempotencyKey: "forms-restart-1200",
    });
    assert.equal(reservation.ok, true);

    await createDurableJob({
      id: jobId,
      userId,
      type: "forms",
      status: "queued",
      parameters: { job: { id: jobId, count: 1200, currentIndex: 0, sent: 0 } },
      progress: { requested: 1200, accepted: 0, cursor: 0 },
      idempotencyKey: "forms-restart-job-1200",
    });
    await createDurableJobBatches({ jobId, total: 1200, batchSize: 100 });

    const acceptedAttemptIds = new Set();
    let claimed = await claimDurableJob({ type: "forms", workerId: "worker-before", leaseMs: 60_000 });
    assert.equal(claimed.id, jobId);
    for (let index = 0; index < 600; index += 1) {
      const attemptId = `${jobId}:${index}`;
      assert.equal(acceptedAttemptIds.has(attemptId), false);
      acceptedAttemptIds.add(attemptId);
      const job = { ...claimed.parameters.job, currentIndex: index + 1, sent: index + 1, inFlightIndex: null };
      claimed = await updateDurableJob(jobId, {
        status: "running",
        parameters: { ...claimed.parameters, job },
        progress: { requested: 1200, accepted: index + 1, cursor: index + 1 },
        workerId: "worker-before",
        renewLeaseMs: 60_000,
      });
      assert.ok(claimed);
    }

    // Corte del proceso entre dos intentos ya confirmados. Se fuerza el lease
    // vencido que Neon observaria al cabo del TTL y un segundo worker reclama.
    await updateDurableJob(jobId, {
      status: "running",
      leaseOwner: "worker-before",
      leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    claimed = await claimDurableJob({ type: "forms", workerId: "worker-after", leaseMs: 60_000 });
    assert.equal(claimed.progress.cursor, 600);

    for (let index = claimed.progress.cursor; index < 1200; index += 1) {
      const attemptId = `${jobId}:${index}`;
      assert.equal(acceptedAttemptIds.has(attemptId), false, `intento duplicado ${attemptId}`);
      acceptedAttemptIds.add(attemptId);
      const job = { ...claimed.parameters.job, currentIndex: index + 1, sent: index + 1, inFlightIndex: null };
      claimed = await updateDurableJob(jobId, {
        status: index === 1199 ? "completed" : "running",
        parameters: { ...claimed.parameters, job },
        progress: { requested: 1200, accepted: index + 1, cursor: index + 1 },
        workerId: "worker-after",
        ...(index === 1199 ? { clearLease: true } : { renewLeaseMs: 60_000 }),
      });
      assert.ok(claimed);
    }

    const settlement = await settleEntitlement({
      userId,
      reservationId,
      accepted: 1200,
    });
    assert.equal(settlement.ok, true);
    assert.equal(acceptedAttemptIds.size, 1200);
    assert.deepEqual(settlement.balance, { available: 0, consumed: 1200, reserved: 0 });
    assert.equal((await listDurableJobBatches(jobId)).length, 12);
    assert.equal((await getDurableJob(jobId)).progress.cursor, 1200);
  } finally {
    await closeStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
