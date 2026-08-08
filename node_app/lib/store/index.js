import crypto from "crypto";
import fs from "fs";
import path from "path";
import { runStoreMigrations, storeTables, verifyStoreMigrations } from "./migrations.js";
import { acquireStorePool, releaseStorePool } from "./db.js";
import { errorLogFields, metrics, structuredLog } from "../observability.js";

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
export const usingPostgres = Boolean(DATABASE_URL);
const AUTO_MIGRATE = !new Set(["0", "false", "no", "off"]).has(
  String(
    process.env.STORE_AUTO_MIGRATE
      ?? (process.env.NODE_ENV === "production" ? "false" : "true"),
  ).trim().toLowerCase(),
);

const paymentCredits = (input) => {
  const raw = input.credits && typeof input.credits === "object"
    ? input.credits
    : (input.tool ? { [input.tool]: input.creditAmount } : {});
  return Object.fromEntries(Object.entries(raw)
    .map(([tool, amount]) => [String(tool), Math.max(0, Math.floor(Number(amount) || 0))])
    .filter(([tool, amount]) => tool && amount > 0));
};

const HEAVY_GENERATION_TYPES = new Set([
  "tabulacion", "descriptiva", "titulos", "matriz", "humanizador",
]);
const ACTIVE_GENERATION_STATUSES = new Set(["pending", "queued", "processing", "running"]);

const assertPaymentMatchesOrder = (payment, input) => {
  const userId = payment.userId ?? payment.user_id;
  const amountMinor = Number(payment.amountMinor ?? payment.amount_minor);
  if (String(userId) !== String(input.userId)
    || amountMinor !== Number(input.amountMinor)
    || String(payment.currency) !== String(input.currency)) {
    const error = new Error("El pago no coincide con la orden registrada.");
    error.code = "PAYMENT_ORDER_MISMATCH";
    throw error;
  }
};

const crearEscritor = (guardar, etiqueta) => {
  let enVuelo = null;
  let pendiente = null;
  let ultimoError = null;

  const bucle = async () => {
    while (pendiente !== null) {
      const instantanea = pendiente;
      pendiente = null;
      try {
        await guardar(instantanea);
        ultimoError = null;
      } catch (err) {
        ultimoError = err;
        metrics.increment("store_persist_failures_total", 1);
        structuredLog("error", "store.persist_failed", {
          section: etiqueta, ...errorLogFields(err),
        });
      }
    }
    enVuelo = null;
  };

  return {
    encolar(valor) {
      pendiente = JSON.stringify(valor);
      if (!enVuelo) enVuelo = bucle();
    },
    async vaciar() {
      while (enVuelo) await enVuelo;
      if (ultimoError) throw ultimoError;
    },
  };
};

const leerArreglo = (ruta, porDefecto = []) => {
  if (!fs.existsSync(ruta)) return porDefecto;
  const parsed = JSON.parse(fs.readFileSync(ruta, "utf-8"));
  if (!Array.isArray(parsed)) throw new Error(`${path.basename(ruta)} no contiene un arreglo JSON.`);
  return parsed;
};

