import crypto from "crypto";
import path from "path";
import {
  claimDurableJob,
  closeStore,
  getDurableJob,
  initStore,
  listDurableJobs,
  releaseEntitlement,
  reserveEntitlement,
  settleEntitlement,
  updateDurableJob,
  updateDurableJobBatch,
} from "./lib/store/index.js";
import { metrics, structuredLog } from "./lib/observability.js";

const hashCredential = (value) => crypto
  .createHash("sha256")
  .update(String(value ?? ""))
  .digest("hex");

const toFormsJob = (stored) => {
  if (!stored) return null;
  const job = stored.parameters?.job ?? {};
  return {
    ...job,
    id: stored.id,
    ownerUserId: stored.userId,
    status: stored.status,
    leaseOwner: stored.leaseOwner ?? null,
    leaseExpiresAt: stored.leaseExpiresAt ?? null,
    attempts: stored.attempts ?? 0,
    createdAt: job.createdAt ?? stored.createdAt,
    updatedAt: stored.updatedAt,
  };
};

export async function createFormsWorkerAdapter() {
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    throw new Error("DATABASE_URL is required by the production Forms worker");
  }
  const loaded = await initStore(
    process.env.USER_STORE_PATH || path.join(process.cwd(), "data", "users.json"),
  );
  const users = loaded.usuarios;
  const findCredentialOwner = (credential) => {
    const hash = hashCredential(credential);
    return users.find((user) => user.apiKeyHash === hash
      || (Array.isArray(user.deviceCredentials)
        && user.deviceCredentials.some((device) => (
          device.credentialHash === hash && !device.revokedAt
        ))));
  };
  const userIdForOutcome = async (outcome = {}) => {
    const job = outcome.jobId ? await getDurableJob(String(outcome.jobId)) : null;
    return job?.userId ?? null;
  };

  const jobRepository = {
    async create() {
      throw new Error("The Forms worker does not create jobs");
    },
    async get(id) {
      return toFormsJob(await getDurableJob(id));
    },
    async list(filters = {}) {
      const jobs = await listDurableJobs({ ...filters, type: "forms" });
      return jobs.map(toFormsJob);
    },
    async update(job, { workerId, leaseMs } = {}) {
      const previous = await getDurableJob(job.id);
      if (!previous) return null;
      const active = ["processing", "running", "paused", "cancelling"].includes(job.status);
      const stored = await updateDurableJob(job.id, {
        status: job.status,
        parameters: { ...previous.parameters, job },
        progress: {
          requested: job.requested ?? job.count ?? 0,
          accepted: job.sent ?? 0,
          failed: job.failed ?? 0,
          uncertain: job.uncertain ?? 0,
          cursor: job.currentIndex ?? 0,
        },
        ...(active ? { renewLeaseMs: leaseMs } : { clearLease: true }),
        workerId,
      });
      if (!stored) return null;
      if (job.currentBatch > 0) {
        const batchSize = job.batchSize ?? 100;
        const batchStart = (job.currentBatch - 1) * batchSize;
        const batchEnd = Math.min(
          job.requested ?? job.count ?? 0,
          job.currentBatch * batchSize,
        );
        const batch = await updateDurableJobBatch(job.id, job.currentBatch, {
          status: (job.currentIndex ?? 0) >= batchEnd ? "completed" : job.status,
          cursor: Math.max(0, Math.min(batchSize, (job.currentIndex ?? 0) - batchStart)),
          attempts: job.attempts ?? 0,
          workerId,
        });
        if (!batch && workerId) return null;
      }
      return toFormsJob(stored);
    },
    async claim({ workerId, leaseMs }) {
      const stored = await claimDurableJob({ type: "forms", workerId, leaseMs });
      if (!stored) return null;
      return {
        job: toFormsJob(stored),
        payload: stored.parameters?.payload ?? null,
      };
    },
  };

  const usageManager = {
    supportsCredentiallessSettlement: true,
    async reserve(apiKey, requested, meta = {}) {
      const owner = findCredentialOwner(apiKey);
      if (!owner) return { ok: false, reason: "clave_desconocida" };
      if (owner.role === "admin") {
        return { ok: true, reservationId: meta.reservationId, reserved: requested, responsesLeft: null };
      }
      return reserveEntitlement({
        userId: owner.id,
        tool: "forms",
        amount: requested,
        reservationId: meta.reservationId,
        idempotencyKey: meta.idempotencyKey ?? meta.reservationId,
        metadata: meta,
      });
    },
    async settle(_apiKey, reservationId, outcome = {}) {
      const userId = await userIdForOutcome(outcome);
      if (!userId) return { ok: false, reason: "trabajo_desconocido" };
      const result = await settleEntitlement({
        userId,
        reservationId: String(reservationId),
        accepted: Math.max(0, Math.floor(Number(outcome.accepted) || 0)),
        uncertain: Math.max(0, Math.floor(Number(outcome.uncertain) || 0)),
        metadata: outcome,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        consumed: Number(result.reservation.accepted),
        refunded: Number(result.reservation.refunded),
        reserved: Number(result.reservation.reservedRemaining
          ?? result.reservation.reserved_remaining ?? 0),
        responsesLeft: result.balance.available,
      };
    },
    async release(_apiKey, reservationId, meta = {}) {
      const userId = await userIdForOutcome(meta);
      if (!userId) return { ok: false, reason: "trabajo_desconocido" };
      const result = await releaseEntitlement({
        userId,
        reservationId: String(reservationId),
        metadata: meta,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        consumed: Number(result.reservation.accepted),
        refunded: Number(result.reservation.refunded),
        responsesLeft: result.balance.available,
      };
    },
  };

  return {
    jobRepository,
    usageManager,
    keyValidator(apiKey) {
      const owner = findCredentialOwner(apiKey);
      if (!owner || owner.status !== "active") return { valid: false };
      return {
        valid: true,
        email: owner.email,
        plan: owner.plan,
        role: owner.role,
      };
    },
    metricsObserver(event, fields = {}) {
      if (event === "response") {
        metrics.increment("forms_responses_total", 1, {
          outcome: String(fields.outcome ?? "unknown"),
        });
      } else if (event === "job_blocked") {
        metrics.increment("forms_jobs_blocked_total", 1, {
          reason: String(fields.reason ?? "unknown"),
        });
        structuredLog("warn", "forms_job_blocked", {
          reason: String(fields.reason ?? "unknown"),
        });
      }
    },
    async close() {
      await closeStore();
    },
  };
}
