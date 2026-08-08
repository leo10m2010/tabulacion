const path = require('path');
const fs = require('fs');
const { randomUUID } = require('node:crypto');

const express = require('express');
const compression = require('compression');

const app = express();
app.disable('x-powered-by');

const tesistabStorageFilePath = path.resolve(
  process.env.TESISTAB_JOBS_FILE || path.join(__dirname, 'temp', 'tesistab-jobs.json')
);
const IS_NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT);

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && CORS_ALLOWED_ORIGINS.includes('*')) {
  throw new Error('CORS_ALLOWED_ORIGINS cannot contain * in production');
}
const TESISTAB_API_KEY = String(process.env.TESISTAB_API_KEY || '').trim();

// Integracion con TesisTab: las claves de usuario (ttab_...) se validan
// contra la API de TesisTab. TESISTAB_VALIDATION=off replica el modo
// original (desarrollo/tests: sin validacion remota, TESISTAB_API_KEY opcional).
const TESISTAB_API_URL = String(process.env.TESISTAB_API_URL || 'https://tabulacion-api.onrender.com')
  .trim()
  .replace(/\/$/, '');
const SERVICE_SHARED_SECRET = String(process.env.SERVICE_SHARED_SECRET || '').trim();
const TESISTAB_VALIDATION_ENABLED =
  String(process.env.TESISTAB_VALIDATION || 'on').trim().toLowerCase() !== 'off';
const TESISTAB_KEY_CACHE_TTL_MS = Number(process.env.TESISTAB_KEY_CACHE_TTL_MS || 5 * 60_000);
const tesistabKeyCache = new Map(); // clave -> { valid, reason, email, plan, expiresAt }
const TESISTAB_RATE_LIMIT_WINDOW_MS = Number(process.env.TESISTAB_RATE_LIMIT_WINDOW_MS || 60_000);
const TESISTAB_RATE_LIMIT_MAX_REQUESTS = Number(process.env.TESISTAB_RATE_LIMIT_MAX_REQUESTS || 120);
const TESISTAB_PERSIST_JOBS =
  String(process.env.TESISTAB_PERSIST_JOBS || (IS_NODE_TEST ? 'false' : 'true')).toLowerCase() !== 'false';
const TESISTAB_MAX_STORED_JOBS = Number(process.env.TESISTAB_MAX_STORED_JOBS || 200);
const TESISTAB_STALE_JOB_AFTER_MS = Number(process.env.TESISTAB_STALE_JOB_AFTER_MS || 30_000);
const TESISTAB_FINISHED_JOB_TTL_MS = Number(
  process.env.TESISTAB_FINISHED_JOB_TTL_MS || 30 * 24 * 60 * 60_000
);
const TESISTAB_COMPAT_FORM_TTL_MS = Number(process.env.TESISTAB_COMPAT_FORM_TTL_MS || 10 * 60_000);
const TESISTAB_MAX_COMPAT_FORMS = Number(process.env.TESISTAB_MAX_COMPAT_FORMS || 20);
const TESISTAB_PROVIDER_RETRIES = Math.max(1, Number(process.env.TESISTAB_PROVIDER_RETRIES || 3));
const configuredBatchSize = Number(process.env.TESISTAB_JOB_BATCH_SIZE || 100);
const TESISTAB_JOB_BATCH_SIZE =
  Number.isSafeInteger(configuredBatchSize) && configuredBatchSize > 0 ? configuredBatchSize : 100;

const TESISTAB_ALLOWED_HOSTS = (process.env.TESISTAB_ALLOWED_HOSTS || 'docs.google.com')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
// Sin limite fijo por defecto: la capacidad efectiva la determina la reserva
// transaccional de respuestas. La variable se conserva como freno operativo
// opcional para instalaciones antiguas.
const configuredSubmissionsLimit = Number(process.env.TESISTAB_MAX_SUBMISSIONS_PER_JOB);
const TESISTAB_MAX_SUBMISSIONS_PER_JOB =
  Number.isSafeInteger(configuredSubmissionsLimit) && configuredSubmissionsLimit > 0
    ? configuredSubmissionsLimit
    : null;
const TESISTAB_MIN_DELAY_MS = Number(process.env.TESISTAB_MIN_DELAY_MS || 500);
const TESISTAB_MAX_DELAY_MS = Number(process.env.TESISTAB_MAX_DELAY_MS || 60_000);
const TESISTAB_MAX_JITTER_MS = Number(process.env.TESISTAB_MAX_JITTER_MS || 5_000);
const TESISTAB_REQUEST_TIMEOUT_MS = Number(process.env.TESISTAB_REQUEST_TIMEOUT_MS || 20_000);
const TESISTAB_JOBS_LIST_DEFAULT_LIMIT = Number(process.env.TESISTAB_JOBS_LIST_DEFAULT_LIMIT || 20);
const TESISTAB_JOBS_LIST_MAX_LIMIT = Number(process.env.TESISTAB_JOBS_LIST_MAX_LIMIT || 200);
const TESISTAB_MAX_MULTIPAGE_ROUTES = 20;
const TESISTAB_MAX_MULTIPAGE_PAGES_PER_ROUTE = 50;
const TESISTAB_MAX_ROUTE_CONDITIONS = 16;
const TESISTAB_MAX_ROUTE_PAYLOAD_FIELDS = 400;
const LEGACY_API_SUNSET_AT = String(
  process.env.LEGACY_API_SUNSET_AT || '2026-09-07T00:00:00Z'
).trim();
const legacyApiSunsetTimestamp = Date.parse(LEGACY_API_SUNSET_AT);
if (!Number.isFinite(legacyApiSunsetTimestamp)) {
  throw new Error('LEGACY_API_SUNSET_AT must be a valid RFC 3339 date');
}
const LEGACY_API_SUNSET_HEADER = new Date(legacyApiSunsetTimestamp).toUTCString();
const TESISTAB_GENDER_SHARE_MIN = Number(process.env.TESISTAB_GENDER_SHARE_MIN || 0.4);
const TESISTAB_GENDER_SHARE_MAX = Number(process.env.TESISTAB_GENDER_SHARE_MAX || 0.6);
const TESISTAB_AGE_SHARE_18_25 = Number(process.env.TESISTAB_AGE_SHARE_18_25 || 0.35);
const TESISTAB_AGE_SHARE_26_35 = Number(process.env.TESISTAB_AGE_SHARE_26_35 || 0.4);
const TESISTAB_AGE_SHARE_36_45 = Number(process.env.TESISTAB_AGE_SHARE_36_45 || 0.2);
const TESISTAB_AGE_SHARE_46_PLUS = Number(process.env.TESISTAB_AGE_SHARE_46_PLUS || 0.05);
const TESISTAB_FREQ_SHARE_WEEKLY = Number(process.env.TESISTAB_FREQ_SHARE_WEEKLY || 0.15);
const TESISTAB_FREQ_SHARE_BIWEEKLY = Number(process.env.TESISTAB_FREQ_SHARE_BIWEEKLY || 0.35);
const TESISTAB_FREQ_SHARE_MONTHLY = Number(process.env.TESISTAB_FREQ_SHARE_MONTHLY || 0.35);
const TESISTAB_FREQ_SHARE_OCCASIONAL = Number(process.env.TESISTAB_FREQ_SHARE_OCCASIONAL || 0.15);
const TESISTAB_DISTRIBUTION_CONFIG = resolveTesistabDistributionConfig();

const tesistabJobStore = {};
const compatStoredForms = new Map();
const tesistabSmartRuntimeStore = new Map();
const tesistabQuotaRuntimeStore = new Map();
const requestLimitStore = new Map();
const tesistabCleanupTimers = new Map();
const TESISTAB_WORKER_ID = String(process.env.TESISTAB_WORKER_ID || randomUUID());
const TESISTAB_JOB_LEASE_MS = Number(process.env.TESISTAB_JOB_LEASE_MS || 30_000);
const TESISTAB_WORKER_MODE = String(process.env.TESISTAB_WORKER_MODE || 'false') === 'true';
const TESISTAB_RUN_JOBS_INLINE =
  String(
    process.env.TESISTAB_RUN_JOBS_INLINE ||
    (process.env.NODE_ENV === 'production' ? 'false' : 'true')
  ).toLowerCase() === 'true';
const TESISTAB_EXECUTE_JOBS = TESISTAB_WORKER_MODE || TESISTAB_RUN_JOBS_INLINE;

let saveTesistabJobsTimer = null;
let inProcessJobRepository = null;
let jobRepositoryReady = Promise.resolve();
let jobClaimTimer = null;

bootstrapTesistabStore();
registerShutdownHooks();
startTesistabWatchdog();

if (TESISTAB_VALIDATION_ENABLED) {
  console.log(`Validacion de claves TesisTab activa (${TESISTAB_API_URL}) para /api/tesistab y /api/forms`);
} else if (TESISTAB_API_KEY) {
  console.log('TESISTAB API key protection enabled for /api/tesistab and /api/forms routes');
} else {
  console.warn('[AVISO] Sin validacion de claves (TESISTAB_VALIDATION=off y sin TESISTAB_API_KEY): solo para desarrollo.');
}

// Repositorio durable inyectable (Neon en produccion). Todos los metodos
// pueden ser sync o async. El archivo JSON queda como fallback standalone.
app.setJobRepository = (repository) => {
  const valid = repository &&
    ['create', 'get', 'list', 'update', 'claim'].every(
      (method) => typeof repository[method] === 'function'
    );
  if (!valid) {
    inProcessJobRepository = null;
    jobRepositoryReady = Promise.resolve();
    return jobRepositoryReady;
  }

  inProcessJobRepository = repository;
  // No mezclar el snapshot local con la fuente transaccional.
  for (const id of Object.keys(tesistabJobStore)) {
    delete tesistabJobStore[id];
  }
  jobRepositoryReady = hydrateJobsFromRepository();
  if (TESISTAB_EXECUTE_JOBS) {
    startJobClaimLoop();
  }
  return jobRepositoryReady;
};

// Middlewares
app.use(express.json({ limit: process.env.TESISTAB_JSON_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.TESISTAB_JSON_LIMIT || '1mb' }));
app.use(compression({ level: 9, memLevel: 9 }));
app.use((req, res, next) => {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (CORS_ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-API-Key, X-Request-Id, X-Device-Id'
  );

  if (req.method === 'OPTIONS') {
    if (
      !CORS_ALLOWED_ORIGINS.includes('*') &&
      origin &&
      !CORS_ALLOWED_ORIGINS.includes(origin)
    ) {
      sendApiError(res, 403, 'origin_not_allowed', 'Origin is not allowed', req.requestId);
      return;
    }

    res.status(204).end();
    return;
  }

  if (
    !CORS_ALLOWED_ORIGINS.includes('*') &&
    origin &&
    !CORS_ALLOWED_ORIGINS.includes(origin)
  ) {
    sendApiError(res, 403, 'origin_not_allowed', 'Origin is not allowed', req.requestId);
    return;
  }

  next();
});

app.use(['/api/tesistab', '/api/forms'], requireTesistabApiKey);
app.use(['/api/tesistab', '/api/forms'], tesistabRateLimiter);

// Estado del servicio (sin clave: lo usa el healthcheck del hosting).
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'tutorica-forms', now: new Date().toISOString() });
});

app.get('/api/tesistab/config', (req, res) => {
  res.json({
    requestId: req.requestId,
    // Cuenta asociada a la clave (null en modo legado): la extension muestra
    // los usos de Forms restantes (null = ilimitados, admins).
    user: req.tesistabUser ?? null,
    quota: {
      unit: inProcessUsageManager ? 'responses' : inProcessUsageConsumer ? 'legacy_runs' : 'unlimited',
      responsesLeft: req.tesistabUser?.formsResponses ?? req.tesistabUser?.responsesLeft ?? null,
    },
    service: {
      name: 'Tutorica Forms Backend',
      staleJobAfterMs: TESISTAB_STALE_JOB_AFTER_MS,
      finishedJobTtlMs: TESISTAB_FINISHED_JOB_TTL_MS,
    },
    allowedHosts: TESISTAB_ALLOWED_HOSTS,
    protection: {
      apiKeyRequired: TESISTAB_VALIDATION_ENABLED || Boolean(TESISTAB_API_KEY),
      tesistabValidation: TESISTAB_VALIDATION_ENABLED,
      corsAllowedOrigins: CORS_ALLOWED_ORIGINS,
      rateLimitWindowMs: TESISTAB_RATE_LIMIT_WINDOW_MS,
      rateLimitMaxRequests: TESISTAB_RATE_LIMIT_MAX_REQUESTS,
    },
    limits: {
      maxSubmissionsPerJob: TESISTAB_MAX_SUBMISSIONS_PER_JOB,
      jobBatchSize: TESISTAB_JOB_BATCH_SIZE,
      defaultJobsListLimit: clamp(Math.floor(TESISTAB_JOBS_LIST_DEFAULT_LIMIT), 1, TESISTAB_JOBS_LIST_MAX_LIMIT),
      maxJobsListLimit: TESISTAB_JOBS_LIST_MAX_LIMIT,
      minDelayMs: TESISTAB_MIN_DELAY_MS,
      maxDelayMs: TESISTAB_MAX_DELAY_MS,
      maxJitterMs: TESISTAB_MAX_JITTER_MS,
      requestTimeoutMs: TESISTAB_REQUEST_TIMEOUT_MS,
    },
    distribution: {
      genderShareRange: {
        min: TESISTAB_DISTRIBUTION_CONFIG.gender.min,
        max: TESISTAB_DISTRIBUTION_CONFIG.gender.max,
      },
      ageShares: TESISTAB_DISTRIBUTION_CONFIG.age,
      purchaseFrequencyShares: TESISTAB_DISTRIBUTION_CONFIG.frequency,
      maxSubmissionsPerJob: TESISTAB_MAX_SUBMISSIONS_PER_JOB,
    },
  });
});

// Dueno de un job. Los jobs guardan el correo de la cuenta que los creo; sin
// esto, cualquier cliente con una clave ttab_ valida leia y cancelaba las
// corridas de todos los demas (la URL del formulario, las etiquetas y el
// resultado de cada uno).
//
// El modo legado y la llave maestra siguen viendo todo: son el operador del
// servicio y el desarrollo local de un solo usuario, no un cliente.
function jobOwnerEmail(req) {
  const email = req.tesistabUser?.email;
  return typeof email === 'string' && email ? email.trim().toLowerCase() : null;
}

function canAccessJob(req, job) {
  if (!job) return false;
  if (req.tesistabPrivileged) return true;
  const owner = jobOwnerEmail(req);
  // Un job sin dueno es de antes de este cambio: solo el operador lo ve.
  return Boolean(owner) && job.ownerEmail === owner;
}

app.get(['/api/tesistab/jobs/:id', '/api/forms/jobs/:id'], async (req, res) => {
  const job = await getTesistabJob(req.params.id);
  // Se responde 404 (no 403) a proposito: un 403 confirmaria que el job existe.
  if (!canAccessJob(req, job)) {
    sendApiError(res, 404, 'job_not_found', 'Job not found', req.requestId);
    return;
  }

  res.json({
    requestId: req.requestId,
    ...job,
    progress: jobProgress(job),
  });
});