const backendArchivo = (rutaUsuarios) => {
  const dir = path.dirname(rutaUsuarios);
  const rutas = {
    pendientes: path.join(dir, "pending-uses.json"),
    borradas: path.join(dir, "deleted-accounts.json"),
    reservas: path.join(dir, "entitlement-reservations.json"),
    jobs: path.join(dir, "jobs.json"),
    batches: path.join(dir, "job-batches.json"),
    artifacts: path.join(dir, "artifacts.json"),
    payments: path.join(dir, "payments.json"),
    ledger: path.join(dir, "entitlement-ledger.json"),
    pairings: path.join(dir, "device-pairings.json"),
    sessions: path.join(dir, "sessions.json"),
  };
  const balances = new Map();
  let reservas = [];
  let jobs = [];
  let batches = [];
  let artifacts = [];
  let payments = [];
  let pairings = [];
  let sessions = [];
  let operationKeys = new Set();

  const escribirAtomico = (ruta, contenido) => {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, contenido, "utf-8");
    fs.renameSync(tmp, ruta);
  };
  const clave = (userId, tool) => `${userId}:${tool}`;
  const sincronizar = (usuarios) => {
    for (const user of usuarios) {
      const disponibles = user.uses && typeof user.uses === "object" ? user.uses : {};
      const consumidos = user.usesConsumed && typeof user.usesConsumed === "object"
        ? user.usesConsumed : {};
      for (const tool of Object.keys(disponibles)) {
        const k = clave(user.id, tool);
        const anterior = balances.get(k);
        balances.set(k, {
          available: Math.max(0, Math.floor(Number(disponibles[tool]) || 0)),
          consumed: Math.max(0, Math.floor(Number(consumidos[tool]) || 0)),
          reserved: anterior?.reserved ?? 0,
        });
      }
    }
  };
  const saldo = (userId, tool) => balances.get(clave(userId, tool))
    ?? { available: 0, consumed: 0, reserved: 0 };
  const guardarReservas = () => escribirAtomico(rutas.reservas, JSON.stringify(reservas));

  return {
    async cargar() {
      fs.mkdirSync(dir, { recursive: true });
      const usuarios = leerArreglo(rutaUsuarios);
      reservas = leerArreglo(rutas.reservas);
      jobs = leerArreglo(rutas.jobs);
      batches = leerArreglo(rutas.batches);
      artifacts = leerArreglo(rutas.artifacts);
      payments = leerArreglo(rutas.payments);
      pairings = leerArreglo(rutas.pairings);
      sessions = leerArreglo(rutas.sessions);
      operationKeys = new Set(leerArreglo(rutas.ledger));
      sincronizar(usuarios);
      return {
        usuarios,
        pendientes: leerArreglo(rutas.pendientes),
        borradas: leerArreglo(rutas.borradas),
      };
    },
    async guardarUsuarios(json) {
      const usuarios = JSON.parse(json);
      sincronizar(usuarios);
      escribirAtomico(rutaUsuarios, json);
    },
    async guardarPendientes(json) { escribirAtomico(rutas.pendientes, json); },
    async guardarBorradas(json) { escribirAtomico(rutas.borradas, json); },
    async getBalance(userId, tool) { return { ...saldo(userId, tool) }; },
    async setBalances(userId, values) {
      for (const [tool, value] of Object.entries(values)) {
        balances.set(clave(userId, tool), {
          available: Math.max(0, Math.floor(Number(value.available) || 0)),
          consumed: Math.max(0, Math.floor(Number(value.consumed) || 0)),
          reserved: Math.max(0, Math.floor(Number(value.reserved) || 0)),
        });
      }
    },
    async consume({ userId, tool, amount, idempotencyKey }) {
      const actual = saldo(userId, tool);
      const opKey = idempotencyKey ? `${userId}:${tool}:${idempotencyKey}` : null;
      if (opKey && operationKeys.has(opKey)) {
        return { ok: true, idempotent: true, balance: { ...actual } };
      }
      if (actual.available < amount) return { ok: false, reason: "sin_usos", balance: actual };
      const next = { ...actual, available: actual.available - amount, consumed: actual.consumed + amount };
      balances.set(clave(userId, tool), next);
      if (opKey) {
        operationKeys.add(opKey);
        escribirAtomico(rutas.ledger, JSON.stringify([...operationKeys]));
      }
      return { ok: true, balance: next };
    },
    async refund({ userId, tool, amount, idempotencyKey }) {
      const actual = saldo(userId, tool);
      const opKey = idempotencyKey ? `${userId}:${tool}:${idempotencyKey}` : null;
      if (opKey && operationKeys.has(opKey)) {
        return { ok: true, idempotent: true, balance: { ...actual } };
      }
      const next = {
        ...actual,
        available: actual.available + amount,
        consumed: Math.max(0, actual.consumed - amount),
      };
      balances.set(clave(userId, tool), next);
      if (opKey) {
        operationKeys.add(opKey);
        escribirAtomico(rutas.ledger, JSON.stringify([...operationKeys]));
      }
      return { ok: true, balance: next };
    },
    async reserve({ userId, tool, amount, reservationId, idempotencyKey, metadata }) {
      const existente = reservas.find((r) => r.id === reservationId
        || (idempotencyKey && r.userId === userId && r.tool === tool
          && r.idempotencyKey === idempotencyKey));
      if (existente) {
        return { ok: true, reservation: existente, balance: { ...saldo(userId, tool) } };
      }
      const actual = saldo(userId, tool);
      if (actual.available < amount) return { ok: false, reason: "sin_usos", balance: actual };
      const next = {
        available: actual.available - amount,
        consumed: actual.consumed,
        reserved: actual.reserved + amount,
      };
      balances.set(clave(userId, tool), next);
      const reservation = {
        id: reservationId, userId, tool, requested: amount, accepted: 0, refunded: 0,
        uncertain: 0, reservedRemaining: amount, status: "reserved",
        idempotencyKey: idempotencyKey || null, metadata: metadata ?? {},
      };
      reservas.push(reservation);
      guardarReservas();
      return { ok: true, reservation, balance: next };
    },
    async settle({ userId, reservationId, accepted, uncertain: uncertainInput = 0 }) {
      const reservation = reservas.find((r) => r.id === reservationId && r.userId === userId);
      if (!reservation) return { ok: false, reason: "reserva_desconocida" };
      if (!["reserved", "uncertain"].includes(reservation.status)) {
        return { ok: true, reservation, balance: { ...saldo(userId, reservation.tool) } };
      }
      const inPlay = reservation.reservedRemaining ?? reservation.requested;
      // `accepted` es el total acumulado confirmado por el job, no un delta.
      // Tras un primer settlement con respuestas inciertas, consumir otra vez
      // ese total agotaria toda la reserva restante al conciliar solo una.
      const previousAccepted = Math.max(0, Math.floor(Number(reservation.accepted) || 0));
      const targetAccepted = Math.min(
        Number(reservation.requested) || 0,
        Math.max(previousAccepted, Math.floor(Number(accepted) || 0)),
      );
      const consumed = Math.min(inPlay, targetAccepted - previousAccepted);
      const uncertain = Math.min(
        inPlay - consumed,
        Math.max(0, Math.floor(Number(uncertainInput) || 0)),
      );
      const refunded = inPlay - consumed - uncertain;
      const actual = saldo(userId, reservation.tool);
      if (consumed === 0 && refunded === 0 && uncertain === inPlay) {
        return { ok: true, reservation, balance: { ...actual } };
      }
      const next = {
        available: actual.available + refunded,
        consumed: actual.consumed + consumed,
        reserved: Math.max(0, actual.reserved - inPlay + uncertain),
      };
      balances.set(clave(userId, reservation.tool), next);
      Object.assign(reservation, {
        accepted: (reservation.accepted ?? 0) + consumed,
        refunded: (reservation.refunded ?? 0) + refunded,
        uncertain,
        reservedRemaining: uncertain,
        status: uncertain > 0 ? "uncertain" : "settled",
      });
      guardarReservas();
      return { ok: true, reservation, balance: next };
    },
    async release({ userId, reservationId }) {
      return this.settle({ userId, reservationId, accepted: 0 });
    },
    async deleteUserData(userId) {
      for (const k of [...balances.keys()]) if (k.startsWith(`${userId}:`)) balances.delete(k);
      reservas = reservas.filter((r) => r.userId !== userId);
      jobs = jobs.filter((item) => item.userId !== userId);
      const liveJobIds = new Set(jobs.map((item) => item.id));
      batches = batches.filter((item) => liveJobIds.has(item.jobId));
      artifacts = artifacts.filter((item) => item.userId !== userId);
      pairings = pairings.filter((item) => item.userId !== userId);
      sessions = sessions.filter((item) => item.userId !== userId);
      guardarReservas();
      escribirAtomico(rutas.jobs, JSON.stringify(jobs));
      escribirAtomico(rutas.batches, JSON.stringify(batches));
      escribirAtomico(rutas.artifacts, JSON.stringify(artifacts));
      escribirAtomico(rutas.pairings, JSON.stringify(pairings));
      escribirAtomico(rutas.sessions, JSON.stringify(sessions));
    },
    async createSession(session) {
      const stored = { ...session, id: session.id ?? crypto.randomUUID(), createdAt: new Date().toISOString() };
      sessions.push(stored);
      escribirAtomico(rutas.sessions, JSON.stringify(sessions));
      return stored;
    },
    async getSessionByTokenHash(tokenHash) {
      return sessions.find((item) => item.tokenHash === tokenHash) ?? null;
    },
    async revokeSessionByTokenHash(tokenHash) {
      const item = sessions.find((session) => session.tokenHash === tokenHash);
      if (!item) return null;
      item.revokedAt ??= new Date().toISOString();
      escribirAtomico(rutas.sessions, JSON.stringify(sessions));
      return { ...item };
    },
    async revokeSessionsByUser(userId) {
      let count = 0;
      for (const session of sessions) {
        if (session.userId === userId && !session.revokedAt) {
          session.revokedAt = new Date().toISOString();
          count += 1;
        }
      }
      escribirAtomico(rutas.sessions, JSON.stringify(sessions));
      return count;
    },
    async listSessionsByUser(userId) {
      return sessions.filter((session) => session.userId === userId)
        .sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0))
        .map((session) => ({ ...session }));
    },
    async revokeOtherSessions(userId, keepTokenHash) {
      let count = 0;
      for (const session of sessions) {
        if (session.userId === userId && session.tokenHash !== keepTokenHash && !session.revokedAt) {
          session.revokedAt = new Date().toISOString();
          count += 1;
        }
      }
      escribirAtomico(rutas.sessions, JSON.stringify(sessions));
      return count;
    },
    async createPairing(pairing) {
      pairings.push({ ...pairing });
      escribirAtomico(rutas.pairings, JSON.stringify(pairings));
      return { ...pairing };
    },
    async getPairing(id) { return pairings.find((item) => item.id === id) ?? null; },
    async findPairingByCodeHash(userCodeHash) {
      return pairings.find((item) => item.userCodeHash === userCodeHash) ?? null;
    },
    async updatePairing(id, patch) {
      const item = pairings.find((entry) => entry.id === id);
      if (!item) return null;
      if (patch.expectedStatus && item.status !== patch.expectedStatus) return null;
      if (patch.requireUnconsumed && item.consumedAt) return null;
      if (patch.requireNotExpired && Date.parse(item.expiresAt ?? "") <= Date.now()) return null;
      const storedPatch = { ...patch };
      delete storedPatch.expectedStatus;
      delete storedPatch.requireUnconsumed;
      delete storedPatch.requireNotExpired;
      Object.assign(item, storedPatch);
      escribirAtomico(rutas.pairings, JSON.stringify(pairings));
      return { ...item };
    },
    async createJob(job) {
      const existing = jobs.find((item) => item.id === job.id)
        ?? jobs.find((item) => job.idempotencyKey && item.userId === job.userId
          && item.type === job.type && item.idempotencyKey === job.idempotencyKey)
        ?? jobs.find((item) => HEAVY_GENERATION_TYPES.has(job.type)
          && ACTIVE_GENERATION_STATUSES.has(job.status ?? "pending")
          && HEAVY_GENERATION_TYPES.has(item.type)
          && ACTIVE_GENERATION_STATUSES.has(item.status));
      if (existing) return { ...existing };
      const now = new Date().toISOString();
      const stored = {
        ...job, status: job.status ?? "pending", progress: job.progress ?? {},
        parameters: job.parameters ?? {}, attempts: 0, createdAt: now, updatedAt: now,
      };
      jobs.push(stored);
      escribirAtomico(rutas.jobs, JSON.stringify(jobs));
      return { ...stored };
    },
    async updateJob(id, patch) {
      const item = jobs.find((entry) => entry.id === id);
      if (!item) return null;
      const { workerId, renewLeaseMs, clearLease, ...storedPatch } = patch;
      if (workerId) {
        const leaseExpiresAt = Date.parse(item.leaseExpiresAt ?? "");
        if (item.leaseOwner !== workerId
          || !Number.isFinite(leaseExpiresAt)
          || leaseExpiresAt <= Date.now()) return null;
      }
      Object.assign(item, storedPatch, { updatedAt: new Date().toISOString() });
      if (clearLease === true) {
        item.leaseOwner = null;
        item.leaseExpiresAt = null;
      } else if (workerId && Number(renewLeaseMs) > 0) {
        item.leaseExpiresAt = new Date(Date.now() + Number(renewLeaseMs)).toISOString();
      }
      escribirAtomico(rutas.jobs, JSON.stringify(jobs));
      return { ...item };
    },
    async controlJob(id, { status, jobPatch = {} }) {
      const item = jobs.find((entry) => entry.id === id);
      if (!item) return null;
      item.status = status ?? item.status;
      item.parameters = {
        ...(item.parameters ?? {}),
        job: { ...(item.parameters?.job ?? {}), ...jobPatch },
      };
      item.updatedAt = new Date().toISOString();
      escribirAtomico(rutas.jobs, JSON.stringify(jobs));
      return { ...item };
    },
    async getJob(id) { return jobs.find((item) => item.id === id) ?? null; },
    async listJobs({ userId, type, status, limit = 100, since }) {
      return jobs.filter((item) => (!userId || item.userId === userId)
        && (!type || item.type === type)
        && (!status || item.status === status)
        && (!since || Date.parse(item.updatedAt) >= Date.parse(since)))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, Math.min(500, limit));
    },
    async claimJob({ type, workerId, leaseMs }) {
      const now = Date.now();
      const item = jobs.find((entry) => entry.type === type
        && (["pending", "queued"].includes(entry.status)
          || (["processing", "running"].includes(entry.status)
            && Date.parse(entry.leaseExpiresAt) <= now))
        && !jobs.some((active) => active.id !== entry.id && active.userId === entry.userId
          && ["processing", "running", "paused", "blocked", "cancelling"].includes(active.status)
          && Date.parse(active.leaseExpiresAt) > now));
      if (!item) return null;
      Object.assign(item, {
        status: "processing", leaseOwner: workerId,
        leaseExpiresAt: new Date(now + leaseMs).toISOString(),
        attempts: (item.attempts ?? 0) + 1, updatedAt: new Date().toISOString(),
      });
      escribirAtomico(rutas.jobs, JSON.stringify(jobs));
      return { ...item };
    },
    async renewJobLease({ id, workerId, leaseMs }) {
      const item = jobs.find((entry) => entry.id === id && entry.leaseOwner === workerId);
      if (!item || Date.parse(item.leaseExpiresAt ?? "") <= Date.now()
        || !["processing", "running", "paused", "cancelling"].includes(item.status)) return null;
      item.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      item.updatedAt = new Date().toISOString();
      escribirAtomico(rutas.jobs, JSON.stringify(jobs));
      return { ...item };
    },
    async createJobBatches({ jobId, total, batchSize }) {
      const count = Math.ceil(total / batchSize);
      for (let sequence = 1; sequence <= count; sequence += 1) {
        if (batches.some((item) => item.jobId === jobId && item.sequence === sequence)) continue;
        batches.push({
          id: crypto.randomUUID(), jobId, sequence, status: "pending", cursor: 0, attempts: 0,
          payload: {
            from: (sequence - 1) * batchSize,
            to: Math.min(total, sequence * batchSize),
          },
        });
      }
      escribirAtomico(rutas.batches, JSON.stringify(batches));
      return batches.filter((item) => item.jobId === jobId).map((item) => ({ ...item }));
    },
    async updateJobBatch(jobId, sequence, patch) {
      const item = batches.find((entry) => entry.jobId === jobId && entry.sequence === sequence);
      if (!item) return null;
      const { workerId, ...storedPatch } = patch;
      if (workerId) {
        const job = jobs.find((entry) => entry.id === jobId);
        if (!job || job.leaseOwner !== workerId
          || Date.parse(job.leaseExpiresAt ?? "") <= Date.now()) return null;
      }
      Object.assign(item, storedPatch);
      escribirAtomico(rutas.batches, JSON.stringify(batches));
      return { ...item };
    },
    async listJobBatches(jobId) {
      return batches.filter((item) => item.jobId === jobId)
        .sort((a, b) => a.sequence - b.sequence).map((item) => ({ ...item }));
    },
    async createArtifact(artifact) {
      const stored = { ...artifact, id: artifact.id ?? crypto.randomUUID(), createdAt: new Date().toISOString() };
      artifacts.push(stored);
      escribirAtomico(rutas.artifacts, JSON.stringify(artifacts));
      return stored;
    },
    async getArtifact(id) { return artifacts.find((item) => item.id === id) ?? null; },
    async deleteArtifact(id) {
      const before = artifacts.length;
      artifacts = artifacts.filter((item) => item.id !== id);
      escribirAtomico(rutas.artifacts, JSON.stringify(artifacts));
      return before !== artifacts.length;
    },
    async deleteArtifactsByUser(userId) {
      const before = artifacts.length;
      artifacts = artifacts.filter((item) => item.userId !== userId);
      escribirAtomico(rutas.artifacts, JSON.stringify(artifacts));
      return before - artifacts.length;
    },
    async getPayment(provider, providerOrderId) {
      return payments.find((item) => item.provider === provider
        && item.providerOrderId === providerOrderId) ?? null;
    },
    async recordPaymentAndCredit(input) {
      const existing = payments.find((item) => item.provider === input.provider
        && item.providerOrderId === input.providerOrderId);
      if (existing) assertPaymentMatchesOrder(existing, input);
      if (!existing && input.status === "paid") {
        const error = new Error("La orden de pago no existe.");
        error.code = "PAYMENT_ORDER_NOT_FOUND";
        throw error;
      }
      const payment = existing ?? {
        id: input.id ?? crypto.randomUUID(), userId: input.userId, provider: input.provider,
        providerOrderId: input.providerOrderId, createdAt: new Date().toISOString(),
        amountMinor: input.amountMinor, currency: input.currency,
      };
      if (!payment.creditedAt) payment.status = input.status;
      payment.payload = input.payload ?? payment.payload ?? {};
      payment.updatedAt = new Date().toISOString();
      if (!existing) payments.push(payment);
      const credits = paymentCredits(input);
      const balancesOut = {};
      let credited = false;
      if (input.status === "paid" && Object.keys(credits).length > 0 && !payment.creditedAt) {
        for (const [tool, amount] of Object.entries(credits)) {
          const balance = saldo(payment.userId, tool);
          const next = { ...balance, available: balance.available + amount };
          balances.set(clave(payment.userId, tool), next);
          balancesOut[tool] = next;
        }
        payment.creditedAt = new Date().toISOString();
        payment.creditedTool = input.plan ? "plan" : Object.keys(credits).join(",");
        payment.creditedAmount = Object.values(credits).reduce((sum, amount) => sum + amount, 0);
        credited = true;
      }
      escribirAtomico(rutas.payments, JSON.stringify(payments));
      if (!credited) {
        for (const tool of Object.keys(credits)) balancesOut[tool] = { ...saldo(payment.userId, tool) };
      }
      return {
        payment,
        credited,
        balances: balancesOut,
        balance: input.tool ? balancesOut[input.tool] ?? saldo(payment.userId, input.tool) : undefined,
        subscriptionEndsAt: input.subscriptionEndsAt ?? null,
      };
    },
    async findUserById() { return null; },
    async findUserByEmail() { return null; },
    async findUserByIdentity() { return null; },
    async saveUser() { return null; },
    async cerrar() {},
    async ready() { return true; },
  };
};

