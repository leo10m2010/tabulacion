const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const app = require('../server.js');

function terminalJob(overrides = {}) {
  return {
    id: '0198a897-3279-7d0b-bac6-bc529ac42d4d',
    status: 'completed_with_errors',
    quotaMode: 'responses',
    reservationId: 'reservation-1200',
    count: 1200,
    sent: 1100,
    accepted: 1100,
    failed: 100,
    uncertain: 0,
    ...overrides,
  };
}

describe('durable Forms quota settlement', () => {
  test('retries transient settlement failures without real waits', async () => {
    const job = terminalJob();
    const waits = [];
    const outcomes = [];
    let calls = 0;
    const manager = {
      supportsCredentiallessSettlement: true,
      async settle(apiKey, reservationId, outcome) {
        calls += 1;
        outcomes.push({ apiKey, reservationId, outcome });
        if (calls < 3) {
          const error = new Error('database unavailable');
          error.code = 'db_unavailable';
          throw error;
        }
        return { ok: true, refunded: 100, reserved: 0, responsesLeft: 100 };
      },
    };

    await app.settleTesistabJob(job, {
      manager,
      retries: 3,
      sleep: async (ms) => waits.push(ms),
    });

    assert.equal(calls, 3);
    assert.deepEqual(waits, [250, 500]);
    assert.equal(outcomes[0].apiKey, '');
    assert.equal(outcomes[0].reservationId, 'reservation-1200');
    assert.deepEqual(outcomes[0].outcome, {
      jobId: job.id,
      requested: 1200,
      accepted: 1100,
      failed: 100,
      uncertain: 0,
      cancelled: 0,
    });
    assert.equal(job.settlementStatus, 'settled');
    assert.equal(job.refunded, 100);
    assert.equal(job.reserved, 0);
    assert.equal(job.responsesLeft, 100);
    assert.equal(job.settlementError, null);
    assert.equal(job.settlementAttempts, 3);
  });

  test('persists pending_retry and reconciles it after a restart-style scan', async () => {
    const job = terminalJob({
      settlementStatus: 'reserved',
      accepted: 1150,
      sent: 1150,
      failed: 50,
    });
    const unavailable = {
      supportsCredentiallessSettlement: true,
      async settle() {
        const error = new Error('do not expose this database message');
        error.code = 'db_unavailable';
        throw error;
      },
    };

    await app.settleTesistabJob(job, {
      manager: unavailable,
      retries: 1,
      sleep: async () => {},
    });
    assert.equal(job.settlementStatus, 'pending_retry');
    assert.equal(job.settlementError, 'db_unavailable');

    let persisted = 0;
    const settled = await app.retryPendingTesistabSettlements({
      jobs: [job],
      manager: {
        supportsCredentiallessSettlement: true,
        async settle(apiKey, reservationId, outcome) {
          assert.equal(apiKey, '');
          assert.equal(reservationId, 'reservation-1200');
          assert.equal(outcome.accepted, 1150);
          return { ok: true, refunded: 50, reserved: 0, responsesLeft: 50 };
        },
      },
      retries: 1,
      sleep: async () => {},
      persist: async (updated) => {
        assert.equal(updated, job);
        persisted += 1;
      },
    });

    assert.equal(settled, 1);
    assert.equal(persisted, 1);
    assert.equal(job.settlementStatus, 'settled');
    assert.equal(job.refunded, 50);
    assert.equal(job.reserved, 0);
  });

  test('watchdog bloquea un POST en vuelo como incierto sin fallarlo ni reembolsarlo', async () => {
    const job = terminalJob({
      status: 'running',
      count: 10,
      sent: 5,
      accepted: 5,
      failed: 0,
      uncertain: 0,
      uncertainDeliveries: [],
      inFlightIndex: 5,
      currentIndex: 5,
      cursor: 5,
      delayMs: 0,
      jitterMs: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
    });
    let settlementCalls = 0;
    let persisted = 0;

    await app.runTesistabWatchdogCycle({
      now: Date.parse('2026-01-02T00:00:00.000Z'),
      watchdogJobs: [job],
      jobs: [],
      manager: {
        supportsCredentiallessSettlement: true,
        async settle() {
          settlementCalls += 1;
          return { ok: true };
        },
      },
      persist: async (updated) => {
        assert.equal(updated, job);
        persisted += 1;
      },
      sleep: async () => {},
    });

    assert.equal(job.status, 'blocked');
    assert.equal(job.failed, 0);
    assert.equal(job.sent, 5);
    assert.equal(job.accepted, 5);
    assert.equal(job.uncertain, 1);
    assert.equal(job.inFlightIndex, 5);
    assert.deepEqual(job.uncertainDeliveries, [
      { index: 5, source: 'watchdog_timeout' },
    ]);
    assert.equal(job.recoverableError.code, 'delivery_uncertain_after_restart');
    assert.equal(settlementCalls, 0);
    assert.equal(persisted, 1);

    const reconciliation = app.reconcileTesistabDelivery(job, { accepted: true, index: 5 });
    assert.deepEqual(reconciliation, { ok: true, terminal: false, index: 5 });
    assert.equal(job.status, 'queued');
    assert.equal(job.sent, 6);
    assert.equal(job.accepted, 6);
    assert.equal(job.failed, 0);
    assert.equal(job.uncertain, 0);
    assert.equal(job.inFlightIndex, null);
  });

  test('concilia respuestas terminales uncertain una por una y liquida solo la decidida', async () => {
    const job = terminalJob({
      status: 'completed',
      count: 2,
      sent: 2,
      accepted: 0,
      failed: 0,
      uncertain: 0,
      uncertainDeliveries: [],
      settlementStatus: 'reconciliation_pending',
    });
    app.recordUncertainDelivery(job, 0, 'provider_response');
    app.recordUncertainDelivery(job, 1, 'provider_response');
    const outcomes = [];
    const manager = {
      supportsCredentiallessSettlement: true,
      async settle(apiKey, reservationId, outcome) {
        outcomes.push({ ...outcome });
        return outcome.uncertain === 1
          ? { ok: true, refunded: 0, reserved: 1, responsesLeft: 0 }
          : { ok: true, refunded: 1, reserved: 0, responsesLeft: 1 };
      },
    };

    const accepted = app.reconcileTesistabDelivery(job, { accepted: true, index: 0 });
    assert.deepEqual(accepted, { ok: true, terminal: true, index: 0 });
    await app.settleTesistabJob(job, { manager, retries: 1, sleep: async () => {} });
    assert.deepEqual(outcomes[0], {
      jobId: job.id,
      requested: 2,
      accepted: 1,
      failed: 0,
      uncertain: 1,
      cancelled: 0,
    });
    assert.equal(job.status, 'completed');
    assert.equal(job.settlementStatus, 'reconciliation_pending');
    assert.equal(job.reserved, 1);

    const rejected = app.reconcileTesistabDelivery(job, { accepted: false, index: 1 });
    assert.deepEqual(rejected, { ok: true, terminal: true, index: 1 });
    await app.settleTesistabJob(job, { manager, retries: 1, sleep: async () => {} });
    assert.deepEqual(outcomes[1], {
      jobId: job.id,
      requested: 2,
      accepted: 1,
      failed: 1,
      uncertain: 0,
      cancelled: 0,
    });
    assert.equal(job.sent, 1);
    assert.equal(job.failed, 1);
    assert.equal(job.uncertain, 0);
    assert.deepEqual(job.uncertainDeliveries, []);
    assert.equal(job.settlementStatus, 'settled');
    assert.equal(job.refunded, 1);
    assert.equal(job.reserved, 0);
  });
});