app.get(['/api/tesistab/jobs', '/api/forms/jobs'], async (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const safeLimit = Number.isFinite(requestedLimit)
    ? clamp(Math.floor(requestedLimit), 1, TESISTAB_JOBS_LIST_MAX_LIMIT)
    : clamp(Math.floor(TESISTAB_JOBS_LIST_DEFAULT_LIMIT), 1, TESISTAB_JOBS_LIST_MAX_LIMIT);
  const statusFilter =
    typeof req.query.status === 'string' && req.query.status.trim()
      ? req.query.status.trim()
      : null;
  const sinceTimestamp =
    typeof req.query.since === 'string' ? Date.parse(req.query.since) : Number.NaN;

  const storedJobs = await listTesistabJobs({
    ownerEmail: req.tesistabPrivileged ? null : jobOwnerEmail(req),
    limit: TESISTAB_JOBS_LIST_MAX_LIMIT,
    status: statusFilter,
    since: Number.isNaN(sinceTimestamp) ? null : new Date(sinceTimestamp).toISOString(),
  });
  const visibles = storedJobs.filter((job) => canAccessJob(req, job));

  const jobs = visibles
    .filter((job) => {
      if (statusFilter && job.status !== statusFilter) {
        return false;
      }

      if (!Number.isNaN(sinceTimestamp)) {
        return new Date(job.createdAt).getTime() >= sinceTimestamp;
      }

      return true;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, safeLimit);

  const totals = visibles.reduce(
    (acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    },
    {}
  );

  res.json({
    requestId: req.requestId,
    // Cuenta solo lo que este cliente puede ver: el total global revelaria
    // cuantas corridas tienen los demas usuarios.
    totalStored: visibles.length,
    total: jobs.length,
    totals,
    appliedFilters: {
      limit: safeLimit,
      status: statusFilter,
      since: Number.isNaN(sinceTimestamp) ? null : new Date(sinceTimestamp).toISOString(),
    },
    jobs: jobs.map((job) => ({ ...job, progress: jobProgress(job) })),
  });
});

app.delete('/api/tesistab/jobs', async (req, res) => {
  // Borra solo el historial de quien llama. Antes vaciaba el almacen entero:
  // un cliente cualquiera podia destruir las corridas en curso de todos los
  // demas, con los usos ya cobrados.
  const allJobs = await listTesistabJobs({
    ownerEmail: req.tesistabPrivileged ? null : jobOwnerEmail(req),
    limit: TESISTAB_JOBS_LIST_MAX_LIMIT,
  });
  const propios = allJobs.filter((job) => canAccessJob(req, job)).map((job) => job.id);

  for (const id of propios) {
    const timer = tesistabCleanupTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      tesistabCleanupTimers.delete(id);
    }
    tesistabSmartRuntimeStore.delete(id);
    tesistabQuotaRuntimeStore.delete(id);
    delete tesistabJobStore[id];
    if (inProcessJobRepository?.delete) {
      await Promise.resolve(inProcessJobRepository.delete(id));
    }
  }

  persistTesistabJobsSoon();
  res.json({
    requestId: req.requestId,
    message: 'Cleared TESISTAB jobs history',
    removed: propios.length,
  });
});

app.delete('/api/tesistab/jobs/:id', async (req, res) => {
  await requestTesistabJobCancellation(req, res);
});

app.post(['/api/tesistab/jobs/:id/cancel', '/api/forms/jobs/:id/cancel'], async (req, res) => {
  await requestTesistabJobCancellation(req, res);
});

app.post(['/api/tesistab/jobs/:id/pause', '/api/forms/jobs/:id/pause'], async (req, res) => {
  const job = await getTesistabJob(req.params.id);
  if (!canAccessJob(req, job)) {
    sendApiError(res, 404, 'job_not_found', 'Job not found', req.requestId);
    return;
  }

  if (!['queued', 'running', 'paused'].includes(job.status)) {
    sendApiError(res, 409, 'job_not_active', 'Only an active job can be paused', req.requestId);
    return;
  }

  job.pauseRequested = true;
  job.resumeStatus = job.status === 'queued' ? 'queued' : 'running';
  job.status = 'paused';
  job.updatedAt = new Date().toISOString();
  await persistTesistabJob(job);
  res.json({
    requestId: req.requestId,
    id: job.id,
    status: job.status,
    progress: jobProgress(job),
  });
});

app.post(['/api/tesistab/jobs/:id/resume', '/api/forms/jobs/:id/resume'], async (req, res) => {
  const job = await getTesistabJob(req.params.id);
  if (!canAccessJob(req, job)) {
    sendApiError(res, 404, 'job_not_found', 'Job not found', req.requestId);
    return;
  }

  if (!['paused', 'blocked'].includes(job.status)) {
    sendApiError(res, 409, 'job_not_paused', 'Only a paused job can be resumed', req.requestId);
    return;
  }
  if (job.recoverableError?.code === 'delivery_uncertain_after_restart') {
    sendApiError(
      res,
      409,
      'reconciliation_required',
      'Confirma primero si la respuesta incierta fue aceptada por el formulario.',
      req.requestId,
      { retryable: false }
    );
    return;
  }

  job.pauseRequested = false;
  job.status = job.resumeStatus === 'running' ? 'running' : 'queued';
  job.resumeStatus = null;
  job.updatedAt = new Date().toISOString();
  await persistTesistabJob(job);
  res.json({
    requestId: req.requestId,
    id: job.id,
    status: job.status,
    progress: jobProgress(job),
  });
});

app.post(['/api/tesistab/jobs/:id/reconcile', '/api/forms/jobs/:id/reconcile'], async (req, res) => {
  const job = await getTesistabJob(req.params.id);
  if (!canAccessJob(req, job)) {
    sendApiError(res, 404, 'job_not_found', 'Job not found', req.requestId);
    return;
  }
  if (job.status !== 'blocked'
    || job.recoverableError?.code !== 'delivery_uncertain_after_restart'
    || !Number.isSafeInteger(Number(job.inFlightIndex))) {
    sendApiError(res, 409, 'job_not_reconcilable', 'El trabajo no tiene una respuesta incierta.', req.requestId);
    return;
  }
  const accepted = req.body?.accepted;
  if (typeof accepted !== 'boolean') {
    sendApiError(res, 422, 'invalid_reconciliation', 'accepted debe ser true o false.', req.requestId);
    return;
  }
  if (accepted) {
    job.sent = Number(job.sent || 0) + 1;
    job.accepted = Number(job.accepted || 0) + 1;
    observeFormsEvent('response', { outcome: 'accepted' });
  } else {
    job.failed = Number(job.failed || 0) + 1;
    observeFormsEvent('response', { outcome: 'failed' });
  }
  job.uncertain = Math.max(0, Number(job.uncertain || 0) - 1);
  job.currentIndex = Number(job.inFlightIndex) + 1;
  job.cursor = job.currentIndex;
  job.inFlightIndex = null;
  job.recoverableError = null;
  job.pauseRequested = false;
  job.status = 'queued';
  job.updatedAt = new Date().toISOString();
  await persistTesistabJob(job);
  res.json({ requestId: req.requestId, id: job.id, status: job.status, progress: jobProgress(job) });
});

async function requestTesistabJobCancellation(req, res) {
  const job = await getTesistabJob(req.params.id);
  if (!canAccessJob(req, job)) {
    sendApiError(res, 404, 'job_not_found', 'Job not found', req.requestId);
    return;
  }

  if (isTerminalJobStatus(job.status)) {
    res.json({
      requestId: req.requestId,
      id: job.id,
      status: job.status,
      progress: jobProgress(job),
    });
    return;
  }

  job.cancelRequested = true;
  job.pauseRequested = false;
  const canFinishHere = ['queued', 'pending', 'paused', 'blocked'].includes(job.status);
  job.status = canFinishHere ? 'cancelled' : 'cancelling';
  if (canFinishHere) job.finishedAt = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  await persistTesistabJob(job);
  if (canFinishHere) {
    await settleTesistabJob(job);
    scheduleTesistabJobCleanup(job.id);
  }
  res.status(202).json({
    requestId: req.requestId,
    id: job.id,
    status: job.status,
    progress: jobProgress(job),
  });
}

app.post(['/api/tesistab/submit', '/api/forms/jobs'], async (req, res) => {
  let pendingReservation = null;
  let pendingJobId = null;
  try {
    await ensureJobRepositoryAvailable();
    const body = req.body || {};
    const config = body.config && typeof body.config === 'object' && !Array.isArray(body.config)
      ? body.config
      : {};
    const {
      formUrl,
      label,
      idempotencyKey,
      ownOrAuthorized,
      structureHash,
    } = body;
    // Contrato publico nuevo: requestedResponses + config. Los campos planos
    // siguen aceptandose durante la ventana de compatibilidad.
    const payload = body.payload ?? config.payload;
    const count = body.requestedResponses ?? body.count;
    const delayMs = config.delayMs ?? body.delayMs;
    const jitterMs = config.jitterMs ?? body.jitterMs;
    const autoRandomizeText = config.autoRandomizeText ?? body.autoRandomizeText;
    const smartProfile = config.smartProfile ?? body.smartProfile;
    const multiPage = config.multiPage ?? body.multiPage;
    const effectiveLabel = config.label ?? label;

    if (!formUrl || typeof formUrl !== 'string') {
      sendApiError(res, 400, 'invalid_form_url', 'formUrl is required', req.requestId);
      return;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      sendApiError(res, 400, 'invalid_payload', 'payload must be an object', req.requestId);
      return;
    }

    const validation = validateTesistabFormUrl(formUrl);
    if (!validation.ok) {
      sendApiError(res, 400, 'invalid_form_url', validation.message, req.requestId);
      return;
    }
    const normalizedFormUrl = validation.normalizedUrl || formUrl;

    if (ownOrAuthorized !== true) {
      sendApiError(
        res,
        422,
        'authorization_required',
        'Confirma que el formulario es propio o que tienes autorizacion para usarlo',
        req.requestId
      );
      return;
    }

    const countValidation = validateSubmissionCount(count);
    if (!countValidation.ok) {
      sendApiError(res, 422, 'invalid_response_count', countValidation.message, req.requestId);
      return;
    }

    const requestedCount = countValidation.value;
    const requestedDelayMs = Number(delayMs);
    const requestedJitterMs = Number(jitterMs);
    const safeCount = requestedCount;
    const safeDelayMs = Number.isFinite(requestedDelayMs)
      ? clamp(requestedDelayMs, TESISTAB_MIN_DELAY_MS, TESISTAB_MAX_DELAY_MS)
      : TESISTAB_MIN_DELAY_MS;
    const safeJitterMs = Number.isFinite(requestedJitterMs)
      ? clamp(requestedJitterMs, 0, TESISTAB_MAX_JITTER_MS)
      : 0;

    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    if (idempotencyKey !== undefined && !normalizedIdempotencyKey) {
      sendApiError(res, 422, 'invalid_idempotency_key', 'idempotencyKey no es valido', req.requestId);
      return;
    }
    const normalizedStructureHash = String(structureHash ?? '').trim().toLowerCase();
    if (structureHash !== undefined && !/^[a-f0-9]{64}$/.test(normalizedStructureHash)) {
      sendApiError(res, 422, 'invalid_structure_hash', 'structureHash debe ser SHA-256 hexadecimal', req.requestId);
      return;
    }

    const existingJob = findIdempotentJob(req, normalizedIdempotencyKey);
    if (existingJob) {
      res.status(202).json(buildJobCreationResponse(existingJob, req.requestId, true));
      return;
    }

    const sanitizedSmartProfile = sanitizeSmartProfile(smartProfile);
    const multiPageValidation = sanitizeMultiPageConfig(multiPage);
    if (!multiPageValidation.ok) {
      sendApiError(
        res,
        422,
        'invalid_multi_page',
        multiPageValidation.message,
        req.requestId,
        { field: multiPageValidation.field || 'config.multiPage' }
      );
      return;
    }
    const sanitizedMultiPage = multiPageValidation.value;
    const executionPayload = buildExecutionPayload(payload, sanitizedMultiPage);
    const jobId = randomUUID();
    pendingJobId = jobId;
    const quota = await reserveTesistabResponses(req, safeCount, {
      reservationId: jobId,
      jobId,
      idempotencyKey: normalizedIdempotencyKey || jobId,
      requestId: req.requestId,
      formId: extractGoogleFormId(normalizedFormUrl),
    });
    if (!quota.ok) {
      const status = quota.reason === 'insufficient_responses' || quota.reason === 'sin_usos' ? 403 : 503;
      const message = status === 403
        ? `No tienes ${safeCount} respuestas disponibles para este envio.`
        : 'No se pudo reservar tu saldo de respuestas; intenta de nuevo.';
      sendApiError(res, status, quota.reason || 'quota_unavailable', message, req.requestId, {
        requested: safeCount,
        responsesLeft: quota.responsesLeft ?? null,
      });
      return;
    }
    pendingReservation = quota;

    tesistabJobStore[jobId] = {
      id: jobId,
      requestId: req.requestId,
      // Dueno del job: es lo que impide que otro cliente lo lea o lo cancele.
      ownerEmail: jobOwnerEmail(req),
      label: typeof effectiveLabel === 'string' ? effectiveLabel.slice(0, 160) : 'Manual run',
      formUrl: normalizedFormUrl,
      formId: extractGoogleFormId(normalizedFormUrl),
      authorizationConfirmed: true,
      idempotencyKey: normalizedIdempotencyKey || null,
      structureHash: normalizedStructureHash || null,
      requestedCount,
      count: safeCount,
      requested: safeCount,
      reserved: Number.isFinite(Number(quota.reserved)) ? Number(quota.reserved) : safeCount,
      responsesLeft: quota.responsesLeft ?? null,
      accepted: 0,
      refunded: 0,
      pending: safeCount,
      reservationId: quota.reservationId || jobId,
      quotaMode: quota.mode || (inProcessUsageManager ? 'responses' : 'legacy'),
      settlementStatus: 'reserved',
      delayMs: safeDelayMs,
      jitterMs: safeJitterMs,
      autoRandomizeText: Boolean(autoRandomizeText),
      smartProfile: sanitizedSmartProfile,
      multiPage: summarizeMultiPageConfig(sanitizedMultiPage),
      distributionPlan: null,
      recentAppliedRules: [],
      status: 'queued',
      cancelRequested: false,
      pauseRequested: false,
      batchSize: TESISTAB_JOB_BATCH_SIZE,
      totalBatches: Math.ceil(safeCount / TESISTAB_JOB_BATCH_SIZE),
      currentBatch: 0,
      sent: 0,
      failed: 0,
      uncertain: 0,
      errors: [],
      latestResult: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
    };

    trimTesistabStoreIfNeeded();
    const smartRuntime = buildSmartProfileRuntime(sanitizedSmartProfile, safeCount);
    tesistabSmartRuntimeStore.set(jobId, smartRuntime);
    tesistabQuotaRuntimeStore.set(jobId, {
      apiKey: req.tesistabApiKey || null,
      reservationId: quota.reservationId || jobId,
    });
    tesistabJobStore[jobId].distributionPlan = summarizeSmartRuntimePlan(smartRuntime);
    const createdJob = await createTesistabJobRecord(tesistabJobStore[jobId], executionPayload);

    pendingReservation = null;
    if (createdJob?.id && createdJob.id !== jobId) {
      delete tesistabJobStore[jobId];
      res.status(202).json(buildJobCreationResponse(createdJob, req.requestId, true));
      return;
    }
    if (TESISTAB_EXECUTE_JOBS) {
      runTesistabJob(jobId, executionPayload).catch((error) => {
        failTesistabJob(jobId, error);
      });
    }

    res.status(202).json(buildJobCreationResponse(tesistabJobStore[jobId], req.requestId, false));
  } catch (error) {
    if (pendingReservation) {
      await releaseTesistabReservation(req, pendingReservation.reservationId || pendingJobId, {
        jobId: pendingJobId,
        reason: 'job_create_failed',
      }).catch(() => null);
    }
    console.error(`[${req.requestId}] Error creating TESISTAB job`, error);
    sendApiError(
      res,
      error?.statusCode || 500,
      error?.code || 'job_create_failed',
      error?.statusCode === 503 ? error.message : 'Failed to create job',
      req.requestId
    );
  }
});