const backendPostgres = async () => {
  const pool = await acquireStorePool();
  if (AUTO_MIGRATE) await runStoreMigrations(pool);
  else await verifyStoreMigrations(pool);
  const t = storeTables;

  const filaBalance = (row) => ({
    available: Number(row?.available ?? 0),
    consumed: Number(row?.consumed ?? 0),
    reserved: Number(row?.reserved ?? 0),
  });
  const filaJob = (row) => (row ? {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    parameters: row.parameters ?? {},
    progress: row.progress ?? {},
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null);

  const iso = (value) => value?.toISOString?.() ?? value ?? null;
  const cargarUsuarioAutoritativo = async (whereSql, params) => {
    const result = await pool.query(
      `SELECT u.*,
              google.subject AS google_subject,
              google.created_at AS google_linked_at
         FROM ${t.users} u
         LEFT JOIN ${t.identities} google
           ON google.user_id=u.id AND google.provider='google'
        WHERE ${whereSql}
        LIMIT 1`,
      params,
    );
    const row = result.rows[0];
    if (!row) return null;
    const [devices, balances, audit] = await Promise.all([
      pool.query(`SELECT * FROM ${t.devices} WHERE user_id=$1 ORDER BY created_at`, [row.id]),
      pool.query(`SELECT * FROM ${t.balances} WHERE user_id=$1`, [row.id]),
      pool.query(
        `SELECT metadata, created_at
           FROM ${t.audit}
          WHERE subject_user_id=$1 AND event_type='user_activity'
          ORDER BY created_at DESC, id DESC LIMIT 30`,
        [row.id],
      ),
    ]);
    const user = {
      ...(row.profile ?? row.data ?? {}),
      id: row.id,
      email: row.email,
      emailLower: row.email_lower,
      role: row.role,
      status: row.status,
      plan: row.plan,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      passwordEnabled: row.password_enabled,
      tokenVersion: Number(row.token_version ?? 1),
      createdAt: iso(row.created_at),
      lastLoginAt: iso(row.last_login_at),
      subscriptionEndsAt: iso(row.subscription_ends_at),
      apiKeyHash: row.api_key_hash ?? undefined,
      apiKeyLast4: row.api_key_last4 ?? undefined,
      generationsCount: Number(row.generations_count ?? 0),
      lastGenerationAt: iso(row.last_generation_at),
      updatedAt: iso(row.updated_at),
      deviceCredentials: devices.rows.map((device) => ({
        id: device.id,
        name: device.name,
        credentialHash: device.credential_hash,
        last4: device.last4,
        createdAt: iso(device.created_at),
        lastUsedAt: iso(device.last_used_at),
        revokedAt: iso(device.revoked_at),
      })),
      activity: audit.rows.map((event) => ({
        at: iso(event.created_at),
        detail: event.metadata?.detail ?? "Actividad de cuenta",
      })),
    };
    if (row.google_subject) {
      user.googleSub = row.google_subject;
      user.googleLinkedAt = iso(row.google_linked_at);
    }
    for (const balance of balances.rows) {
      user.uses = { ...(user.uses ?? {}), [balance.tool]: Number(balance.available) };
      user.usesConsumed = {
        ...(user.usesConsumed ?? {}), [balance.tool]: Number(balance.consumed),
      };
      if (balance.tool === "forms") {
        user.formsUsesLeft = Number(balance.available);
        user.formsUsesUsed = Number(balance.consumed);
        user.formsResponsesReserved = Number(balance.reserved);
        user.formsQuotaUnit = "response";
      }
    }
    return user;
  };

  const guardarUsuarios = async (json, externalClient = null) => {
    const client = externalClient ?? await pool.connect();
    const ownsTransaction = externalClient === null;
    try {
      if (ownsTransaction) await client.query("BEGIN");
      await client.query(`
        WITH incoming AS (
          SELECT elem, elem->>'id' AS id
          FROM jsonb_array_elements($1::jsonb) elem
        )
        INSERT INTO ${t.users} (
          id, data, email, email_lower, role, status, plan, password_hash,
          password_salt, password_enabled, token_version, created_at,
          last_login_at, subscription_ends_at, api_key_hash, api_key_last4,
          generations_count, last_generation_at, profile, updated_at
        )
        SELECT id,
               elem - ARRAY[
                 'id','email','emailLower','role','status','plan','passwordHash',
                 'passwordSalt','passwordEnabled','tokenVersion','createdAt',
                 'lastLoginAt','updatedAt','subscriptionEndsAt','apiKeyHash',
                 'apiKeyLast4','generationsCount','lastGenerationAt','googleSub',
                 'googleLinkedAt','deviceCredentials','uses','usesConsumed',
                 'formsUsesLeft','formsUsesUsed','formsResponsesReserved','formsQuotaUnit',
                 'activity'
               ]::text[],
               elem->>'email', elem->>'emailLower',
               COALESCE(elem->>'role', 'user'), COALESCE(elem->>'status', 'active'),
               COALESCE(elem->>'plan', 'free'), elem->>'passwordHash',
               elem->>'passwordSalt',
               COALESCE((elem->>'passwordEnabled')::boolean, true),
               COALESCE((elem->>'tokenVersion')::integer, 1),
               COALESCE((elem->>'createdAt')::timestamptz, now()),
               NULLIF(elem->>'lastLoginAt', '')::timestamptz,
               NULLIF(elem->>'subscriptionEndsAt', '')::timestamptz,
               NULLIF(elem->>'apiKeyHash', ''), NULLIF(elem->>'apiKeyLast4', ''),
               GREATEST(0, COALESCE(NULLIF(elem->>'generationsCount', '')::integer, 0)),
               NULLIF(elem->>'lastGenerationAt', '')::timestamptz,
               elem - ARRAY[
                 'id','email','emailLower','role','status','plan','passwordHash',
                 'passwordSalt','passwordEnabled','tokenVersion','createdAt',
                 'lastLoginAt','updatedAt','subscriptionEndsAt','apiKeyHash',
                 'apiKeyLast4','generationsCount','lastGenerationAt','googleSub',
                 'googleLinkedAt','deviceCredentials','uses','usesConsumed',
                 'formsUsesLeft','formsUsesUsed','formsResponsesReserved','formsQuotaUnit',
                 'activity'
               ]::text[],
               now()
        FROM incoming
        ON CONFLICT (id) DO UPDATE SET
          data = EXCLUDED.data, email = EXCLUDED.email,
          email_lower = EXCLUDED.email_lower, role = EXCLUDED.role,
          status = EXCLUDED.status, plan = EXCLUDED.plan,
          password_hash = EXCLUDED.password_hash,
          password_salt = EXCLUDED.password_salt,
          password_enabled = EXCLUDED.password_enabled,
          token_version = EXCLUDED.token_version,
          last_login_at = EXCLUDED.last_login_at,
          subscription_ends_at = EXCLUDED.subscription_ends_at,
          api_key_hash = EXCLUDED.api_key_hash,
          api_key_last4 = EXCLUDED.api_key_last4,
          generations_count = EXCLUDED.generations_count,
          last_generation_at = EXCLUDED.last_generation_at,
          profile = EXCLUDED.profile,
          -- updated_at es el token CAS de identidad. clock_timestamp()
          -- evita el timestamp fijo de la transaccion y el incremento minimo
          -- garantiza monotonicidad aun si dos commits caen en el mismo ms.
          updated_at = GREATEST(
            ${t.users}.updated_at + interval '1 millisecond',
            clock_timestamp()
          )
      `, [json]);
      await client.query(`
        WITH incoming AS (
          SELECT elem->>'id' user_id, activity
            FROM jsonb_array_elements($1::jsonb) elem
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(elem->'activity')='array'
                   THEN elem->'activity' ELSE '[]'::jsonb END
            ) activity
        )
        INSERT INTO ${t.audit}
          (id, actor_user_id, subject_user_id, event_type, metadata, created_at)
        SELECT md5(
                 'user-activity:' || user_id || ':'
                 || COALESCE(activity->>'at', '') || ':'
                 || COALESCE(activity->>'detail', '')
               )::uuid,
               user_id,
               user_id,
               'user_activity',
               jsonb_build_object('detail', activity->>'detail'),
               COALESCE(NULLIF(activity->>'at', '')::timestamptz, now())
          FROM incoming
         WHERE NULLIF(activity->>'detail', '') IS NOT NULL
        ON CONFLICT (id) DO NOTHING
      `, [json]);
      await client.query(`
        WITH incoming AS (
          SELECT elem->>'id' user_id, device
          FROM jsonb_array_elements($1::jsonb) elem
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(elem->'deviceCredentials', '[]'::jsonb)
          ) device
        )
        INSERT INTO ${t.devices}
          (id, user_id, name, credential_hash, last4, created_at, last_used_at, revoked_at)
        SELECT (device->>'id')::uuid, user_id, COALESCE(device->>'name', 'Chrome'),
               device->>'credentialHash', device->>'last4',
               COALESCE((device->>'createdAt')::timestamptz, now()),
               (device->>'lastUsedAt')::timestamptz,
               (device->>'revokedAt')::timestamptz
        FROM incoming
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, last_used_at=EXCLUDED.last_used_at,
          revoked_at=EXCLUDED.revoked_at
      `, [json]);
      await client.query(`
        WITH incoming AS (
          SELECT elem->>'id' id, elem->>'googleSub' subject,
                 elem->>'email' email, elem->>'googleLinkedAt' linked_at
          FROM jsonb_array_elements($1::jsonb) elem
          WHERE NULLIF(elem->>'googleSub', '') IS NOT NULL
        )
        INSERT INTO ${t.identities} (id, user_id, provider, subject, verified_email, created_at, updated_at)
        SELECT md5('google:' || subject)::uuid, id, 'google', subject, email,
               COALESCE(linked_at::timestamptz, now()), now()
        FROM incoming
        ON CONFLICT (user_id, provider) DO UPDATE SET
          subject = EXCLUDED.subject,
          verified_email = EXCLUDED.verified_email,
          updated_at = now()
      `, [json]);
      await client.query(`
        WITH incoming AS (
          SELECT elem->>'id' user_id, tool.key tool,
                 GREATEST(0, floor((tool.value)::numeric))::int available,
                 GREATEST(0, floor(COALESCE((elem->'usesConsumed'->>tool.key)::numeric, 0)))::int consumed
          FROM jsonb_array_elements($1::jsonb) elem
          CROSS JOIN LATERAL jsonb_each_text(COALESCE(elem->'uses', '{}'::jsonb)) tool
        )
        INSERT INTO ${t.balances} (user_id, tool, available, consumed)
        SELECT user_id, tool, available, consumed FROM incoming
        ON CONFLICT (user_id, tool) DO NOTHING
      `, [json]);
      // Nunca se interpreta una instantanea de proceso como una orden de
      // borrado: API y worker pueden tener vistas distintas en memoria. Las
      // cuentas solo se eliminan mediante deleteUserStoreData(), con cascadas
      // y objetivo explicito dentro de Neon.
      if (ownsTransaction) await client.query("COMMIT");
    } catch (err) {
      if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      if (ownsTransaction) client.release();
    }
  };

  const guardarColeccion = async (tabla, columnas, json) => {
    if (tabla === t.pending) {
      await pool.query(`
        WITH incoming AS (
          SELECT elem->>'jobId' job_id, elem->>'userId' user_id, elem->>'tool' tool
          FROM jsonb_array_elements($1::jsonb) elem
        ), removed AS (
          DELETE FROM ${tabla} p WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.job_id = p.job_id)
        )
        INSERT INTO ${tabla} (${columnas})
        SELECT job_id, user_id, tool FROM incoming
        ON CONFLICT (job_id) DO NOTHING
      `, [json]);
      return;
    }
    await pool.query(`
      WITH incoming AS (
        SELECT elem->>'emailHash' email_hash, (elem->>'at')::timestamptz deleted_at
        FROM jsonb_array_elements($1::jsonb) elem
      ), removed AS (
        DELETE FROM ${tabla} d WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.email_hash = d.email_hash)
      )
      INSERT INTO ${tabla} (${columnas})
      SELECT email_hash, deleted_at FROM incoming
      ON CONFLICT (email_hash) DO UPDATE SET deleted_at = EXCLUDED.deleted_at
    `, [json]);
  };

  const conTransaccion = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
  const bloquearSaldo = async (client, userId, tool) => {
    await client.query(
      `INSERT INTO ${t.balances} (user_id, tool) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, tool],
    );
    const result = await client.query(
      `SELECT * FROM ${t.balances} WHERE user_id = $1 AND tool = $2 FOR UPDATE`,
      [userId, tool],
    );
    return result.rows[0];
  };
  const registrarLedger = (client, {
    userId, tool, kind, availableDelta = 0, consumedDelta = 0, reservedDelta = 0,
    referenceId = null, idempotencyKey = null, metadata = {},
  }) => client.query(
    `INSERT INTO ${t.ledger}
       (id, user_id, tool, kind, available_delta, consumed_delta, reserved_delta,
        reference_id, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (user_id, tool, idempotency_key)
       WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [crypto.randomUUID(), userId, tool, kind, availableDelta, consumedDelta,
      reservedDelta, referenceId, idempotencyKey, JSON.stringify(metadata)],
  );

  return {
    async cargar() {
      const [usuarios, pendientes, borradas, balances, identities, devices, audit] = await Promise.all([
        pool.query(`SELECT * FROM ${t.users} ORDER BY updated_at`),
        pool.query(`SELECT job_id, user_id, tool, created_at FROM ${t.pending}`),
        pool.query(`SELECT email_hash, deleted_at FROM ${t.deleted}`),
        pool.query(`SELECT user_id, tool, available, consumed, reserved FROM ${t.balances}`),
        pool.query(`SELECT * FROM ${t.identities}`),
        pool.query(`SELECT * FROM ${t.devices}`),
        pool.query(`
          SELECT subject_user_id, metadata, created_at
            FROM (
              SELECT subject_user_id, metadata, created_at,
                     row_number() OVER (
                       PARTITION BY subject_user_id ORDER BY created_at DESC, id DESC
                     ) position
                FROM ${t.audit}
               WHERE event_type='user_activity' AND subject_user_id IS NOT NULL
            ) ranked
           WHERE position <= 30
           ORDER BY subject_user_id, created_at DESC
        `),
      ]);
      const userData = usuarios.rows.map((row) => ({
        ...(row.profile ?? row.data ?? {}),
        id: row.id,
        email: row.email,
        emailLower: row.email_lower,
        role: row.role,
        status: row.status,
        plan: row.plan,
        passwordHash: row.password_hash,
        passwordSalt: row.password_salt,
        passwordEnabled: row.password_enabled,
        tokenVersion: Number(row.token_version ?? 1),
        createdAt: row.created_at?.toISOString?.() ?? row.created_at,
        lastLoginAt: row.last_login_at?.toISOString?.() ?? row.last_login_at,
        subscriptionEndsAt: row.subscription_ends_at?.toISOString?.()
          ?? row.subscription_ends_at ?? null,
        apiKeyHash: row.api_key_hash ?? undefined,
        apiKeyLast4: row.api_key_last4 ?? undefined,
        generationsCount: Number(row.generations_count ?? 0),
        lastGenerationAt: row.last_generation_at?.toISOString?.()
          ?? row.last_generation_at ?? null,
        updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
        deviceCredentials: [],
        activity: [],
      }));
      const byId = new Map(userData.map((user) => [user.id, user]));
      for (const identity of identities.rows) {
        const user = byId.get(identity.user_id);
        if (!user) continue;
        if (identity.provider === "google") {
          user.googleSub = identity.subject;
          user.googleLinkedAt = identity.created_at?.toISOString?.() ?? identity.created_at;
        }
      }
      for (const device of devices.rows) {
        const user = byId.get(device.user_id);
        if (!user) continue;
        user.deviceCredentials.push({
          id: device.id,
          name: device.name,
          credentialHash: device.credential_hash,
          last4: device.last4,
          createdAt: device.created_at?.toISOString?.() ?? device.created_at,
          lastUsedAt: device.last_used_at?.toISOString?.() ?? device.last_used_at,
          revokedAt: device.revoked_at?.toISOString?.() ?? device.revoked_at,
        });
      }
      for (const event of audit.rows) {
        const user = byId.get(event.subject_user_id);
        if (!user) continue;
        user.activity.push({
          at: event.created_at?.toISOString?.() ?? event.created_at,
          detail: event.metadata?.detail ?? "Actividad de cuenta",
        });
      }
      for (const row of balances.rows) {
        const user = byId.get(row.user_id);
        if (!user) continue;
        user.uses = { ...(user.uses ?? {}), [row.tool]: Number(row.available) };
        user.usesConsumed = {
          ...(user.usesConsumed ?? {}), [row.tool]: Number(row.consumed),
        };
        if (row.tool === "forms") {
          user.formsUsesLeft = Number(row.available);
          user.formsUsesUsed = Number(row.consumed);
          user.formsResponsesReserved = Number(row.reserved);
          user.formsQuotaUnit = "response";
        }
      }
      return {
        usuarios: userData,
        pendientes: pendientes.rows.map((r) => ({
          jobId: r.job_id, userId: r.user_id, tool: r.tool, at: r.created_at,
        })),
        borradas: borradas.rows.map((r) => ({ emailHash: r.email_hash, at: r.deleted_at })),
      };
    },
    async findUserById(id) {
      return cargarUsuarioAutoritativo("u.id=$1", [id]);
    },
    async findUserByEmail(emailLower) {
      return cargarUsuarioAutoritativo("u.email_lower=$1", [emailLower]);
    },
    async findUserByIdentity(provider, subject) {
      return cargarUsuarioAutoritativo(
        `EXISTS (
           SELECT 1 FROM ${t.identities} identity
            WHERE identity.user_id=u.id AND identity.provider=$1 AND identity.subject=$2
         )`,
        [provider, subject],
      );
    },
    async saveUser(user, { expectedUpdatedAt = null } = {}) {
      await conTransaccion(async (client) => {
        const locked = await client.query(
          `SELECT updated_at FROM ${t.users} WHERE id=$1 FOR UPDATE`, [user.id],
        );
        if (locked.rows[0] && expectedUpdatedAt) {
          const current = new Date(locked.rows[0].updated_at).getTime();
          const expected = new Date(expectedUpdatedAt).getTime();
          if (!Number.isFinite(expected) || current !== expected) {
            const error = new Error("El usuario cambio en otra operacion. Recarga antes de guardar.");
            error.code = "USER_VERSION_CONFLICT";
            throw error;
          }
        }
        await guardarUsuarios(JSON.stringify([user]), client);
      });
      return cargarUsuarioAutoritativo("u.id=$1", [user.id]);
    },
    guardarUsuarios,
    async guardarPendientes(json) { await guardarColeccion(t.pending, "job_id,user_id,tool", json); },
    async guardarBorradas(json) { await guardarColeccion(t.deleted, "email_hash,deleted_at", json); },
    async getBalance(userId, tool) {
      const r = await pool.query(
        `SELECT * FROM ${t.balances} WHERE user_id=$1 AND tool=$2`, [userId, tool],
      );
      return filaBalance(r.rows[0]);
    },
    async setBalances(userId, values, metadata = {}) {
      return conTransaccion(async (client) => {
        const out = {};
        for (const [tool, value] of Object.entries(values)) {
          const before = filaBalance(await bloquearSaldo(client, userId, tool));
          const next = {
            available: Math.max(0, Math.floor(Number(value.available) || 0)),
            consumed: Math.max(0, Math.floor(Number(value.consumed) || 0)),
            reserved: Math.max(0, Math.floor(Number(value.reserved) || 0)),
          };
          await client.query(
            `UPDATE ${t.balances}
             SET available=$3, consumed=$4, reserved=$5, updated_at=now()
             WHERE user_id=$1 AND tool=$2`,
            [userId, tool, next.available, next.consumed, next.reserved],
          );
          await registrarLedger(client, {
            userId, tool, kind: "adjustment",
            availableDelta: next.available - before.available,
            consumedDelta: next.consumed - before.consumed,
            reservedDelta: next.reserved - before.reserved,
            metadata,
          });
          out[tool] = next;
        }
        return out;
      });
    },
    async consume(input) {
      return conTransaccion(async (client) => {
        const row = await bloquearSaldo(client, input.userId, input.tool);
        const balance = filaBalance(row);
        if (input.idempotencyKey) {
          const existing = await client.query(
            `SELECT id FROM ${t.ledger}
              WHERE user_id=$1 AND tool=$2 AND idempotency_key=$3`,
            [input.userId, input.tool, input.idempotencyKey],
          );
          if (existing.rows[0]) return { ok: true, idempotent: true, balance };
        }
        if (balance.available < input.amount) return { ok: false, reason: "sin_usos", balance };
        const next = {
          ...balance,
          available: balance.available - input.amount,
          consumed: balance.consumed + input.amount,
        };
        await client.query(
          `UPDATE ${t.balances} SET available=$3, consumed=$4, updated_at=now()
           WHERE user_id=$1 AND tool=$2`,
          [input.userId, input.tool, next.available, next.consumed],
        );
        await registrarLedger(client, {
          ...input, kind: "consume", availableDelta: -input.amount,
          consumedDelta: input.amount,
        });
        return { ok: true, balance: next };
      });
    },
    async refund(input) {
      return conTransaccion(async (client) => {
        const balance = filaBalance(await bloquearSaldo(client, input.userId, input.tool));
        if (input.idempotencyKey) {
          const existing = await client.query(
            `SELECT id FROM ${t.ledger}
              WHERE user_id=$1 AND tool=$2 AND idempotency_key=$3`,
            [input.userId, input.tool, input.idempotencyKey],
          );
          if (existing.rows[0]) return { ok: true, idempotent: true, balance };
        }
        const next = {
          ...balance,
          available: balance.available + input.amount,
          consumed: Math.max(0, balance.consumed - input.amount),
        };
        await client.query(
          `UPDATE ${t.balances} SET available=$3, consumed=$4, updated_at=now()
           WHERE user_id=$1 AND tool=$2`,
          [input.userId, input.tool, next.available, next.consumed],
        );
        await registrarLedger(client, {
          ...input, kind: "refund", availableDelta: input.amount,
          consumedDelta: next.consumed - balance.consumed,
        });
        return { ok: true, balance: next };
      });
    },
    async reserve(input) {
      return conTransaccion(async (client) => {
        // El lock del saldo serializa todas las reservas de la misma cuenta y
        // herramienta. Al buscar la clave despues del lock, un reintento que
        // corrio en paralelo ya ve la fila confirmada por el primer request.
        const balance = filaBalance(await bloquearSaldo(client, input.userId, input.tool));
        const existing = await client.query(
          `SELECT * FROM ${t.reservations}
           WHERE id=$1 OR (user_id=$2 AND tool=$3 AND idempotency_key=$4)
           LIMIT 1 FOR UPDATE`,
          [input.reservationId, input.userId, input.tool, input.idempotencyKey || null],
        );
        if (existing.rows[0]) {
          return { ok: true, reservation: existing.rows[0], balance };
        }
        if (balance.available < input.amount) return { ok: false, reason: "sin_usos", balance };
        await client.query(
          `UPDATE ${t.balances}
           SET available=available-$3, reserved=reserved+$3, updated_at=now()
           WHERE user_id=$1 AND tool=$2`,
          [input.userId, input.tool, input.amount],
        );
        const inserted = await client.query(
          `INSERT INTO ${t.reservations}
             (id,user_id,tool,requested,reserved_remaining,idempotency_key,metadata)
           VALUES ($1,$2,$3,$4,$4,$5,$6::jsonb) RETURNING *`,
          [input.reservationId, input.userId, input.tool, input.amount,
            input.idempotencyKey || null, JSON.stringify(input.metadata ?? {})],
        );
        await registrarLedger(client, {
          ...input, kind: "reserve", availableDelta: -input.amount,
          reservedDelta: input.amount, referenceId: input.reservationId,
        });
        return {
          ok: true,
          reservation: inserted.rows[0],
          balance: {
            ...balance,
            available: balance.available - input.amount,
            reserved: balance.reserved + input.amount,
          },
        };
      });
    },
    async settle(input) {
      return conTransaccion(async (client) => {
        // `tool` es inmutable. Se lee sin lock para poder respetar el orden
        // global saldo -> reserva usado tambien por reserve(). El segundo
        // SELECT bajo FOR UPDATE vuelve a leer todo el estado mutable.
        const located = await client.query(
          `SELECT tool FROM ${t.reservations} WHERE id=$1 AND user_id=$2`,
          [input.reservationId, input.userId],
        );
        if (!located.rows[0]) return { ok: false, reason: "reserva_desconocida" };
        const balance = filaBalance(await bloquearSaldo(
          client, input.userId, located.rows[0].tool,
        ));
        const found = await client.query(
          `SELECT * FROM ${t.reservations} WHERE id=$1 AND user_id=$2 FOR UPDATE`,
          [input.reservationId, input.userId],
        );
        const reservation = found.rows[0];
        if (!reservation) return { ok: false, reason: "reserva_desconocida" };
        if (!["reserved", "uncertain"].includes(reservation.status)) {
          return { ok: true, reservation, balance };
        }
        const inPlay = Number(reservation.reserved_remaining || reservation.requested);
        // El worker informa totales acumulados. Se consume solo la diferencia
        // contra lo ya confirmado en esta reserva para que cada conciliacion
        // parcial sea exactamente una vez.
        const previousAccepted = Math.max(0, Number(reservation.accepted) || 0);
        const targetAccepted = Math.min(
          Number(reservation.requested) || 0,
          Math.max(previousAccepted, Math.floor(Number(input.accepted) || 0)),
        );
        const consumed = Math.min(inPlay, targetAccepted - previousAccepted);
        const uncertain = Math.min(
          inPlay - consumed,
          Math.max(0, Math.floor(Number(input.uncertain) || 0)),
        );
        const refunded = inPlay - consumed - uncertain;
        if (consumed === 0 && refunded === 0 && uncertain === inPlay) {
          return { ok: true, reservation, balance };
        }
        const next = {
          available: balance.available + refunded,
          consumed: balance.consumed + consumed,
          reserved: Math.max(0, balance.reserved - inPlay + uncertain),
        };
        await client.query(
          `UPDATE ${t.balances}
           SET available=$3, consumed=$4, reserved=$5, updated_at=now()
           WHERE user_id=$1 AND tool=$2`,
          [input.userId, reservation.tool, next.available, next.consumed, next.reserved],
        );
        const updated = await client.query(
          `UPDATE ${t.reservations}
           SET accepted=accepted+$2, refunded=refunded+$3, uncertain=$4,
               reserved_remaining=$4, status=$5,
               settled_at=CASE WHEN $4=0 THEN now() ELSE NULL END
           WHERE id=$1 RETURNING *`,
          [reservation.id, consumed, refunded, uncertain,
            uncertain > 0 ? "uncertain" : "settled"],
        );
        await registrarLedger(client, {
          userId: input.userId, tool: reservation.tool, kind: "settle",
          availableDelta: refunded, consumedDelta: consumed,
          reservedDelta: -inPlay + uncertain, referenceId: reservation.id,
          idempotencyKey: `settle:${reservation.id}:${targetAccepted}:${uncertain}`,
          metadata: input.metadata ?? {},
        });
        return { ok: true, reservation: updated.rows[0], balance: next };
      });
    },
    async release({ userId, reservationId, metadata }) {
      return this.settle({ userId, reservationId, accepted: 0, metadata });
    },
    async deleteUserData(userId) {
      await pool.query(`DELETE FROM ${t.users} WHERE id=$1`, [userId]);
    },
    async createSession(session) {
      const result = await pool.query(
        `INSERT INTO ${t.sessions} (id,user_id,token_hash,expires_at)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [session.id ?? crypto.randomUUID(), session.userId, session.tokenHash, session.expiresAt],
      );
      return result.rows[0];
    },
    async getSessionByTokenHash(tokenHash) {
      const result = await pool.query(
        `SELECT * FROM ${t.sessions} WHERE token_hash=$1`, [tokenHash],
      );
      return result.rows[0] ?? null;
    },
    async revokeSessionByTokenHash(tokenHash) {
      const result = await pool.query(
        `UPDATE ${t.sessions} SET revoked_at=COALESCE(revoked_at,now())
         WHERE token_hash=$1 RETURNING *`,
        [tokenHash],
      );
      return result.rows[0] ?? null;
    },
    async revokeSessionsByUser(userId) {
      const result = await pool.query(
        `UPDATE ${t.sessions} SET revoked_at=now()
         WHERE user_id=$1 AND revoked_at IS NULL`,
        [userId],
      );
      return result.rowCount;
    },
    async listSessionsByUser(userId) {
      const result = await pool.query(
        `SELECT id,user_id,token_hash,expires_at,created_at,revoked_at
           FROM ${t.sessions} WHERE user_id=$1 ORDER BY created_at DESC`,
        [userId],
      );
      return result.rows;
    },
    async revokeOtherSessions(userId, keepTokenHash) {
      const result = await pool.query(
        `UPDATE ${t.sessions} SET revoked_at=now()
          WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL`,
        [userId, keepTokenHash],
      );
      return result.rowCount;
    },
    async createPairing(pairing) {
      const result = await pool.query(
        `INSERT INTO ${t.pairings}
          (id,user_code_hash,secret_hash,device_name,user_id,status,expires_at,consumed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [pairing.id, pairing.userCodeHash, pairing.secretHash, pairing.deviceName,
          pairing.userId ?? null, pairing.status ?? "pending", pairing.expiresAt,
          pairing.consumedAt ?? null],
      );
      return result.rows[0];
    },
    async getPairing(id) {
      const result = await pool.query(`SELECT * FROM ${t.pairings} WHERE id=$1`, [id]);
      return result.rows[0] ?? null;
    },
    async findPairingByCodeHash(userCodeHash) {
      const result = await pool.query(
        `SELECT * FROM ${t.pairings} WHERE user_code_hash=$1`, [userCodeHash],
      );
      return result.rows[0] ?? null;
    },
    async updatePairing(id, patch) {
      const result = await pool.query(
        `UPDATE ${t.pairings}
            SET user_id=COALESCE($2,user_id), status=COALESCE($3,status),
                consumed_at=COALESCE($4,consumed_at)
          WHERE id=$1
            AND ($5::text IS NULL OR status=$5)
            AND (NOT $6::boolean OR consumed_at IS NULL)
            AND (NOT $7::boolean OR expires_at > now())
          RETURNING *`,
        [id, patch.userId ?? null, patch.status ?? null, patch.consumedAt ?? null,
          patch.expectedStatus ?? null, Boolean(patch.requireUnconsumed),
          Boolean(patch.requireNotExpired)],
      );
      return result.rows[0] ?? null;
    },
    async createJob(job) {
      const result = await pool.query(
        `INSERT INTO ${t.jobs}
           (id,user_id,type,status,parameters,progress,idempotency_key)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [job.id, job.userId, job.type, job.status ?? "pending",
          JSON.stringify(job.parameters ?? {}), JSON.stringify(job.progress ?? {}),
          job.idempotencyKey || null],
      );
      if (result.rows[0]) return filaJob(result.rows[0]);
      const existing = await pool.query(
        `SELECT * FROM ${t.jobs}
         WHERE id=$1
            OR (user_id=$2 AND type=$3 AND idempotency_key=$4)
            OR ($5::boolean
                AND type IN ('tabulacion','descriptiva','titulos','matriz','humanizador')
                AND status IN ('pending','queued','processing','running'))
         ORDER BY CASE
                    WHEN id=$1 THEN 1
                    WHEN user_id=$2 AND type=$3 AND idempotency_key=$4 THEN 2
                    ELSE 3
                  END,
                  created_at
         LIMIT 1`,
        [job.id, job.userId, job.type, job.idempotencyKey || null,
          HEAVY_GENERATION_TYPES.has(job.type)
            && ACTIVE_GENERATION_STATUSES.has(job.status ?? "pending")],
      );
      return filaJob(existing.rows[0]);
    },
    async updateJob(id, patch) {
      const result = await pool.query(
        `UPDATE ${t.jobs}
            SET status=COALESCE($2,status),
                parameters=COALESCE($3::jsonb,parameters),
                progress=COALESCE($4::jsonb,progress),
                lease_owner=CASE WHEN $5::boolean THEN $6 ELSE lease_owner END,
                lease_expires_at=CASE
                  WHEN $9::int IS NOT NULL
                    THEN now()+($9::int * interval '1 millisecond')
                  WHEN $5::boolean THEN $7
                  ELSE lease_expires_at
                END,
                updated_at=now()
          WHERE id=$1
            AND ($8::text IS NULL OR (
              lease_owner=$8 AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
            ))
          RETURNING *`,
        [id, patch.status ?? null,
          patch.parameters === undefined ? null : JSON.stringify(patch.parameters),
          patch.progress === undefined ? null : JSON.stringify(patch.progress),
          patch.clearLease === true || patch.leaseOwner !== undefined,
          patch.clearLease === true ? null : patch.leaseOwner ?? null,
          patch.clearLease === true ? null : patch.leaseExpiresAt ?? null,
          patch.workerId ?? null,
          Number(patch.renewLeaseMs) > 0 ? Math.floor(Number(patch.renewLeaseMs)) : null],
      );
      return filaJob(result.rows[0]);
    },
    async controlJob(id, { status, jobPatch = {} }) {
      const result = await pool.query(
        `UPDATE ${t.jobs}
            SET status=COALESCE($2,status),
                parameters=jsonb_set(
                  COALESCE(parameters, '{}'::jsonb),
                  '{job}',
                  COALESCE(parameters->'job', '{}'::jsonb) || $3::jsonb,
                  true
                ),
                updated_at=now()
          WHERE id=$1
          RETURNING *`,
        [id, status ?? null, JSON.stringify(jobPatch)],
      );
      return filaJob(result.rows[0]);
    },
    async getJob(id) {
      const result = await pool.query(`SELECT * FROM ${t.jobs} WHERE id=$1`, [id]);
      return filaJob(result.rows[0]);
    },
    async listJobs({ userId, type, status, limit = 100, since }) {
      const result = await pool.query(
        `SELECT * FROM ${t.jobs}
          WHERE ($1::text IS NULL OR user_id=$1)
            AND ($2::text IS NULL OR type=$2)
            AND ($3::text IS NULL OR status=$3)
            AND ($4::timestamptz IS NULL OR updated_at >= $4)
          ORDER BY updated_at DESC LIMIT $5`,
        [userId ?? null, type ?? null, status ?? null, since ?? null, Math.min(500, limit)],
      );
      return result.rows.map(filaJob);
    },
    async claimJob({ type, workerId, leaseMs }) {
      let result;
      try {
        result = await conTransaccion(async (client) => client.query(
          `WITH candidate AS (
           SELECT j.id FROM ${t.jobs} j
           JOIN ${t.users} u ON u.id=j.user_id
            WHERE j.type=$1
              AND (j.status IN ('pending','queued')
                OR (j.status IN ('processing','running') AND j.lease_expires_at < now()))
              AND NOT EXISTS (
                SELECT 1 FROM ${t.jobs} active
                 WHERE active.user_id=j.user_id AND active.id<>j.id
                   AND active.status IN ('processing','running','paused','blocked','cancelling')
                   AND active.lease_expires_at > now()
              )
            ORDER BY j.created_at
            FOR UPDATE OF j,u SKIP LOCKED LIMIT 1
         )
         UPDATE ${t.jobs} j
            SET status='processing', lease_owner=$2,
                lease_expires_at=now()+($3::int * interval '1 millisecond'),
                attempts=attempts+1, updated_at=now()
           FROM candidate
          WHERE j.id=candidate.id
          RETURNING j.*`,
          [type, workerId, leaseMs],
        ));
      } catch (error) {
        // Dos workers pueden observar dos jobs queued de la misma cuenta en
        // el mismo snapshot. El indice parcial es la autoridad final: el
        // perdedor no reclama nada y vuelve a consultar en el siguiente tick.
        if (error?.code === "23505") return null;
        throw error;
      }
      return filaJob(result.rows[0]);
    },
    async renewJobLease({ id, workerId, leaseMs }) {
      const result = await pool.query(
        `UPDATE ${t.jobs}
            SET lease_expires_at=now()+($3::int * interval '1 millisecond'), updated_at=now()
          WHERE id=$1 AND lease_owner=$2
            AND status IN ('processing','running','paused','cancelling')
            AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
          RETURNING *`,
        [id, workerId, leaseMs],
      );
      return filaJob(result.rows[0]);
    },
    async createJobBatches({ jobId, total, batchSize }) {
      await pool.query(
        `INSERT INTO ${t.batches} (id,job_id,sequence,status,cursor,attempts,payload)
         SELECT md5($1 || ':' || sequence)::uuid, $1, sequence, 'pending', 0, 0,
                jsonb_build_object(
                  'from', (sequence-1)*$3,
                  'to', LEAST($2, sequence*$3)
                )
           FROM generate_series(1, CEIL($2::numeric/$3)::int) sequence
         ON CONFLICT (job_id,sequence) DO NOTHING`,
        [jobId, total, batchSize],
      );
      const result = await pool.query(
        `SELECT * FROM ${t.batches} WHERE job_id=$1 ORDER BY sequence`, [jobId],
      );
      return result.rows;
    },
    async updateJobBatch(jobId, sequence, patch) {
      const result = await pool.query(
        `UPDATE ${t.batches}
            SET status=COALESCE($3,status), cursor=COALESCE($4,cursor),
                attempts=COALESCE($5,attempts),
                payload=CASE WHEN $6::jsonb IS NULL THEN payload ELSE payload || $6::jsonb END
          WHERE job_id=$1 AND sequence=$2
            AND ($7::text IS NULL OR EXISTS (
              SELECT 1 FROM ${t.jobs} j
               WHERE j.id=$1 AND j.lease_owner=$7
                 AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at > now()
            ))
          RETURNING *`,
        [jobId, sequence, patch.status ?? null, patch.cursor ?? null,
          patch.attempts ?? null,
          patch.payload === undefined ? null : JSON.stringify(patch.payload),
          patch.workerId ?? null],
      );
      return result.rows[0] ?? null;
    },
    async listJobBatches(jobId) {
      const result = await pool.query(
        `SELECT * FROM ${t.batches} WHERE job_id=$1 ORDER BY sequence`, [jobId],
      );
      return result.rows;
    },
    async createArtifact(artifact) {
      const id = artifact.id ?? crypto.randomUUID();
      const result = await pool.query(
        `INSERT INTO ${t.artifacts}
          (id,user_id,job_id,storage_key,content_type,byte_size,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, artifact.userId, artifact.jobId ?? null, artifact.storageKey,
          artifact.contentType, artifact.byteSize, artifact.expiresAt],
      );
      return result.rows[0];
    },
    async getArtifact(id) {
      const result = await pool.query(`SELECT * FROM ${t.artifacts} WHERE id=$1`, [id]);
      return result.rows[0] ?? null;
    },
    async deleteArtifact(id) {
      const result = await pool.query(`DELETE FROM ${t.artifacts} WHERE id=$1`, [id]);
      return result.rowCount > 0;
    },
    async deleteArtifactsByUser(userId) {
      const result = await pool.query(`DELETE FROM ${t.artifacts} WHERE user_id=$1`, [userId]);
      return result.rowCount;
    },
    async getPayment(provider, providerOrderId) {
      const result = await pool.query(
        `SELECT * FROM ${t.payments} WHERE provider=$1 AND provider_order_id=$2`,
        [provider, providerOrderId],
      );
      return result.rows[0] ?? null;
    },
    async recordPaymentAndCredit(input) {
      return conTransaccion(async (client) => {
        const incomingStatus = String(input.status);
        await client.query(
          `INSERT INTO ${t.payments}
            (id,user_id,provider,provider_order_id,status,amount_minor,currency,payload)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb
            WHERE $5 <> 'paid'
           ON CONFLICT (provider,provider_order_id) DO NOTHING`,
          [input.id ?? crypto.randomUUID(), input.userId, input.provider,
            input.providerOrderId, incomingStatus, input.amountMinor, input.currency,
            JSON.stringify(input.payload ?? {})],
        );
        const locked = await client.query(
          `SELECT * FROM ${t.payments}
           WHERE provider=$1 AND provider_order_id=$2 FOR UPDATE`,
          [input.provider, input.providerOrderId],
        );
        const payment = locked.rows[0];
        if (!payment) {
          const error = new Error("La orden de pago no existe.");
          error.code = "PAYMENT_ORDER_NOT_FOUND";
          throw error;
        }
        assertPaymentMatchesOrder(payment, input);
        await client.query(
          `UPDATE ${t.payments}
              SET status=CASE WHEN credited_at IS NULL THEN $3 ELSE status END,
                  payload=$4::jsonb, updated_at=now()
            WHERE provider=$1 AND provider_order_id=$2`,
          [input.provider, input.providerOrderId, incomingStatus,
            JSON.stringify(input.payload ?? {})],
        );
        const credits = paymentCredits(input);
        const balancesOut = {};
        if (incomingStatus !== "paid" || payment.credited_at || Object.keys(credits).length === 0) {
          for (const tool of Object.keys(credits)) {
            balancesOut[tool] = filaBalance(await bloquearSaldo(client, payment.user_id, tool));
          }
          let subscriptionEndsAt = null;
          if (input.plan) {
            const storedUser = await client.query(
              `SELECT subscription_ends_at FROM ${t.users} WHERE id=$1`,
              [payment.user_id],
            );
            subscriptionEndsAt = storedUser.rows[0]?.subscription_ends_at ?? null;
          }
          return {
            payment,
            credited: false,
            balances: balancesOut,
            balance: input.tool ? balancesOut[input.tool] : undefined,
            subscriptionEndsAt,
          };
        }
        for (const [tool, amount] of Object.entries(credits)) {
          const before = filaBalance(await bloquearSaldo(client, payment.user_id, tool));
          await client.query(
            `UPDATE ${t.balances}
                SET available=available+$3, updated_at=now()
              WHERE user_id=$1 AND tool=$2`,
            [payment.user_id, tool, amount],
          );
          await registrarLedger(client, {
            userId: payment.user_id,
            tool,
            kind: "payment_credit",
            availableDelta: amount,
            referenceId: `${input.provider}:${input.providerOrderId}`,
            idempotencyKey: `payment:${input.provider}:${input.providerOrderId}:${tool}`,
            metadata: { amountMinor: input.amountMinor, currency: input.currency },
          });
          balancesOut[tool] = { ...before, available: before.available + amount };
        }
        let subscriptionEndsAt = input.subscriptionEndsAt ?? null;
        if (input.plan && Number(input.subscriptionDays) > 0) {
          const lockedUser = await client.query(
            `SELECT subscription_ends_at FROM ${t.users} WHERE id=$1 FOR UPDATE`,
            [payment.user_id],
          );
          const currentEnd = Date.parse(lockedUser.rows[0]?.subscription_ends_at ?? "");
          const base = Number.isFinite(currentEnd) && currentEnd > Date.now()
            ? currentEnd
            : Date.now();
          subscriptionEndsAt = new Date(
            base + Math.floor(Number(input.subscriptionDays)) * 24 * 60 * 60 * 1000,
          ).toISOString();
        }
        if (input.plan && subscriptionEndsAt) {
          await client.query(
            `UPDATE ${t.users}
                SET plan=$2,
                    subscription_ends_at=$3::timestamptz,
                    updated_at=GREATEST(
                      updated_at + interval '1 millisecond',
                      clock_timestamp()
                    )
              WHERE id=$1`,
            [payment.user_id, input.plan, subscriptionEndsAt],
          );
        }
        const totalCredit = Object.values(credits).reduce((sum, amount) => sum + amount, 0);
        const credited = await client.query(
          `UPDATE ${t.payments}
              SET credited_at=now(), credited_tool=$3, credited_amount=$4, updated_at=now()
            WHERE provider=$1 AND provider_order_id=$2
            RETURNING *`,
          [input.provider, input.providerOrderId,
            input.plan ? "plan" : Object.keys(credits).join(","), totalCredit],
        );
        return {
          payment: credited.rows[0],
          credited: true,
          balances: balancesOut,
          balance: input.tool ? balancesOut[input.tool] : undefined,
          subscriptionEndsAt,
        };
      });
    },
    async ready() {
      await pool.query("SELECT 1");
      return true;
    },
    async cerrar() { await releaseStorePool(); },
  };
};

let backend = null;
let escritorUsuarios = null;
let escritorPendientes = null;
let escritorBorradas = null;

export const initStore = async (rutaUsuarios) => {
  backend = usingPostgres ? await backendPostgres() : backendArchivo(rutaUsuarios);
  escritorUsuarios = crearEscritor((json) => backend.guardarUsuarios(json), "los usuarios");
  escritorPendientes = crearEscritor((json) => backend.guardarPendientes(json), "los usos pendientes");
  escritorBorradas = crearEscritor((json) => backend.guardarBorradas(json), "las cuentas eliminadas");
  const loaded = await backend.cargar();
  structuredLog("info", "store.initialized", {
    backend: usingPostgres ? "postgres" : "local_file",
    userCount: loaded.usuarios.length,
    pendingUseCount: loaded.pendientes.length,
  });
  return loaded;
};

export const persistUsers = (usuarios) => escritorUsuarios?.encolar(usuarios);
export const persistPending = (pendientes) => escritorPendientes?.encolar(pendientes);
export const persistDeleted = (borradas) => escritorBorradas?.encolar(borradas);
export const findAuthoritativeUserById = (id) => backend.findUserById(id);
export const findAuthoritativeUserByEmail = (emailLower) => backend.findUserByEmail(emailLower);
export const findAuthoritativeUserByIdentity = (provider, subject) => (
  backend.findUserByIdentity(provider, subject)
);
export const saveAuthoritativeUser = (user, options) => backend.saveUser(user, options);
export const flushStore = async () => {
  const results = await Promise.allSettled([
    escritorUsuarios?.vaciar(), escritorPendientes?.vaciar(), escritorBorradas?.vaciar(),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
};
export const closeStore = async () => {
  await flushStore();
  await backend?.cerrar();
};

export const getEntitlementBalance = (userId, tool) => backend.getBalance(userId, tool);
export const setEntitlementBalances = (userId, values, metadata) => (
  backend.setBalances(userId, values, metadata)
);
export const consumeEntitlement = (input) => backend.consume(input);
export const refundEntitlement = (input) => backend.refund(input);
export const reserveEntitlement = (input) => backend.reserve(input);
export const settleEntitlement = (input) => backend.settle(input);
export const releaseEntitlement = (input) => backend.release(input);
export const deleteUserStoreData = (userId) => backend.deleteUserData(userId);
export const isStoreReady = () => backend?.ready();
export const createDevicePairing = (pairing) => backend.createPairing(pairing);
export const getDevicePairing = (id) => backend.getPairing(id);
export const findDevicePairingByCodeHash = (hash) => backend.findPairingByCodeHash(hash);
export const updateDevicePairing = (id, patch) => backend.updatePairing(id, patch);
export const createSessionRecord = (session) => backend.createSession(session);
export const getSessionByTokenHash = (tokenHash) => backend.getSessionByTokenHash(tokenHash);
export const revokeSessionByTokenHash = (tokenHash) => backend.revokeSessionByTokenHash(tokenHash);
export const revokeSessionsByUser = (userId) => backend.revokeSessionsByUser(userId);
export const listSessionsByUser = (userId) => backend.listSessionsByUser(userId);
export const revokeOtherSessions = (userId, keepTokenHash) => (
  backend.revokeOtherSessions(userId, keepTokenHash)
);
export const createDurableJob = (job) => backend.createJob(job);
export const updateDurableJob = (id, patch) => backend.updateJob(id, patch);
export const controlDurableJob = (id, patch) => backend.controlJob(id, patch);
export const getDurableJob = (id) => backend.getJob(id);
export const listDurableJobs = (filters) => backend.listJobs(filters);
export const claimDurableJob = (input) => backend.claimJob(input);
export const renewDurableJobLease = (input) => backend.renewJobLease(input);
export const createDurableJobBatches = (input) => backend.createJobBatches(input);
export const updateDurableJobBatch = (jobId, sequence, patch) => (
  backend.updateJobBatch(jobId, sequence, patch)
);
export const listDurableJobBatches = (jobId) => backend.listJobBatches(jobId);
export const createArtifactRecord = (artifact) => backend.createArtifact(artifact);
export const getArtifactRecord = (id) => backend.getArtifact(id);
export const deleteArtifactRecord = (id) => backend.deleteArtifact(id);
export const deleteArtifactRecordsByUser = (userId) => backend.deleteArtifactsByUser(userId);
export const getPaymentRecord = (provider, providerOrderId) => (
  backend.getPayment(provider, providerOrderId)
);
export const recordPaymentAndCredit = (input) => backend.recordPaymentAndCredit(input);