// Compatibility endpoint for old extension contract.
app.post('/api/forms', (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', LEGACY_API_SUNSET_HEADER);
  pruneCompatForms();
  const data = req.body || {};
  const formId = data.formId || randomUUID();
  const storageKey = compatFormStorageKey(req, formId);
  compatStoredForms.set(storageKey, {
    ...data,
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + TESISTAB_COMPAT_FORM_TTL_MS,
  });
  pruneCompatForms();

  res.type('text/plain').send(formId);
});

// Compatibility endpoint for old extension contract.
app.post('/api/forms/submit', async (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', LEGACY_API_SUNSET_HEADER);
  try {
    await ensureJobRepositoryAvailable();
    const body = req.body || {};
    const formUrl = body.url;
    const formId = body.formId;
    const countValidation = validateSubmissionCount(body.counter);
    if (!countValidation.ok) {
      res.status(422).type('text/plain').send(countValidation.message);
      return;
    }
    const requestedCount = countValidation.value;
    const safeCount = requestedCount;

    if (!formUrl || typeof formUrl !== 'string') {
      res.status(400).type('text/plain').send('Missing form url');
      return;
    }

    const validation = validateTesistabFormUrl(formUrl);
    if (!validation.ok) {
      res.status(400).type('text/plain').send(validation.message);
      return;
    }
    const normalizedFormUrl = validation.normalizedUrl || formUrl;
    if (body.ownOrAuthorized !== 'true' && body.ownOrAuthorized !== true) {
      res.status(422).type('text/plain')
        .send('Confirma que el formulario es propio o que tienes autorizacion para usarlo');
      return;
    }

    const payload = { ...body };
    delete payload.url;
    delete payload.counter;
    delete payload.fromExtension;
    delete payload.fromExtensionBackground;
    delete payload.formId;
    delete payload.isSchedule;
    delete payload.dlut;
    delete payload.ownOrAuthorized;

    pruneCompatForms();
    const compatData = formId ? compatStoredForms.get(compatFormStorageKey(req, formId)) : null;
    if (compatData) {
      Object.assign(payload, compatData);
      delete payload.formId;
      delete payload.updatedAt;
      delete payload.expiresAt;
    }

    const jobId = randomUUID();
    const quota = await reserveTesistabResponses(req, safeCount, {
      reservationId: jobId,
      jobId,
      idempotencyKey: jobId,
      requestId: req.requestId,
      formId: extractGoogleFormId(normalizedFormUrl),
    });
    if (!quota.ok) {
      res.status(403).type('text/plain')
        .send('No tienes respuestas suficientes: solicita una recarga en TesisHub.');
      return;
    }

    tesistabJobStore[jobId] = {
      id: jobId,
      requestId: req.requestId,
      ownerEmail: jobOwnerEmail(req),
      label: `Compat ${formId || 'manual'}`,
      formUrl: normalizedFormUrl,
      formId: extractGoogleFormId(normalizedFormUrl),
      authorizationConfirmed: true,
      requestedCount,
      count: safeCount,
      requested: safeCount,
      reserved: Number.isFinite(Number(quota.reserved)) ? Number(quota.reserved) : safeCount,
      accepted: 0,
      refunded: 0,
      pending: safeCount,
      reservationId: quota.reservationId || jobId,
      quotaMode: quota.mode || (inProcessUsageManager ? 'responses' : 'legacy'),
      settlementStatus: 'reserved',
      delayMs: TESISTAB_MIN_DELAY_MS,
      jitterMs: 0,
      autoRandomizeText: false,
      distributionPlan: null,
      recentAppliedRules: [],
      status: 'queued',
      cancelRequested: false,
      pauseRequested: false,
      batchSize: TESISTAB_JOB_BATCH_SIZE,
      totalBatches: Math.ceil(safeCount / TESISTAB_JOB_BATCH_SIZE),
      currentBatch: 0,
      sent: 0,
      failed: 0,
      uncertain: 0,
      errors: [],
      latestResult: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
    };

    trimTesistabStoreIfNeeded();
    const smartRuntime = buildSmartProfileRuntime(null, safeCount);
    tesistabSmartRuntimeStore.set(jobId, smartRuntime);
    tesistabQuotaRuntimeStore.set(jobId, {
      apiKey: req.tesistabApiKey || null,
      reservationId: quota.reservationId || jobId,
    });
    tesistabJobStore[jobId].distributionPlan = summarizeSmartRuntimePlan(smartRuntime);
    await createTesistabJobRecord(tesistabJobStore[jobId], payload);

    if (TESISTAB_EXECUTE_JOBS) {
      runTesistabJob(jobId, payload).catch((error) => {
        failTesistabJob(jobId, error);
      });
    }
    res.type('text/plain').send(`/_submit?id=${jobId}`);
  } catch (error) {
    console.error(`[${req.requestId}] Compat submit error`, error);
    res.status(error?.statusCode || 500).type('text/plain')
      .send(error?.statusCode === 503 ? error.message : 'Failed to submit form');
  }
});

async function postData(formUrl, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TESISTAB_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(formUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TutoricaForms/1.0',
      },
      body,
      redirect: 'follow',
      signal: controller.signal,
    });

    const data = await response.text();
    return {
      status: response.status,
      data,
      retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runTesistabJob(jobId, executionPayload) {
  const job = tesistabJobStore[jobId];
  if (!job) {
    return;
  }
  const smartRuntime = tesistabSmartRuntimeStore.get(jobId) || null;

  job.status = 'running';
  job.updatedAt = new Date().toISOString();
  await persistTesistabJob(job);

  const alreadyProcessed = Math.max(
    0,
    Math.floor(Number(job.currentIndex ?? job.cursor ?? 0) || 0),
    Math.floor(Number(job.sent || 0) + Number(job.failed || 0)),
  );
  if (Number.isSafeInteger(Number(job.inFlightIndex))
    && Number(job.inFlightIndex) >= alreadyProcessed) {
    job.status = 'blocked';
    job.pauseRequested = true;
    job.uncertain = Math.max(1, Number(job.uncertain || 0));
    job.recoverableError = {
      code: 'delivery_uncertain_after_restart',
      message: 'El proceso se reinicio durante un envio. Confirma si esa respuesta fue aceptada antes de continuar.',
      retryable: false,
    };
    job.updatedAt = new Date().toISOString();
    await persistTesistabJob(job);
    return;
  }
  for (let i = alreadyProcessed; i < job.count; i++) {
    await refreshTesistabJobControl(job);
    job.currentBatch = Math.floor(i / Math.max(1, job.batchSize || TESISTAB_JOB_BATCH_SIZE)) + 1;

    while (job.pauseRequested && !job.cancelRequested) {
      job.status = 'paused';
      job.updatedAt = new Date().toISOString();
      await persistTesistabJob(job);
      await wait(250);
      await refreshTesistabJobControl(job);
    }

    if (job.cancelRequested) {
      job.status = 'cancelled';
      await persistTesistabJob(job);
      break;
    }

    try {
      if (smartRuntime) {
        smartRuntime.currentAttempt = i + 1;
        smartRuntime.currentProfileType = null;
      }
      const routedAttempt = buildRoutedAttemptPayload(
        executionPayload,
        i,
        job.autoRandomizeText,
        job.smartProfile,
        smartRuntime
      );
      const attemptPayload = routedAttempt.payload;
      job.currentRouteId = routedAttempt.routeId || null;
      if (smartRuntime && Array.isArray(smartRuntime.audit)) {
        job.recentAppliedRules = smartRuntime.audit.slice(-40);
      }
      const encodedPayload = toUrlEncodedPayload(attemptPayload);

      job.latestResult = {
        at: i + 1,
        status: null,
        message: 'Sending request to Google Forms...',
        preview: null,
      };
      job.inFlightIndex = i;
      job.updatedAt = new Date().toISOString();
      await persistTesistabJob(job);

      const { response, inspection } = await submitWithRetry(job, encodedPayload);

      if (inspection.pause) {
        job.inFlightIndex = null;
        job.status = 'blocked';
        job.pauseRequested = true;
        job.resumeStatus = 'queued';
        job.recoverableError = {
          code: inspection.code
            || (response.status === 429 ? 'provider_rate_limited' : 'provider_verification_required'),
          message: inspection.message,
          retryable: true,
        };
        job.latestResult = {
          at: i + 1,
          status: response.status,
          code: inspection.code || null,
          message: inspection.message,
          preview: inspection.preview,
        };
        job.updatedAt = new Date().toISOString();
        await persistTesistabJob(job);
        observeFormsEvent('job_blocked', {
          reason: response.status === 429 ? 'rate_limited' : 'provider_verification',
        });
        return;
      }

      if (inspection.fatal) {
        job.inFlightIndex = null;
        job.failed += 1;
        job.currentIndex = i + 1;
        job.cursor = i + 1;
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.errors.push({ at: i + 1, code: inspection.code || 'provider_rejected', message: inspection.message });
        job.latestResult = {
          at: i + 1,
          status: response.status,
          code: inspection.code || 'provider_rejected',
          message: inspection.message,
          preview: inspection.preview,
        };
        job.pending = Math.max(0, job.count - job.sent - job.failed);
        await settleTesistabJob(job);
        await persistTesistabJob(job);
        observeFormsEvent('response', { outcome: 'failed' });
        scheduleTesistabJobCleanup(jobId);
        return;
      }

      if (inspection.ok) {
        job.sent += 1;
        observeFormsEvent('response', {
          outcome: inspection.uncertain ? 'uncertain' : 'accepted',
        });
      } else {
        job.failed += 1;
        observeFormsEvent('response', { outcome: 'failed' });
        job.errors.push({
          at: i + 1,
          message: inspection.message,
        });
        if (job.errors.length > 15) {
          job.errors.shift();
        }
      }

      if (inspection.uncertain) {
        job.uncertain += 1;
      }
      job.inFlightIndex = null;
      job.accepted = Math.max(0, job.sent - job.uncertain);

      job.latestResult = {
        at: i + 1,
        status: response.status,
        code: inspection.code || null,
        message: inspection.message,
        preview: inspection.preview,
      };
    } catch (error) {
      // Un timeout o corte puede ocurrir despues de que Google acepto la
      // respuesta. Avanzar el cursor o reintentar automaticamente arriesgaria
      // duplicarla; se conserva inFlightIndex y se exige conciliacion.
      job.status = 'blocked';
      job.pauseRequested = true;
      job.uncertain = Number(job.uncertain || 0) + 1;
      job.recoverableError = {
        code: 'delivery_uncertain_after_restart',
        message: error?.message || 'No se pudo confirmar si Google acepto la respuesta.',
        retryable: false,
      };
      job.updatedAt = new Date().toISOString();
      await persistTesistabJob(job);
      observeFormsEvent('job_blocked', { reason: 'delivery_uncertain' });
      return;
    }

    job.updatedAt = new Date().toISOString();
    job.currentIndex = i + 1;
    job.cursor = i + 1;
    job.pending = Math.max(0, job.count - job.sent - job.failed);
    await persistTesistabJob(job);
    if (i + 1 < job.count && !job.cancelRequested) {
      await wait(job.delayMs + randomJitter(job.jitterMs));
    }
  }

  if (job.cancelRequested) {
    job.status = 'cancelled';
  } else if (job.status !== 'cancelled') {
    job.status = job.failed > 0 ? 'completed_with_errors' : 'completed';
  }
  job.finishedAt = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  job.pending = Math.max(0, job.count - job.sent - job.failed);
  await settleTesistabJob(job);
  scheduleTesistabJobCleanup(jobId);
  tesistabSmartRuntimeStore.delete(jobId);
  tesistabQuotaRuntimeStore.delete(jobId);
  await persistTesistabJob(job);
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

async function submitWithRetry(job, encodedPayload) {
  return retryProviderSubmission(job, encodedPayload, {
    send: postData,
    sleep: wait,
    persist: persistTesistabJob,
    retries: TESISTAB_PROVIDER_RETRIES,
  });
}

async function retryProviderSubmission(job, encodedPayload, dependencies = {}) {
  const send = dependencies.send || postData;
  const sleep = dependencies.sleep || wait;
  const persist = dependencies.persist || persistTesistabJob;
  const retries = Math.max(1, Number(dependencies.retries || TESISTAB_PROVIDER_RETRIES));
  let response;
  let inspection;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    response = await withTimeout(
      send(job.formUrl, encodedPayload),
      TESISTAB_REQUEST_TIMEOUT_MS,
      'Google request timeout'
    );
    inspection = inspectGoogleResponse(response);
    if (!inspection.retryable || attempt + 1 >= retries) break;
    const backoffMs = computeProviderBackoffMs(response, attempt);
    job.retryAttempts = Number(job.retryAttempts || 0) + 1;
    job.latestResult = {
      at: Number(job.currentIndex || 0) + 1,
      status: response.status,
      message: `${inspection.message}; reintento ${attempt + 2}/${retries}`,
      preview: null,
    };
    await persist(job);
    await sleep(backoffMs);
  }
  return { response, inspection };
}

function computeProviderBackoffMs(response, attempt) {
  if (
    response?.retryAfterMs !== null
    && response?.retryAfterMs !== undefined
    && Number.isFinite(Number(response.retryAfterMs))
    && Number(response.retryAfterMs) >= 0
  ) {
    return Number(response.retryAfterMs);
  }
  return Math.min(30_000, 750 * (2 ** Math.max(0, Number(attempt) || 0)));
}

async function failTesistabJob(jobId, error) {
  const job = tesistabJobStore[jobId];
  if (!job || isTerminalJobStatus(job.status)) {
    return;
  }
  // La pérdida del lease significa que otra instancia es (o será) la única
  // autorizada para continuar. El worker anterior no debe marcar el job como
  // fallido ni liquidar/reembolsar una reserva que ya no le pertenece.
  if (error?.code === 'lease_lost') {
    tesistabSmartRuntimeStore.delete(jobId);
    tesistabQuotaRuntimeStore.delete(jobId);
    return;
  }
  job.status = 'failed';
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  job.latestResult = {
    at: Number(job.sent || 0) + Number(job.failed || 0),
    status: null,
    message: error?.message || 'Job execution failed',
    preview: null,
  };
  job.errors = Array.isArray(job.errors) ? job.errors : [];
  job.errors.push({
    at: job.latestResult.at,
    message: job.latestResult.message,
  });
  await settleTesistabJob(job);
  tesistabSmartRuntimeStore.delete(jobId);
  tesistabQuotaRuntimeStore.delete(jobId);
  scheduleTesistabJobCleanup(jobId);
  await persistTesistabJob(job);
}

function validateTesistabFormUrl(formUrl) {
  try {
    const parsed = new URL(formUrl);
    if (parsed.protocol !== 'https:') {
      return { ok: false, message: 'Only https form URLs are allowed' };
    }

    if (!TESISTAB_ALLOWED_HOSTS.includes(parsed.hostname)) {
      return {
        ok: false,
        message: `Host not allowed. Allowed hosts: ${TESISTAB_ALLOWED_HOSTS.join(', ')}`,
      };
    }

    if (!parsed.pathname.includes('/forms/') || !parsed.pathname.endsWith('/formResponse')) {
      return {
        ok: false,
        message: 'formUrl must be a Google Forms /formResponse endpoint',
      };
    }

    return {
      ok: true,
      normalizedUrl: normalizeGoogleFormResponseUrl(parsed),
    };
  } catch (error) {
    return { ok: false, message: 'formUrl must be a valid URL' };
  }
}

function normalizeGoogleFormResponseUrl(parsedUrl) {
  const cloned = new URL(parsedUrl.toString());
  cloned.pathname = cloned.pathname.replace(/\/u\/\d+\//, '/');
  return cloned.toString();
}

function toUrlEncodedPayload(payload) {
  const params = new URLSearchParams();

  for (const [name, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(name, String(item));
        }
      }
      continue;
    }

    if (value !== undefined && value !== null) {
      params.append(name, String(value));
    }
  }

  return params.toString();
}

function buildAttemptPayload(payload, attemptIndex, autoRandomizeText, smartProfile, smartRuntime) {
  return buildAttemptPayloadWithContext(
    payload,
    attemptIndex,
    autoRandomizeText,
    smartProfile,
    smartRuntime,
    null
  );
}

function buildAttemptPayloadWithContext(
  payload,
  attemptIndex,
  autoRandomizeText,
  smartProfile,
  smartRuntime,
  attemptContext,
) {
  const attemptPayload = {};
  const profileType = resolveAttemptProfileType(smartProfile, smartRuntime);

  for (const [key, rawValue] of Object.entries(payload || {})) {
    if (!shouldIncludePayloadField(key)) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      attemptPayload[key] = rawValue.map((value) =>
        applyRandomTokens(String(value), attemptIndex)
      );
      continue;
    }

    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    let value = applyRandomTokens(String(rawValue), attemptIndex);

    if (smartProfile?.enabled && key.startsWith('entry.')) {
      const cache = attemptContext?.profileValues;
      if (cache?.has(key)) {
        value = cache.get(key);
      } else {
        value = applySmartProfileValue(key, value, smartProfile, smartRuntime, profileType);
        cache?.set(key, value);
      }
    }

    if (autoRandomizeText && shouldAutoRandomizeField(key, value)) {
      value = `${value} ${randomToken(4)}`;
    }

    attemptPayload[key] = value;
  }

  return attemptPayload;
}

function buildRoutedAttemptPayload(
  executionPayload,
  attemptIndex,
  autoRandomizeText,
  smartProfile,
  smartRuntime,
) {
  const isEnvelope = executionPayload?.__tesistabExecutionVersion === 2
    && executionPayload.basePayload
    && executionPayload.multiPage?.routes?.length;
  if (!isEnvelope) {
    return {
      payload: buildAttemptPayload(
        executionPayload,
        attemptIndex,
        autoRandomizeText,
        smartProfile,
        smartRuntime
      ),
      routeId: null,
    };
  }

  const { basePayload, multiPage } = executionPayload;
  const routes = multiPage.routes;
  const candidate = routes[Math.abs(attemptIndex) % routes.length];
  const attemptContext = { profileValues: new Map() };
  const firstPayload = buildAttemptPayloadWithContext(
    composeMultiPageRoutePayload(basePayload, candidate, routes),
    attemptIndex,
    autoRandomizeText,
    smartProfile,
    smartRuntime,
    attemptContext,
  );
  const selected = selectMultiPageRoute(routes, firstPayload, candidate.id);
  if (!selected || selected.id === candidate.id) {
    alignPayloadWithRouteConditions(firstPayload, selected || candidate);
    return { payload: firstPayload, routeId: (selected || candidate).id };
  }

  const selectedPayload = buildAttemptPayloadWithContext(
    composeMultiPageRoutePayload(basePayload, selected, routes),
    attemptIndex,
    autoRandomizeText,
    smartProfile,
    smartRuntime,
    attemptContext,
  );
  alignPayloadWithRouteConditions(selectedPayload, selected);
  return { payload: selectedPayload, routeId: selected.id };
}

function composeMultiPageRoutePayload(basePayload, route, routes) {
  const routedEntryKeys = new Set(
    routes.flatMap((item) => Object.keys(item.payload || {}).filter((key) => key.startsWith('entry.')))
  );
  const shared = {};
  for (const [key, value] of Object.entries(basePayload || {})) {
    if (!key.startsWith('entry.') || !routedEntryKeys.has(key)) {
      shared[key] = value;
    }
  }
  // El payload de una ruta es completo para ese recorrido e incluye sus
  // tokens pageHistory/partialResponse. Nunca se agregan entries de otra ruta.
  return { ...shared, ...(route?.payload || {}) };
}

function selectMultiPageRoute(routes, payload, candidateId) {
  const matches = routes.filter((route) => (
    route.when?.all?.length > 0 && routeMatchesPayload(route, payload)
  ));
  const candidateMatch = matches.find((route) => route.id === candidateId);
  if (candidateMatch) return candidateMatch;
  if (matches.length) return matches[0];
  const candidate = routes.find((route) => route.id === candidateId);
  if (candidate && !candidate.when?.all?.length) return candidate;
  return routes.find((route) => route.fallback)
    || candidate
    || routes[0]
    || null;
}

function routeMatchesPayload(route, payload) {
  return (route.when?.all || []).every((condition) => {
    const actual = payload?.[condition.field];
    const actualValues = (Array.isArray(actual) ? actual : [actual]).map((value) => String(value ?? ''));
    const expected = condition.operator === 'in'
      ? condition.values
      : [condition.value];
    return actualValues.some((value) => expected.includes(value));
  });
}

function alignPayloadWithRouteConditions(payload, route) {
  // Si el perfil produjo una opcion para la que no se capturo una rama, se
  // usa la ruta candidata/fallback y se alinea solo su selector. Asi nunca se
  // envian pageHistory y respuestas de una rama junto a la opcion de otra.
  for (const condition of route?.when?.all || []) {
    if (routeMatchesPayload({ when: { all: [condition] } }, payload)) continue;
    const value = condition.operator === 'in' ? condition.values[0] : condition.value;
    if (value !== undefined) payload[condition.field] = value;
  }
}

function resolveAttemptProfileType(smartProfile, smartRuntime) {
  if (smartRuntime?.currentProfileType) {
    return smartRuntime.currentProfileType;
  }

  const fromDistribution = pickProfileTypeByRuntime(smartRuntime);
  const resolved = fromDistribution || smartProfile?.type || 'favorable';
  if (smartRuntime) {
    smartRuntime.currentProfileType = resolved;
  }
  return resolved;
}

function pickProfileTypeByRuntime(smartRuntime) {
  if (!smartRuntime?.profilePlan?.targets || !smartRuntime?.profilePlan?.used) {
    return '';
  }

  const keys = ['favorable', 'intermedio', 'desfavorable'];
  const preferredKeys = keys
    .map((key) => ({
      key,
      deficit: Number(smartRuntime.profilePlan.targets[key] || 0) - Number(smartRuntime.profilePlan.used[key] || 0),
    }))
    .filter((item) => item.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);

  const source = preferredKeys.length ? preferredKeys.map((item) => item.key) : keys;
  const picked = source[Math.floor(Math.random() * source.length)] || '';
  if (!picked) {
    return '';
  }

  smartRuntime.profilePlan.used[picked] = Number(smartRuntime.profilePlan.used[picked] || 0) + 1;
  return picked;
}

function applySmartProfileValue(key, value, smartProfile, smartRuntime, profileType) {
  const entryKey = String(key || '');
  const currentValue = String(value || '');

  if (
    smartProfile.specialEntryKey &&
    entryKey === smartProfile.specialEntryKey &&
    smartProfile.specialPreferred
  ) {
    return String(smartProfile.specialPreferred);
  }

  const fromRuntime = pickSmartOptionByRuntime(entryKey, smartRuntime, currentValue);
  if (fromRuntime) {
    return fromRuntime;
  }

  const score = resolveLikertScore(currentValue);
  if (score > 0) {
    const target = pickLikertScoreByProfile(profileType || smartProfile.type || 'favorable');
    return mapLikertScoreToTemplate(currentValue, target);
  }

  return currentValue;
}

function pickAlternativeOption(options, fallbackValue) {
  const source = Array.from(
    new Set((options || []).map((option) => String(option || '').trim()).filter(Boolean))
  );
  if (!source.length) {
    return String(fallbackValue || '');
  }

  const normalizedFallback = normalizeForMatch(fallbackValue);
  const alternatives = source.filter((value) => normalizeForMatch(value) !== normalizedFallback);
  const pool = alternatives.length ? alternatives : source;
  return pool[Math.floor(Math.random() * pool.length)] || String(fallbackValue || '');
}

function applyRandomTokens(value, attemptIndex) {
  return value
    .replace(/\{\{i\}\}/g, String(attemptIndex + 1))
    .replace(/\{\{rand\}\}/g, randomToken(6));
}

function shouldAutoRandomizeField(key, value) {
  if (!key.startsWith('entry.')) {
    return false;
  }

  if (!value || /\{\{rand\}\}|\{\{i\}\}/.test(value)) {
    return false;
  }

  if (/^(fvv|fbzx|partialResponse|pageHistory|draftResponse|dlut)$/i.test(key)) {
    return false;
  }

  return value.length >= 8 && /\s/.test(value);
}

function sanitizeMultiPageConfig(raw) {
  if (raw === undefined || raw === null || raw === false) {
    return { ok: true, value: null };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, field: 'config.multiPage', message: 'multiPage debe ser un objeto' };
  }

  // Los clientes 1.5 solo enviaban pages como metadato y un payload plano.
  // Se mantiene ese contrato como una ruta unica durante la compatibilidad.
  if (!Array.isArray(raw.routes)) {
    return { ok: true, value: null };
  }
  if (!raw.routes.length || raw.routes.length > TESISTAB_MAX_MULTIPAGE_ROUTES) {
    return {
      ok: false,
      field: 'config.multiPage.routes',
      message: `multiPage.routes debe contener entre 1 y ${TESISTAB_MAX_MULTIPAGE_ROUTES} rutas`,
    };
  }

  const ids = new Set();
  const routes = [];
  let fallbackCount = 0;
  for (let index = 0; index < raw.routes.length; index += 1) {
    const source = raw.routes[index];
    const prefix = `config.multiPage.routes[${index}]`;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, field: prefix, message: `${prefix} debe ser un objeto` };
    }

    const id = String(source.id || `route-${index + 1}`).trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) {
      return {
        ok: false,
        field: `${prefix}.id`,
        message: `${prefix}.id debe ser unico y usar solo letras, numeros, _ o -`,
      };
    }
    ids.add(id);

    const payloadResult = sanitizeMultiPageRoutePayload(source.payload, `${prefix}.payload`);
    if (!payloadResult.ok) return payloadResult;
    const whenResult = sanitizeMultiPageRouteConditions(source.when, `${prefix}.when`);
    if (!whenResult.ok) return whenResult;
    const pagesResult = sanitizeMultiPageRoutePages(source.pages, `${prefix}.pages`);
    if (!pagesResult.ok) return pagesResult;

    const fallback = Boolean(source.fallback);
    if (fallback) fallbackCount += 1;
    routes.push({
      id,
      fallback,
      when: whenResult.value,
      payload: payloadResult.value,
      pages: pagesResult.value,
    });
  }

  if (fallbackCount > 1) {
    return {
      ok: false,
      field: 'config.multiPage.routes',
      message: 'Solo una ruta puede declararse como fallback',
    };
  }

  return {
    ok: true,
    value: {
      version: 1,
      guidedCapture: Boolean(raw.guidedCapture),
      routes,
    },
  };
}

function sanitizeMultiPageRoutePayload(raw, field) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, field, message: `${field} debe ser un objeto` };
  }
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > TESISTAB_MAX_ROUTE_PAYLOAD_FIELDS) {
    return {
      ok: false,
      field,
      message: `${field} debe contener entre 1 y ${TESISTAB_MAX_ROUTE_PAYLOAD_FIELDS} campos`,
    };
  }

  const output = {};
  for (const [key, value] of entries) {
    if (!shouldIncludePayloadField(key)) {
      return { ok: false, field: `${field}.${key}`, message: `Campo de ruta no permitido: ${key}` };
    }
    const sanitized = sanitizeRouteFieldValue(value);
    if (!sanitized.ok) {
      return { ok: false, field: `${field}.${key}`, message: sanitized.message };
    }
    output[key] = sanitized.value;
  }
  return { ok: true, value: output };
}

function sanitizeRouteFieldValue(value) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.length > 50) {
    return { ok: false, message: 'Un campo de ruta admite entre 1 y 50 valores' };
  }
  const normalized = [];
  for (const item of values) {
    if (!['string', 'number', 'boolean'].includes(typeof item)) {
      return { ok: false, message: 'Los valores de ruta deben ser texto, numero o booleano' };
    }
    const text = String(item);
    if (text.length > 20_000) {
      return { ok: false, message: 'Un valor de ruta no puede superar 20000 caracteres' };
    }
    normalized.push(text);
  }
  return { ok: true, value: Array.isArray(value) ? normalized : normalized[0] };
}

function sanitizeMultiPageRouteConditions(raw, field) {
  if (raw === undefined || raw === null) return { ok: true, value: { all: [] } };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.all)) {
    return { ok: false, field, message: `${field}.all debe ser un arreglo` };
  }
  if (raw.all.length > TESISTAB_MAX_ROUTE_CONDITIONS) {
    return {
      ok: false,
      field: `${field}.all`,
      message: `Una ruta admite como maximo ${TESISTAB_MAX_ROUTE_CONDITIONS} condiciones`,
    };
  }

  const all = [];
  const fields = new Set();
  for (let index = 0; index < raw.all.length; index += 1) {
    const condition = raw.all[index];
    const conditionField = `${field}.all[${index}]`;
    const entry = String(condition?.field || '');
    if (!/^entry\.\d+$/.test(entry) || fields.has(entry)) {
      return {
        ok: false,
        field: `${conditionField}.field`,
        message: 'Cada condicion debe usar un campo entry.N unico',
      };
    }
    const operator = condition?.operator === 'in' ? 'in' : 'equals';
    const rawValues = operator === 'in' ? condition.values : [condition?.value];
    if (!Array.isArray(rawValues) || !rawValues.length || rawValues.length > 24) {
      return {
        ok: false,
        field: conditionField,
        message: 'La condicion debe incluir entre 1 y 24 valores',
      };
    }
    const values = rawValues.map((value) => String(value ?? '').slice(0, 1000));
    fields.add(entry);
    all.push(operator === 'in'
      ? { field: entry, operator, values }
      : { field: entry, operator, value: values[0] });
  }
  return { ok: true, value: { all } };
}

function sanitizeMultiPageRoutePages(raw, field) {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > TESISTAB_MAX_MULTIPAGE_PAGES_PER_ROUTE) {
    return {
      ok: false,
      field,
      message: `Una ruta admite hasta ${TESISTAB_MAX_MULTIPAGE_PAGES_PER_ROUTE} paginas`,
    };
  }
  return {
    ok: true,
    value: raw.map((page, index) => ({
      index,
      pageKey: String(page?.pageKey || `page-${index + 1}`).slice(0, 240),
      entries: Array.from(new Set(
        Array.isArray(page?.entries)
          ? page.entries.filter((entry) => /^entry\.\d+$/.test(String(entry))).slice(0, 300)
          : []
      )),
    })),
  };
}

function summarizeMultiPageConfig(config) {
  if (!config?.routes?.length) return null;
  return {
    version: config.version,
    guidedCapture: Boolean(config.guidedCapture),
    routeCount: config.routes.length,
    selectorEntries: Array.from(new Set(
      config.routes.flatMap((route) => route.when.all.map((condition) => condition.field))
    )),
  };
}

function buildExecutionPayload(basePayload, multiPage) {
  if (!multiPage?.routes?.length) return basePayload;
  return {
    __tesistabExecutionVersion: 2,
    basePayload,
    multiPage,
  };
}

function sanitizeSmartProfile(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(input.enabled),
    type: normalizeProfileType(input.type),
    distribution: sanitizeSmartProfileDistribution(input.distribution),
    specialEntryKey: /^entry\.\d+$/.test(String(input.specialEntryKey || ''))
      ? String(input.specialEntryKey)
      : '',
    specialPreferred: String(input.specialPreferred || '').trim().slice(0, 180),
    advanced: sanitizeSmartAdvancedOptions(input.advanced),
    entryMeta: sanitizeSmartEntryMeta(input.entryMeta),
  };
}

function sanitizeSmartProfileDistribution(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(input.enabled),
    shares: sanitizeSmartProfileShares(input.shares),
  };
}

function sanitizeSmartProfileShares(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    favorable: clampProfilePercent(input.favorable, 60),
    intermedio: clampProfilePercent(input.intermedio, 25),
    desfavorable: clampProfilePercent(input.desfavorable, 15),
  };
}

function clampProfilePercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(Math.round(numeric), 0, 100);
}

function sanitizeSmartAdvancedOptions(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const mode = Boolean(input.mode);
  return {
    mode,
    gender: Boolean(mode && input.gender),
    age: Boolean(mode && input.age),
    frequency: Boolean(mode && input.frequency),
    personality: Boolean(mode && input.personality),
  };
}

function sanitizeSmartEntryMeta(raw) {
  const output = {};
  if (!raw || typeof raw !== 'object') {
    return output;
  }

  for (const [entryKey, entryMeta] of Object.entries(raw)) {
    if (!/^entry\.\d+$/.test(String(entryKey || ''))) {
      continue;
    }

    const question = String(entryMeta?.question || '')
      .trim()
      .slice(0, 240);
    const options = Array.from(
      new Set(
        Array.isArray(entryMeta?.options)
          ? entryMeta.options
              .map((option) => String(option || '').trim())
              .filter(Boolean)
              .slice(0, 24)
          : []
      )
    );

    if (!question && !options.length) {
      continue;
    }

    output[entryKey] = {
      question,
      options,
    };
  }

  return output;
}

function resolveTesistabDistributionConfig() {
  const genderMin = clampFraction(TESISTAB_GENDER_SHARE_MIN, 0.4);
  const genderMax = clampFraction(TESISTAB_GENDER_SHARE_MAX, 0.6);
  const minShare = Math.min(genderMin, genderMax);
  const maxShare = Math.max(genderMin, genderMax);

  const age = normalizeShares(
    {
      age_18_25: TESISTAB_AGE_SHARE_18_25,
      age_26_35: TESISTAB_AGE_SHARE_26_35,
      age_36_45: TESISTAB_AGE_SHARE_36_45,
      age_46_plus: TESISTAB_AGE_SHARE_46_PLUS,
    },
    {
      age_18_25: 0.35,
      age_26_35: 0.4,
      age_36_45: 0.2,
      age_46_plus: 0.05,
    }
  );

  const frequency = normalizeShares(
    {
      weekly: TESISTAB_FREQ_SHARE_WEEKLY,
      biweekly: TESISTAB_FREQ_SHARE_BIWEEKLY,
      monthly: TESISTAB_FREQ_SHARE_MONTHLY,
      occasional: TESISTAB_FREQ_SHARE_OCCASIONAL,
    },
    {
      weekly: 0.15,
      biweekly: 0.35,
      monthly: 0.35,
      occasional: 0.15,
    }
  );

  return {
    gender: {
      min: minShare,
      max: maxShare,
    },
    age,
    frequency,
  };
}

function clampFraction(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(numeric, 0, 1);
}

function normalizeShares(rawShares, fallbackShares) {
  const output = {};
  let sum = 0;

  for (const [key, value] of Object.entries(rawShares || {})) {
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
    output[key] = safe;
    sum += safe;
  }

  if (sum <= 0) {
    return { ...fallbackShares };
  }

  for (const key of Object.keys(output)) {
    output[key] = output[key] / sum;
  }

  return output;
}

function buildSmartProfileRuntime(smartProfile, totalAttempts) {
  if (!smartProfile?.enabled || !Number.isFinite(totalAttempts) || totalAttempts <= 0) {
    return null;
  }

  const profilePlan = buildProfileDistributionRuntime(smartProfile, totalAttempts);
  const advanced = smartProfile.advanced || {};
  const shouldBuildAdvancedEntries = Boolean(advanced.mode);
  if (!profilePlan && !shouldBuildAdvancedEntries) {
    return null;
  }

  const entryMeta = smartProfile.entryMeta || {};
  const runtime = {
    totalAttempts,
    profilePlan,
    currentProfileType: null,
    entries: {},
    audit: [],
    maxAudit: 120,
  };

  if (shouldBuildAdvancedEntries) {
    for (const [entryKey, meta] of Object.entries(entryMeta)) {
      const config = buildEntryRuntimeConfig(meta, totalAttempts, smartProfile);
      if (config) {
        runtime.entries[entryKey] = config;
      }
    }
  }

  return runtime;
}

function buildProfileDistributionRuntime(smartProfile, totalAttempts) {
  if (!smartProfile?.distribution?.enabled) {
    return null;
  }

  const weights = normalizeProfileDistributionShares(smartProfile.distribution.shares);
  return {
    targets: allocateTargets(totalAttempts, weights),
    used: {
      favorable: 0,
      intermedio: 0,
      desfavorable: 0,
    },
  };
}

function normalizeProfileDistributionShares(rawShares) {
  const shares = {
    favorable: Number(rawShares?.favorable) || 0,
    intermedio: Number(rawShares?.intermedio) || 0,
    desfavorable: Number(rawShares?.desfavorable) || 0,
  };
  const total = shares.favorable + shares.intermedio + shares.desfavorable;
  if (total <= 0) {
    return {
      favorable: 0.6,
      intermedio: 0.25,
      desfavorable: 0.15,
    };
  }

  return {
    favorable: shares.favorable / total,
    intermedio: shares.intermedio / total,
    desfavorable: shares.desfavorable / total,
  };
}

function summarizeSmartRuntimePlan(runtime) {
  if (!runtime?.entries && !runtime?.profilePlan) {
    return null;
  }

  const profilePlan = runtime.profilePlan
    ? {
        targets: { ...(runtime.profilePlan.targets || {}) },
      }
    : null;
  const entries = {};
  for (const [entryKey, config] of Object.entries(runtime.entries)) {
    entries[entryKey] = {
      category: config.category || 'generic',
      targets: { ...(config.targets || {}) },
      groups: Object.fromEntries(
        Object.entries(config.groups || {}).map(([groupKey, values]) => [groupKey, values.length])
      ),
    };
  }

  return {
    totalAttempts: runtime.totalAttempts,
    profilePlan,
    entries,
  };
}

function recordSmartRule(runtime, detail) {
  if (!runtime || !Array.isArray(runtime.audit)) {
    return;
  }

  const item = {
    attempt: Number(runtime.currentAttempt || 0) || null,
    entryKey: String(detail?.entryKey || ''),
    category: String(detail?.category || 'generic'),
    group: String(detail?.group || ''),
    value: String(detail?.value || ''),
  };

  runtime.audit.push(item);
  const max = Number(runtime.maxAudit || 120);
  if (runtime.audit.length > max) {
    runtime.audit.splice(0, runtime.audit.length - max);
  }
}

function buildEntryRuntimeConfig(meta, totalAttempts, smartProfile) {
  const options = Array.from(new Set((meta?.options || []).map((value) => String(value || '').trim())))
    .filter(Boolean);
  if (!options.length) {
    return null;
  }

  const advanced = smartProfile?.advanced || {};
  const normalizedQuestion = normalizeForMatch(meta?.question || '');
  const normalizedOptions = options.map((value) => normalizeForMatch(value));

  if (advanced.gender) {
    const genderGroups = buildGenderGroups(options, normalizedOptions, normalizedQuestion);
    if (genderGroups) {
      const femaleShare =
        TESISTAB_DISTRIBUTION_CONFIG.gender.min +
        Math.random() * (TESISTAB_DISTRIBUTION_CONFIG.gender.max - TESISTAB_DISTRIBUTION_CONFIG.gender.min);
      const maleShare = 1 - femaleShare;
      const genderWeights = selectWeightsForPresentGroups(
        {
          female: femaleShare,
          male: maleShare,
          other: 0,
        },
        genderGroups
      );
      return {
        category: 'gender',
        groups: genderGroups,
        targets: allocateTargets(totalAttempts, genderWeights),
        used: { female: 0, male: 0, other: 0 },
      };
    }
  }

  if (advanced.age) {
    const ageGroups = buildAgeGroups(options, normalizedOptions, normalizedQuestion);
    if (ageGroups) {
      const ageWeights = selectWeightsForPresentGroups(TESISTAB_DISTRIBUTION_CONFIG.age, ageGroups);
      return {
        category: 'age',
        groups: ageGroups,
        targets: allocateTargets(totalAttempts, ageWeights),
        used: { age_18_25: 0, age_26_35: 0, age_36_45: 0, age_46_plus: 0, other: 0 },
      };
    }
  }

  if (advanced.frequency) {
    const frequencyGroups = buildFrequencyGroups(options, normalizedOptions, normalizedQuestion);
    if (frequencyGroups) {
      const frequencyWeights = selectWeightsForPresentGroups(
        TESISTAB_DISTRIBUTION_CONFIG.frequency,
        frequencyGroups
      );
      return {
        category: 'frequency',
        groups: frequencyGroups,
        targets: allocateTargets(totalAttempts, frequencyWeights),
        used: { weekly: 0, biweekly: 0, monthly: 0, occasional: 0, other: 0 },
      };
    }
  }

  if (advanced.personality && looksLikePersonalityPrompt(normalizedQuestion, normalizedOptions)) {
    const weights = {};
    options.forEach((_, index) => {
      weights[String(index)] = 1 / options.length;
    });

    const groups = {};
    options.forEach((value, index) => {
      groups[String(index)] = [value];
    });

    const used = {};
    options.forEach((_, index) => {
      used[String(index)] = 0;
    });

    return {
      category: 'personality',
      groups,
      targets: allocateTargets(totalAttempts, weights),
      used,
    };
  }

  return null;
}

function pickSmartOptionByRuntime(entryKey, smartRuntime, fallbackValue) {
  if (!smartRuntime?.entries || !entryKey) {
    return '';
  }

  const config = smartRuntime.entries[entryKey];
  if (!config?.groups || !config?.targets || !config?.used) {
    return '';
  }

  const keys = Object.keys(config.groups).filter((groupKey) => {
    const list = config.groups[groupKey];
    return Array.isArray(list) && list.length > 0;
  });
  if (!keys.length) {
    return '';
  }

  const preferredKeys = keys
    .map((groupKey) => {
      const target = Number(config.targets[groupKey] || 0);
      const used = Number(config.used[groupKey] || 0);
      return {
        groupKey,
        deficit: target - used,
      };
    })
    .filter((item) => item.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);

  const candidateKeys = preferredKeys.length
    ? preferredKeys.map((item) => item.groupKey)
    : keys;
  const pickedGroup = candidateKeys[Math.floor(Math.random() * candidateKeys.length)];
  if (!pickedGroup) {
    return '';
  }

  const options = config.groups[pickedGroup];
  const normalizedFallback = normalizeForMatch(fallbackValue);
  const alternatives = options.filter((value) => normalizeForMatch(value) !== normalizedFallback);
  const source = alternatives.length ? alternatives : options;
  if (!source.length) {
    return '';
  }

  const chosen = source[Math.floor(Math.random() * source.length)];
  config.used[pickedGroup] = Number(config.used[pickedGroup] || 0) + 1;
  recordSmartRule(smartRuntime, {
    entryKey,
    category: config.category || 'generic',
    group: pickedGroup,
    value: chosen,
  });
  return chosen;
}

function allocateTargets(total, weights) {
  const entries = Object.entries(weights || {}).filter(([, weight]) => Number(weight) > 0);
  if (!entries.length || total <= 0) {
    return {};
  }

  const totalWeight = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  const bases = [];
  let assigned = 0;

  for (const [key, weight] of entries) {
    const exact = (total * Number(weight)) / totalWeight;
    const floorValue = Math.floor(exact);
    bases.push({ key, count: floorValue, remainder: exact - floorValue });
    assigned += floorValue;
  }

  let remaining = total - assigned;
  bases.sort((a, b) => b.remainder - a.remainder);
  let cursor = 0;
  while (remaining > 0 && bases.length) {
    bases[cursor % bases.length].count += 1;
    cursor += 1;
    remaining -= 1;
  }

  const targets = {};
  for (const item of bases) {
    targets[item.key] = item.count;
  }
  return targets;
}

function selectWeightsForPresentGroups(baseWeights, groups) {
  const presentKeys = Object.keys(groups || {}).filter((key) =>
    Array.isArray(groups[key]) ? groups[key].length > 0 : false
  );
  if (!presentKeys.length) {
    return {};
  }

  const selected = {};
  let sum = 0;
  for (const key of presentKeys) {
    const value = Number(baseWeights?.[key] || 0);
    if (value > 0) {
      selected[key] = value;
      sum += value;
    }
  }

  if (sum <= 0) {
    const uniform = 1 / presentKeys.length;
    const output = {};
    for (const key of presentKeys) {
      output[key] = uniform;
    }
    return output;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(selected)) {
    normalized[key] = value / sum;
  }
  return normalized;
}

function buildGenderGroups(options, normalizedOptions, normalizedQuestion) {
  const promptLooksGender =
    /\bgenero\b|\bsexo\b|\bgender\b|\bsex\b|identidad de genero/.test(normalizedQuestion);
  const groups = { male: [], female: [], other: [] };

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const text = normalizedOptions[i];
    if (/masculino|male|hombre/.test(text)) {
      groups.male.push(option);
      continue;
    }
    if (/femenino|female|mujer/.test(text)) {
      groups.female.push(option);
      continue;
    }
    if (/otro|other|prefiero no/.test(text)) {
      groups.other.push(option);
    }
  }

  if (groups.male.length && groups.female.length) {
    return groups;
  }

  if (promptLooksGender && (groups.male.length || groups.female.length || groups.other.length)) {
    return groups;
  }

  return null;
}

function buildAgeGroups(options, normalizedOptions, normalizedQuestion) {
  const promptLooksAge = /\bedad\b|\bage\b|rango de edad|grupo de edad/.test(normalizedQuestion);
  const groups = {
    age_18_25: [],
    age_26_35: [],
    age_36_45: [],
    age_46_plus: [],
    other: [],
  };

  for (let i = 0; i < options.length; i++) {
    const bucket = classifyAgeBucket(options[i], normalizedOptions[i]);
    if (bucket) {
      groups[bucket].push(options[i]);
    } else {
      groups.other.push(options[i]);
    }
  }

  const filled =
    groups.age_18_25.length +
    groups.age_26_35.length +
    groups.age_36_45.length +
    groups.age_46_plus.length;
  if (filled >= 2 || (promptLooksAge && filled >= 1)) {
    return groups;
  }

  return null;
}

function classifyAgeBucket(original, normalized) {
  const text = normalized || normalizeForMatch(original);
  const numericParts = Array.from(text.matchAll(/\d{1,2}/g)).map((item) => Number(item[0]));
  const min = numericParts.length ? Math.min(...numericParts) : Number.NaN;
  const max = numericParts.length ? Math.max(...numericParts) : Number.NaN;

  if (/\b46\b.*(mas|a mas|\+)|\b50\+|\b60\+|\b65\+/.test(text)) {
    return 'age_46_plus';
  }

  if (Number.isFinite(min) && Number.isFinite(max)) {
    if (max <= 25) return 'age_18_25';
    if (min >= 26 && max <= 35) return 'age_26_35';
    if (min >= 36 && max <= 45) return 'age_36_45';
    if (min >= 46) return 'age_46_plus';
  }

  return null;
}

function buildFrequencyGroups(options, normalizedOptions, normalizedQuestion) {
  const promptLooksFrequency = /frecuencia|frequency|cada cuanto/.test(normalizedQuestion);
  const groups = {
    weekly: [],
    biweekly: [],
    monthly: [],
    occasional: [],
    other: [],
  };

  for (let i = 0; i < options.length; i++) {
    const text = normalizedOptions[i];
    if (/semanal|weekly/.test(text)) {
      groups.weekly.push(options[i]);
      continue;
    }
    if (/quincenal|fortnight|biweekly/.test(text)) {
      groups.biweekly.push(options[i]);
      continue;
    }
    if (/mensual|monthly/.test(text)) {
      groups.monthly.push(options[i]);
      continue;
    }
    if (/ocasional|ocasionalmente|eventual|rarely|de vez en cuando/.test(text)) {
      groups.occasional.push(options[i]);
      continue;
    }
    groups.other.push(options[i]);
  }

  const filled =
    groups.weekly.length +
    groups.biweekly.length +
    groups.monthly.length +
    groups.occasional.length;
  if (filled >= 2 || (promptLooksFrequency && filled >= 1)) {
    return groups;
  }

  return null;
}

function looksLikePersonalityPrompt(normalizedQuestion, normalizedOptions) {
  const joined = `${normalizedQuestion} ${(normalizedOptions || []).join(' ')}`.trim();
  return /personalidad|personality|temperamento|caracter|introvert|extrovert|mbti|eneagrama|enneagram|big five/.test(
    joined
  );
}

function normalizeProfileType(value) {
  const type = String(value || '').toLowerCase();
  if (type === 'favorable' || type === 'intermedio' || type === 'desfavorable') {
    return type;
  }

  if (type === 'auto') {
    const roll = Math.random();
    if (roll < 0.6) {
      return 'favorable';
    }
    if (roll < 0.85) {
      return 'intermedio';
    }
    return 'desfavorable';
  }

  return 'favorable';
}

function pickLikertScoreByProfile(profileType) {
  const dominant = profileType === 'desfavorable' ? 2 : profileType === 'intermedio' ? 3 : 4;

  if (Math.random() < 0.8) {
    if (dominant === 4 && Math.random() < 0.35) {
      return 5;
    }
    if (dominant === 2 && Math.random() < 0.35) {
      return 1;
    }
    return dominant;
  }

  const delta = Math.random() < 0.5 ? -1 : 1;
  return clamp(dominant + delta, 1, 5);
}

function resolveLikertScore(value) {
  const text = normalizeForMatch(value);
  if (!text) {
    return 0;
  }

  if (/^[1-5]$/.test(text)) {
    return Number(text);
  }

  if (
    text.includes('totalmente en desacuerdo') ||
    text.includes('muy en desacuerdo') ||
    text.includes('strongly disagree')
  ) {
    return 1;
  }

  if (text === 'en desacuerdo' || text.includes('disagree')) {
    return 2;
  }

  if (
    text.includes('ni de acuerdo ni en desacuerdo') ||
    text.includes('ni en desacuerdo ni de acuerdo') ||
    text.includes('neutral')
  ) {
    return 3;
  }

  if (text === 'de acuerdo' || text.includes('agree')) {
    return 4;
  }

  if (
    text.includes('totalmente de acuerdo') ||
    text.includes('muy de acuerdo') ||
    text.includes('strongly agree')
  ) {
    return 5;
  }

  return 0;
}

function mapLikertScoreToTemplate(templateValue, score) {
  const normalized = normalizeForMatch(templateValue);

  if (/^[1-5]$/.test(normalized)) {
    return String(score);
  }

  if (normalized.includes('agree') || normalized.includes('disagree') || normalized.includes('neutral')) {
    return likertEnglishLabel(score);
  }

  if (
    normalized.includes('acuerdo') ||
    normalized.includes('desacuerdo') ||
    normalized.includes('neutral')
  ) {
    return likertSpanishLabel(score);
  }

  return templateValue;
}

function likertSpanishLabel(score) {
  const labels = {
    1: 'Totalmente en desacuerdo',
    2: 'En desacuerdo',
    3: 'Ni de acuerdo ni en desacuerdo',
    4: 'De acuerdo',
    5: 'Totalmente de acuerdo',
  };
  return labels[score] || labels[4];
}

function likertEnglishLabel(score) {
  const labels = {
    1: 'Strongly disagree',
    2: 'Disagree',
    3: 'Neutral',
    4: 'Agree',
    5: 'Strongly agree',
  };
  return labels[score] || labels[4];
}

function looksLikeGenderValue(value) {
  return /masculino|femenino|male|female|mujer|hombre|otro|other/i.test(String(value || ''));
}

function pickGenderValue(original) {
  const text = String(original || '');
  const malePattern = /masculino|male|hombre/i;
  const femalePattern = /femenino|female|mujer/i;
  const otherPattern = /otro|other|prefiero no/i;

  const roll = Math.random();
  if (roll < 0.48) {
    if (malePattern.test(text)) return text;
    return 'Masculino';
  }
  if (roll < 0.96) {
    if (femalePattern.test(text)) return text;
    return 'Femenino';
  }
  if (otherPattern.test(text)) {
    return text;
  }
  return 'Otro';
}

function looksLikeAgeValue(value) {
  const text = String(value || '');
  return /\bedad\b|\bage\b|\d{1,2}\s*-\s*\d{1,2}|\d{2,}/i.test(text);
}

function pickAgeLikeValue(original) {
  const text = String(original || '').trim();
  const rangeMatch = text.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
      const value = min + Math.floor(Math.random() * (max - min + 1));
      return String(value);
    }
  }

  if (/^\d{1,3}$/.test(text)) {
    const base = Number(text);
    return String(clamp(base + (Math.random() < 0.5 ? -1 : 1), 16, 80));
  }

  return text;
}

function shouldIncludePayloadField(key) {
  if (/^entry\.\d+$/.test(key)) {
    return true;
  }

  return /^(fvv|fbzx|partialResponse|pageHistory|draftResponse)$/i.test(key);
}

function randomToken(length) {
  return Math.random().toString(36).slice(2, 2 + length);
}

function inspectGoogleResponse(response) {
  const status = Number(response?.status || 0);
  const bodyRaw = String(response?.data || '');
  const body = normalizeForMatch(bodyRaw);
  const preview = summarizeHtmlBody(bodyRaw);

  if (
    body.includes('captcha') || body.includes('unusual traffic')
    || body.includes('trafico inusual') || body.includes('automated queries')
  ) {
    return {
      ok: false,
      uncertain: false,
      pause: true,
      code: 'provider_verification_required',
      message: 'Google solicito una verificacion manual; el trabajo fue pausado',
      preview: null,
    };
  }

  // Los chequeos de texto de mas abajo (restricciones conocidas, o Google
  // devolviendo la pagina del formulario en vez de una confirmacion) son
  // validos sin importar el status HTTP: antes se saltaban por completo
  // cuando Google respondia >=400, dejando solo el mensaje generico
  // "HTTP 400" — precisamente el caso real que motivo este cambio (un
  // formulario de 2 paginas donde Google rechazaba con 400 devolviendo la
  // pagina del formulario con el aviso "esta es una pregunta obligatoria",
  // que inferReturnedFormMessage ya sabe reconocer pero nunca llegaba a ver).
  if (
    body.includes('not accepting responses') ||
    body.includes('requires sign in') ||
    body.includes('sign in to continue') ||
    body.includes('inicia sesion para continuar') ||
    body.includes('can only be viewed by users in') ||
    body.includes('you can only submit one response') ||
    body.includes('only 1 response') ||
    body.includes('solo se permite una respuesta') ||
    body.includes('solo permite una respuesta') ||
    body.includes('ya no acepta respuestas') ||
    body.includes('ya has respondido') ||
    body.includes('ya respondiste') ||
    body.includes('inicia sesion')
  ) {
    return {
      ok: false,
      uncertain: false,
      fatal: true,
      code: body.includes('not accepting responses') || body.includes('ya no acepta respuestas')
        ? 'form_closed'
        : 'form_restriction',
      message: 'Rejected by Google Form restrictions',
      preview,
    };
  }

  if (body.includes('name="fbzx"') && body.includes('name="fvv"')) {
    const returnedMessage = inferReturnedFormMessage(body, preview);
    const structureChanged = /missing required answers|instead of confirmation/i.test(returnedMessage);
    return {
      ok: false,
      uncertain: false,
      fatal: true,
      code: structureChanged ? 'form_structure_changed' : 'form_restriction',
      message: `${returnedMessage}${status >= 400 ? ` (HTTP ${status})` : ''}`,
      preview,
    };
  }

  if (status >= 400) {
    return {
      ok: false,
      uncertain: false,
      retryable: status === 429 || status >= 500,
      pause: status === 429,
      fatal: status !== 429 && status < 500,
      code: status === 429 ? 'provider_rate_limited' : status >= 500 ? 'provider_unavailable' : 'provider_rejected',
      message: `HTTP ${status}`,
      preview,
    };
  }

  if (
    body.includes('your response has been recorded') ||
    body.includes('submit another response') ||
    body.includes('tu respuesta se ha registrado') ||
    body.includes('se registro tu respuesta') ||
    body.includes('se ha registrado tu respuesta') ||
    body.includes('respuesta registrada') ||
    body.includes('response received') ||
    body.includes('thanks for filling out')
  ) {
    return {
      ok: true,
      uncertain: false,
      message: `Accepted (HTTP ${status})`,
      preview,
    };
  }

  return {
    ok: true,
    uncertain: true,
    message: `Accepted with uncertain HTML check (HTTP ${status})`,
    preview,
  };
}

function inferReturnedFormMessage(body, preview) {
  const combined = normalizeForMatch(`${body || ''} ${preview || ''}`);

  if (
    combined.includes('this is a required question') ||
    combined.includes('esta es una pregunta obligatoria') ||
    combined.includes('pregunta obligatoria')
  ) {
    return 'Returned form page: missing required answers';
  }

  if (
    combined.includes('requires sign in') ||
    combined.includes('sign in to continue') ||
    combined.includes('inicia sesion') ||
    combined.includes('can only be viewed by users in')
  ) {
    return 'Returned form page: form requires sign in';
  }

  if (
    combined.includes('you can only submit one response') ||
    combined.includes('only 1 response') ||
    combined.includes('solo se permite una respuesta') ||
    combined.includes('solo permite una respuesta') ||
    combined.includes('ya has respondido') ||
    combined.includes('ya respondiste')
  ) {
    return 'Returned form page: only one response allowed';
  }

  return 'Returned form page instead of confirmation';
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function summarizeHtmlBody(value) {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, 240);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function validateSubmissionCount(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    return {
      ok: false,
      message: 'La cantidad de respuestas debe ser un entero positivo',
    };
  }
  if (TESISTAB_MAX_SUBMISSIONS_PER_JOB && numeric > TESISTAB_MAX_SUBMISSIONS_PER_JOB) {
    return {
      ok: false,
      message: `La cantidad supera el limite operativo de ${TESISTAB_MAX_SUBMISSIONS_PER_JOB}`,
    };
  }
  return { ok: true, value: numeric };
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized.length < 8 || normalized.length > 160 || !/^[a-zA-Z0-9_.:-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function findIdempotentJob(req, idempotencyKey) {
  if (!idempotencyKey) {
    return null;
  }
  return Object.values(tesistabJobStore).find(
    (job) => job.idempotencyKey === idempotencyKey && canAccessJob(req, job)
  ) || null;
}

function extractGoogleFormId(formUrl) {
  try {
    const match = new URL(formUrl).pathname.match(/\/forms\/d\/(?:e\/)?([^/]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function jobProgress(job) {
  const processed = Math.min(
    Number(job?.count || 0),
    Number(job?.sent || 0) + Number(job?.failed || 0)
  );
  const requested = Number(job?.count || 0);
  return {
    requested,
    processed,
    accepted: Math.max(0, Number(job?.accepted ?? (job?.sent - job?.uncertain)) || 0),
    failed: Math.max(0, Number(job?.failed) || 0),
    uncertain: Math.max(0, Number(job?.uncertain) || 0),
    pending: Math.max(0, requested - processed),
    percent: requested > 0 ? Math.round((processed / requested) * 10_000) / 100 : 0,
    batch: Number(job?.currentBatch || 0),
    totalBatches: Number(job?.totalBatches || 0),
  };
}

function isTerminalJobStatus(status) {
  return [
    'completed',
    'completed_with_errors',
    'cancelled',
    'failed',
  ].includes(status);
}

function buildJobCreationResponse(job, requestId, idempotentReplay) {
  return {
    requestId,
    id: job.id,
    status: job.status,
    idempotentReplay: Boolean(idempotentReplay),
    requested: job.requested ?? job.count,
    reserved: job.reserved ?? job.count,
    accepted: job.accepted ?? 0,
    refunded: job.refunded ?? 0,
    responsesLeft: job.responsesLeft ?? null,
    applied: {
      count: job.count,
      delayMs: job.delayMs,
      jitterMs: job.jitterMs,
      autoRandomizeText: Boolean(job.autoRandomizeText),
      batchSize: job.batchSize || TESISTAB_JOB_BATCH_SIZE,
      multiPageRoutes: Number(job.multiPage?.routeCount || 0),
    },
    warning: null,
  };
}

function compatFormStorageKey(req, formId) {
  const owner = jobOwnerEmail(req) || (req.tesistabPrivileged ? 'operator' : 'anonymous');
  return `${owner}:${String(formId || '')}`;
}

function pruneCompatForms() {
  const now = Date.now();
  for (const [key, value] of compatStoredForms.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      compatStoredForms.delete(key);
    }
  }

  if (compatStoredForms.size <= TESISTAB_MAX_COMPAT_FORMS) {
    return;
  }

  const oldest = [...compatStoredForms.entries()]
    .sort((a, b) => Number(a[1]?.expiresAt || 0) - Number(b[1]?.expiresAt || 0))
    .slice(0, compatStoredForms.size - TESISTAB_MAX_COMPAT_FORMS);
  oldest.forEach(([key]) => compatStoredForms.delete(key));
}

function randomJitter(maxJitterMs) {
  if (!maxJitterMs) {
    return 0;
  }

  return Math.floor(Math.random() * (maxJitterMs + 1));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message || `Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function scheduleTesistabJobCleanup(jobId) {
  if (!jobId || TESISTAB_FINISHED_JOB_TTL_MS <= 0) {
    return;
  }

  const existing = tesistabCleanupTimers.get(jobId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    tesistabCleanupTimers.delete(jobId);

    const job = tesistabJobStore[jobId];
    if (!job) {
      return;
    }

    if (['running', 'queued', 'paused', 'cancelling'].includes(job.status)) {
      return;
    }

    delete tesistabJobStore[jobId];
    tesistabSmartRuntimeStore.delete(jobId);
    tesistabQuotaRuntimeStore.delete(jobId);
    persistTesistabJobsSoon();
  }, TESISTAB_FINISHED_JOB_TTL_MS);

  tesistabCleanupTimers.set(jobId, timer);
}

function sendApiError(res, status, code, message, requestId, details = null) {
  res.status(status).json({
    requestId,
    code,
    message,
    ...(details?.field ? { field: details.field } : {}),
    retryable: details?.retryable ?? (status === 429 || status >= 500),
    error: {
      code,
      message,
      details,
    },
  });
}

// Validador inyectado por el proceso anfitrion (cuando forms se monta dentro
// de la API de TesisTab corren en el mismo proceso y se valida en memoria, sin
// HTTP ni cache). app.setKeyValidator(fn) lo configura.
let inProcessKeyValidator = null;
app.setKeyValidator = (fn) => {
  inProcessKeyValidator = typeof fn === 'function' ? fn : null;
};

// Contrato de cuota por respuesta. Los callbacks pueden ser sync o async y el
// anfitrion debe hacerlos idempotentes por reservationId/jobId:
// reserve(apiKey, requested, meta)
// settle(apiKey, reservationId, { accepted, failed, uncertain, cancelled, ... })
// release(apiKey, reservationId, meta)
let inProcessUsageManager = null;
app.setUsageManager = (manager) => {
  if (
    manager &&
    typeof manager.reserve === 'function' &&
    typeof manager.settle === 'function' &&
    typeof manager.release === 'function'
  ) {
    inProcessUsageManager = manager;
    return;
  }
  inProcessUsageManager = null;
};

// Observabilidad desacoplada: Forms no conoce la implementación de métricas
// del proceso anfitrión y nunca entrega cuerpos, URLs ni respuestas.
let inProcessMetricsObserver = null;
app.setMetricsObserver = (fn) => {
  inProcessMetricsObserver = typeof fn === 'function' ? fn : null;
};
const observeFormsEvent = (event, fields = {}) => {
  try {
    inProcessMetricsObserver?.(event, fields);
  } catch {
    // Una métrica nunca debe cambiar el resultado ni detener un trabajo.
  }
};

// Adaptador temporal del contrato anterior: consume una corrida completa al
// crear el trabajo. No puede liquidar respuestas individuales ni reembolsar.
let inProcessUsageConsumer = null;
app.setUsageConsumer = (fn) => {
  inProcessUsageConsumer = typeof fn === 'function' ? fn : null;
};

async function reserveTesistabResponses(req, requested, meta) {
  if (inProcessUsageManager && req.tesistabApiKey) {
    const result = await Promise.resolve(
      inProcessUsageManager.reserve(req.tesistabApiKey, requested, meta)
    );
    return {
      ...(result || {}),
      ok: Boolean(result?.ok),
      reserved: Number.isFinite(Number(result?.reserved)) ? Number(result.reserved) : requested,
      reservationId: result?.reservationId || meta.reservationId,
      mode: 'responses',
    };
  }

  if (inProcessUsageConsumer && req.tesistabApiKey) {
    const result = await Promise.resolve(inProcessUsageConsumer(req.tesistabApiKey));
    return {
      ...(result || {}),
      ok: Boolean(result?.ok),
      reserved: requested,
      reservationId: meta.reservationId,
      responsesLeft: result?.usesLeft ?? null,
      mode: 'legacy_run',
    };
  }

  return {
    ok: true,
    reserved: requested,
    reservationId: meta.reservationId,
    responsesLeft: null,
    mode: 'unlimited',
  };
}

async function releaseTesistabReservation(req, reservationId, meta) {
  if (!inProcessUsageManager || !req.tesistabApiKey || !reservationId) {
    return { ok: true, refunded: 0, mode: 'legacy_or_unlimited' };
  }

  return Promise.resolve(
    inProcessUsageManager.release(req.tesistabApiKey, reservationId, meta)
  );
}

async function settleTesistabJob(job) {
  const runtime = tesistabQuotaRuntimeStore.get(job.id) || {};
  const accepted = Math.max(0, Number(job.accepted ?? (job.sent - job.uncertain)) || 0);
  const uncertain = Math.max(0, Number(job.uncertain) || 0);
  const failed = Math.max(0, Number(job.failed) || 0);
  const processed = Math.min(job.count, Number(job.sent || 0) + failed);
  const cancelled = Math.max(0, Number(job.count || 0) - processed);
  const expectedRefund = failed + cancelled;

  job.accepted = accepted;
  job.pending = cancelled;
  job.settlementStatus = inProcessUsageManager ? 'settling' : 'legacy';

  if (!inProcessUsageManager
    || (!runtime.apiKey && !inProcessUsageManager.supportsCredentiallessSettlement)) {
    job.refunded = 0;
    job.settlementStatus = job.quotaMode === 'unlimited' ? 'not_required' : 'legacy_unavailable';
    return;
  }

  try {
    const result = await Promise.resolve(
      inProcessUsageManager.settle(runtime.apiKey || '', runtime.reservationId || job.reservationId, {
        jobId: job.id,
        requested: job.count,
        accepted,
        failed,
        uncertain,
        cancelled,
      })
    );
    if (!result?.ok) {
      throw new Error(result?.reason || 'quota_settlement_failed');
    }
    job.refunded = Number.isFinite(Number(result.refunded))
      ? Number(result.refunded)
      : expectedRefund;
    // En el job `reserved` significa lo que queda pendiente de reconciliar,
    // no el total reservado global de la cuenta.
    job.reserved = Number.isFinite(Number(result.reservedForJob))
      ? Number(result.reservedForJob)
      : uncertain;
    job.responsesLeft = result.responsesLeft ?? null;
    job.settlementStatus = uncertain > 0 ? 'reconciliation_pending' : 'settled';
    job.settlementError = null;
  } catch (error) {
    job.refunded = 0;
    job.settlementStatus = 'pending_retry';
    job.settlementError = error?.message || 'quota_settlement_failed';
  }
}

async function validateTesistabKey(apiKey) {
  if (inProcessKeyValidator) {
    return inProcessKeyValidator(apiKey);
  }
  const cached = tesistabKeyCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  let entry;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (SERVICE_SHARED_SECRET) {
      headers['X-Service-Secret'] = SERVICE_SHARED_SECRET;
    }
    const response = await fetch(`${TESISTAB_API_URL}/integrations/validate-key`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: apiKey }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      entry = { valid: false, reason: 'tesistab_no_disponible' };
    } else {
      entry = {
        valid: Boolean(body.valid),
        reason: body.reason || null,
        email: body.email || null,
        plan: body.plan || null,
        formsResponses: body.formsResponses ?? body.responsesLeft ?? null,
      };
    }
  } catch (error) {
    entry = { valid: false, reason: 'tesistab_no_disponible' };
  }

  // Las claves validas se cachean 5 min; los rechazos y errores, 1 min (para
  // que renovar la suscripcion o reintentar no tarde en reflejarse).
  entry.expiresAt = Date.now() + (entry.valid ? TESISTAB_KEY_CACHE_TTL_MS : 60_000);
  tesistabKeyCache.set(apiKey, entry);
  return entry;
}

function requireTesistabApiKey(req, res, next) {
  const apiKey =
    String(req.headers['x-api-key'] || '').trim() ||
    String(req.headers.authorization || '')
      .replace(/^Bearer\s+/i, '')
      .trim();

  // Llave maestra de desarrollo (opcional). Ve todos los jobs: es la clave del
  // operador del servicio, no la de un cliente.
  if (TESISTAB_API_KEY && apiKey === TESISTAB_API_KEY) {
    req.tesistabPrivileged = true;
    next();
    return;
  }

  // Modo legado (desarrollo/tests): comportamiento original del proyecto.
  if (!TESISTAB_VALIDATION_ENABLED) {
    if (!TESISTAB_API_KEY) {
      req.tesistabPrivileged = true;
      next();
      return;
    }
    sendApiError(res, 401, 'unauthorized', 'Missing or invalid API key', req.requestId);
    return;
  }

  if (!apiKey) {
    sendApiError(res, 401, 'unauthorized', 'Falta tu clave de API: generala en TesisTab > Integraciones', req.requestId);
    return;
  }
  if (!apiKey.startsWith('ttab_')) {
    sendApiError(res, 401, 'unauthorized', 'Clave invalida: usa la clave ttab_... de TesisTab > Integraciones', req.requestId);
    return;
  }

  validateTesistabKey(apiKey)
    .then((result) => {
      if (result.valid) {
        req.tesistabApiKey = apiKey;
        req.tesistabUser = {
          email: result.email,
          plan: result.plan,
          usesLeft: result.usesLeft !== undefined ? result.usesLeft : null,
          formsResponses:
            result.formsResponses !== undefined
              ? result.formsResponses
              : result.responsesLeft !== undefined
                ? result.responsesLeft
                : null,
        };
        next();
        return;
      }
      if (result.reason === 'tesistab_no_disponible') {
        sendApiError(res, 503, 'tesistab_unavailable', 'No se pudo validar tu clave (TesisTab no responde); intenta en unos segundos', req.requestId);
        return;
      }
      const message = result.reason === 'suscripcion_vencida'
        ? 'Tu suscripcion de TesisTab vencio: renueva tu plan para seguir usando el servicio'
        : 'Clave de API invalida o revocada: genera una nueva en TesisTab > Integraciones';
      sendApiError(res, 401, 'unauthorized', message, req.requestId);
    })
    .catch(() => {
      sendApiError(res, 503, 'tesistab_unavailable', 'Error validando tu clave; intenta de nuevo', req.requestId);
    });
}

function tesistabRateLimiter(req, res, next) {
  const now = Date.now();
  const routeKey = req.path.split('/').slice(0, 3).join('/');
  const clientKey = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${routeKey}`;
  const bucket = requestLimitStore.get(clientKey) || { startAt: now, count: 0 };

  if (now - bucket.startAt > TESISTAB_RATE_LIMIT_WINDOW_MS) {
    bucket.startAt = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  requestLimitStore.set(clientKey, bucket);

  if (bucket.count > TESISTAB_RATE_LIMIT_MAX_REQUESTS) {
    sendApiError(res, 429, 'rate_limited', 'Too many requests', req.requestId, {
      windowMs: TESISTAB_RATE_LIMIT_WINDOW_MS,
      maxRequests: TESISTAB_RATE_LIMIT_MAX_REQUESTS,
    });
    return;
  }

  next();
}

async function ensureJobRepositoryAvailable() {
  await jobRepositoryReady;
  if (process.env.NODE_ENV === 'production' && !inProcessJobRepository) {
    const error = new Error('Durable Forms job repository is not configured');
    error.statusCode = 503;
    error.code = 'job_repository_unavailable';
    throw error;
  }
}

async function createTesistabJobRecord(job, payload) {
  if (!inProcessJobRepository) {
    persistTesistabJobsSoon();
    return job;
  }
  const created = await Promise.resolve(
    inProcessJobRepository.create({ ...job }, {
      payload,
      workerId: TESISTAB_WORKER_ID,
      leaseMs: TESISTAB_JOB_LEASE_MS,
    })
  );
  const storedJob = created?.job || created;
  if (storedJob?.id) {
    if (storedJob.id !== job.id) delete tesistabJobStore[job.id];
    tesistabJobStore[storedJob.id] = { ...(storedJob.id === job.id ? job : {}), ...storedJob };
    return tesistabJobStore[storedJob.id];
  }
  return tesistabJobStore[job.id];
}

async function persistTesistabJob(job) {
  if (!job) return;
  if (!inProcessJobRepository) {
    persistTesistabJobsSoon();
    return;
  }
  // Las acciones del API (pausar/cancelar) son control-plane y no poseen el
  // lease del worker. Unicamente la instancia que reclamo el trabajo puede
  // renovar y escribir como worker. Esto evita que el API intente usar su
  // propio TESISTAB_WORKER_ID y deje la accion solo en memoria.
  const ownsLease = TESISTAB_EXECUTE_JOBS
    && job.leaseOwner === TESISTAB_WORKER_ID;
  if (!ownsLease && typeof inProcessJobRepository.control === 'function') {
    const terminal = isTerminalJobStatus(job.status);
    await Promise.resolve(inProcessJobRepository.control(job.id, {
      status: job.status,
      jobPatch: {
        pauseRequested: Boolean(job.pauseRequested),
        cancelRequested: Boolean(job.cancelRequested),
        resumeStatus: job.resumeStatus ?? null,
        recoverableError: job.recoverableError ?? null,
        updatedAt: job.updatedAt,
        ...(job.status === 'queued' && job.inFlightIndex == null ? {
          inFlightIndex: null,
          currentIndex: job.currentIndex,
          cursor: job.cursor,
          sent: job.sent,
          accepted: job.accepted,
          failed: job.failed,
          uncertain: job.uncertain,
          pending: job.pending,
        } : {}),
        ...(terminal ? {
          finishedAt: job.finishedAt,
          settlementStatus: job.settlementStatus,
          accepted: job.accepted,
          refunded: job.refunded,
          reserved: job.reserved,
          responsesLeft: job.responsesLeft,
          pending: job.pending,
        } : {}),
      },
    }));
    return;
  }
  const persisted = await Promise.resolve(
    inProcessJobRepository.update({ ...job }, {
      ...(ownsLease ? {
        workerId: TESISTAB_WORKER_ID,
        leaseMs: TESISTAB_JOB_LEASE_MS,
      } : {}),
    })
  );
  if (!persisted && ownsLease) {
    const error = new Error(`Lease perdido para el trabajo Forms ${job.id}`);
    error.code = 'lease_lost';
    error.retryable = true;
    throw error;
  }
}

async function getTesistabJob(id) {
  if (!inProcessJobRepository && tesistabJobStore[id]) {
    return tesistabJobStore[id];
  }
  if (!inProcessJobRepository) {
    return null;
  }
  await jobRepositoryReady;
  const result = await Promise.resolve(inProcessJobRepository.get(id));
  const job = result?.job || result || null;
  if (job?.id) {
    tesistabJobStore[job.id] = job;
  }
  return job;
}

async function refreshTesistabJobControl(job) {
  if (!inProcessJobRepository || !job?.id) return job;
  const stored = await Promise.resolve(inProcessJobRepository.get(job.id));
  const current = stored?.job || stored || null;
  if (!current) return job;
  job.pauseRequested = Boolean(current.pauseRequested || current.status === 'paused');
  job.cancelRequested = Boolean(
    current.cancelRequested || ['cancelling', 'cancelled'].includes(current.status)
  );
  return job;
}

async function listTesistabJobs(filters = {}) {
  if (!inProcessJobRepository) {
    return Object.values(tesistabJobStore);
  }
  await jobRepositoryReady;
  const result = await Promise.resolve(inProcessJobRepository.list(filters));
  const jobs = Array.isArray(result) ? result : Array.isArray(result?.jobs) ? result.jobs : [];
  jobs.forEach((job) => {
    if (job?.id) tesistabJobStore[job.id] = job;
  });
  return jobs;
}

async function hydrateJobsFromRepository() {
  try {
    const result = await Promise.resolve(
      inProcessJobRepository.list({ limit: TESISTAB_MAX_STORED_JOBS })
    );
    const jobs = Array.isArray(result) ? result : Array.isArray(result?.jobs) ? result.jobs : [];
    jobs.forEach((job) => {
      if (job?.id) tesistabJobStore[job.id] = job;
    });
  } catch (error) {
    console.error(`Failed to hydrate durable Forms jobs: ${error.message}`);
    throw error;
  }
}

function startJobClaimLoop() {
  if (jobClaimTimer || !inProcessJobRepository) {
    return;
  }
  const claim = () => claimDurableTesistabJobs().catch((error) => {
    console.error(`Failed to claim durable Forms jobs: ${error.message}`);
  });
  claim();
  jobClaimTimer = setInterval(claim, Math.max(1000, Math.floor(TESISTAB_JOB_LEASE_MS / 3)));
  jobClaimTimer.unref?.();
}

async function claimDurableTesistabJobs() {
  if (!inProcessJobRepository) return;
  for (let claimedCount = 0; claimedCount < 5; claimedCount++) {
    const claimed = await Promise.resolve(
      inProcessJobRepository.claim({
        workerId: TESISTAB_WORKER_ID,
        leaseMs: TESISTAB_JOB_LEASE_MS,
      })
    );
    const job = claimed?.job || null;
    if (!job?.id || !claimed?.payload) {
      return;
    }
    tesistabJobStore[job.id] = job;
    tesistabSmartRuntimeStore.set(
      job.id,
      buildSmartProfileRuntime(job.smartProfile || null, job.count)
    );
    tesistabQuotaRuntimeStore.set(job.id, {
      apiKey: claimed.apiKey || null,
      reservationId: job.reservationId || job.id,
    });
    runTesistabJob(job.id, claimed.payload).catch((error) => {
      failTesistabJob(job.id, error).catch((persistError) => {
        console.error(`Failed to persist claimed Forms job ${job.id}: ${persistError.message}`);
      });
    });
  }
}

function bootstrapTesistabStore() {
  if (!TESISTAB_PERSIST_JOBS) {
    return;
  }

  try {
    const parentDir = path.dirname(tesistabStorageFilePath);
    fs.mkdirSync(parentDir, { recursive: true });

    if (!fs.existsSync(tesistabStorageFilePath)) {
      return;
    }

    const raw = fs.readFileSync(tesistabStorageFilePath, 'utf8');
    if (!raw.trim()) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }

    parsed.forEach((job) => {
      if (!job || typeof job !== 'object' || !job.id) {
        return;
      }

      if (['running', 'queued', 'paused', 'cancelling'].includes(job.status)) {
        job.status = 'failed';
        job.failed = Number(job.failed || 0) + 1;
        job.updatedAt = new Date().toISOString();
        job.finishedAt = new Date().toISOString();
        job.latestResult = {
          at: Number(job.sent || 0) + Number(job.failed || 0),
          status: null,
          message: 'Recovered stale job after restart',
          preview: null,
        };
        job.settlementStatus = 'reconciliation_pending';
      }

      tesistabJobStore[job.id] = job;
      if (job.status !== 'running' && job.status !== 'queued') {
        scheduleTesistabJobCleanup(job.id);
      }
    });

    trimTesistabStoreIfNeeded();
    console.log(`Loaded ${Object.keys(tesistabJobStore).length} persisted TESISTAB jobs`);
  } catch (error) {
    console.warn(`Failed to load persisted TESISTAB jobs: ${error.message}`);
  }
}

function startTesistabWatchdog() {
  // unref(): este intervalo es mantenimiento en segundo plano, no una razon
  // para mantener vivo el proceso. El servidor real sigue vivo por el socket
  // de app.listen(); sin unref(), cualquier script que solo haga
  // require('./server.js') sin levantar el servidor (como un test unitario
  // de una funcion pura) se queda colgado para siempre esperando que el
  // proceso termine, aunque los tests ya hayan pasado.
  setInterval(() => {
    const now = Date.now();

    Object.values(tesistabJobStore).forEach((job) => {
      if (!job || job.status !== 'running') {
        return;
      }

      const updatedAtMs = Date.parse(job.updatedAt || job.createdAt || 0);
      if (!Number.isFinite(updatedAtMs)) {
        return;
      }

      // Entre intentos el job espera delayMs+jitter y la peticion puede tardar
      // hasta el timeout: el umbral de "colgado" debe superar ese ciclo
      // completo o el watchdog mataria jobs legitimos con delays largos.
      const expectedCycleMs =
        Number(job.delayMs || 0) + Number(job.jitterMs || 0) + TESISTAB_REQUEST_TIMEOUT_MS;
      if (now - updatedAtMs < expectedCycleMs + TESISTAB_STALE_JOB_AFTER_MS) {
        return;
      }

      job.status = 'completed_with_errors';
      job.failed = Number(job.failed || 0) + 1;
      job.updatedAt = new Date().toISOString();
      job.finishedAt = new Date().toISOString();
      job.latestResult = {
        at: Number(job.sent || 0) + Number(job.failed || 0),
        status: null,
        message: 'Job marked stale by watchdog timeout',
        preview: null,
      };

      job.errors = Array.isArray(job.errors) ? job.errors : [];
      job.errors.push({
        at: Number(job.sent || 0) + Number(job.failed || 0),
        message: 'Watchdog timeout while waiting Google response',
      });
      if (job.errors.length > 15) {
        job.errors.shift();
      }

      scheduleTesistabJobCleanup(job.id);
      persistTesistabJobsSoon();
    });
  }, 5000).unref();
}

function registerShutdownHooks() {
  const flush = () => {
    persistTesistabJobsNow();
  };

  // Montado dentro de la API no captura las senales: el proceso anfitrion
  // coordina el cierre. Standalone conserva un cierre directo y predecible.
  if (require.main === module) {
    process.once('SIGINT', () => {
      flush();
      process.exit(0);
    });
    process.once('SIGTERM', () => {
      flush();
      process.exit(0);
    });
  }
  process.once('beforeExit', flush);
}

function trimTesistabStoreIfNeeded() {
  const keys = Object.keys(tesistabJobStore);
  if (keys.length <= TESISTAB_MAX_STORED_JOBS) {
    return;
  }

  const jobsSorted = Object.values(tesistabJobStore).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const toKeep = new Set(jobsSorted.slice(0, TESISTAB_MAX_STORED_JOBS).map((job) => job.id));

  keys.forEach((id) => {
    if (!toKeep.has(id)) {
      delete tesistabJobStore[id];
      tesistabSmartRuntimeStore.delete(id);
      tesistabQuotaRuntimeStore.delete(id);
    }
  });
}

function persistTesistabJobsSoon() {
  if (inProcessJobRepository) {
    if (saveTesistabJobsTimer) {
      clearTimeout(saveTesistabJobsTimer);
    }
    saveTesistabJobsTimer = setTimeout(() => {
      saveTesistabJobsTimer = null;
      Promise.allSettled(
        Object.values(tesistabJobStore).map((job) => persistTesistabJob(job))
      ).then((results) => {
        const failed = results.filter((result) => result.status === 'rejected');
        if (failed.length) {
          console.error(`Failed to persist ${failed.length} durable Forms jobs`);
        }
      });
    }, 250);
    return;
  }
  if (!TESISTAB_PERSIST_JOBS) {
    return;
  }

  if (saveTesistabJobsTimer) {
    clearTimeout(saveTesistabJobsTimer);
  }

  saveTesistabJobsTimer = setTimeout(() => {
    saveTesistabJobsTimer = null;
    persistTesistabJobsNow();
  }, 250);
}

function persistTesistabJobsNow() {
  if (inProcessJobRepository || !TESISTAB_PERSIST_JOBS) {
    return;
  }
  try {
    const jobs = Object.values(tesistabJobStore)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, TESISTAB_MAX_STORED_JOBS);

    const parentDir = path.dirname(tesistabStorageFilePath);
    fs.mkdirSync(parentDir, { recursive: true });
    const temporaryPath = `${tesistabStorageFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(jobs, null, 2), 'utf8');
    fs.renameSync(temporaryPath, tesistabStorageFilePath);
  } catch (error) {
    console.warn(`Failed to persist TESISTAB jobs: ${error.message}`);
  }
}

// Los ids de job son UUID (randomUUID). Validarlo antes de escribirlo en la
// pagina cierra la inyeccion en origen: lo que no sea un UUID no llega nunca al
// HTML. Es una ruta publica y sin autenticacion, asi que era XSS reflejado
// directo (JSON.stringify no escapa la barra: un id con "</script>" cerraba el
// bloque y el resto se ejecutaba como HTML).
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/_submit', (req, res) => {
  const id = req.query.id;
  if (!id) {
    res.status(400).send('Missing job id');
    return;
  }
  if (typeof id !== 'string' || !JOB_ID_RE.test(id)) {
    res.status(400).type('text/plain').send('Invalid job id');
    return;
  }

  // Defensa en profundidad: nada de esta pagina debe cargar recursos externos
  // ni permitir scripts en linea que no sean el propio.
  res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  res.status(200).send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title> TESISTAB Result</title>
        <style>
          body { font-family: Segoe UI, sans-serif; padding: 24px; color: #0f172a; }
          .card { max-width: 720px; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; }
          .muted { color: #475569; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2> TESISTAB Run</h2>
          <p class="muted" id="line">Checking status...</p>
          <pre id="raw"></pre>
        </div>
        <script>
          const id = ${JSON.stringify(String(id))};
          async function tick() {
            try {
              const res = await fetch('/api/tesistab/jobs/' + id);
              if (!res.ok) {
                document.getElementById('line').textContent = 'Job not found';
                return;
              }
              const job = await res.json();
              document.getElementById('line').textContent =
                'Status: ' + job.status + ' | Sent: ' + job.sent + ' | Failed: ' + job.failed + ' | Uncertain: ' + job.uncertain;
              document.getElementById('raw').textContent = JSON.stringify(job.latestResult || {}, null, 2);
              if (['queued', 'running', 'paused', 'cancelling'].includes(job.status)) {
                setTimeout(tick, 1000);
              }
            } catch (err) {
              document.getElementById('line').textContent = 'Error loading status';
            }
          }
          tick();
        </script>
      </body>
    </html>
  `);
});

// Catch-all: este servicio es solo API + extension (la web vive en TesisTab).
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    sendApiError(res, 404, 'api_route_not_found', 'API route not found', req.requestId);
    return;
  }
  res
    .status(200)
    .type('text/plain')
    .send('Tutorica Forms: servicio para la extension de Chrome. Genera tu clave en TesisTab > Integraciones.');
});

app.use((err, req, res, next) => {
  console.error(`[${req.requestId}] Unhandled server error`, err);
  sendApiError(res, 500, 'internal_error', 'Unexpected server error', req.requestId);
});

// Cuando se ejecuta directamente (standalone/dev/tests) levanta su propio
// servidor; cuando se importa (montado en la API de TesisTab) solo exporta app.
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log('Tutorica Forms escuchando en el puerto', PORT);
  });
}

// Se cuelgan como propiedades de `app` (en vez de cambiar la forma de
// module.exports) porque node_app/server.js hace
// `const formsApp = require("../forms/server.js")` y usa formsApp COMO la
// app de Express directamente (montada en el mismo proceso) — cambiar el
// export a un objeto rompería esa integracion en produccion. Solo para tests.
app.inspectGoogleResponse = inspectGoogleResponse;
app.inferReturnedFormMessage = inferReturnedFormMessage;
app.sanitizeMultiPageConfig = sanitizeMultiPageConfig;
app.buildRoutedAttemptPayload = buildRoutedAttemptPayload;
app.parseRetryAfterMs = parseRetryAfterMs;
app.computeProviderBackoffMs = computeProviderBackoffMs;
app.retryProviderSubmission = retryProviderSubmission;

module.exports = app;
