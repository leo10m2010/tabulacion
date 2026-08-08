const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { after, before, describe, test } = require('node:test');

const SERVER_START_TIMEOUT_MS = 15000;
const SERVER_STOP_TIMEOUT_MS = 7000;

function assertPublicJobHasNoExecutionSecrets(job) {
  for (const key of [
    'payload', 'parameters', 'formUrl', 'ownerEmail', 'reservationId',
    'idempotencyKey', 'leaseOwner', 'leaseExpiresAt', 'uncertainDeliveries',
    'smartProfile', 'recentAppliedRules',
  ]) {
    assert.equal(Object.hasOwn(job, key), false, `campo interno filtrado: ${key}`);
  }
  const serialized = JSON.stringify(job);
  assert.doesNotMatch(serialized, /pageHistory|draftResponse|partialResponse|fbzx/);
}

describe('TESISTAB API regression (no API key)', () => {
  let server;

  before(async () => {
    server = await startServer({
      TESISTAB_VALIDATION: 'off',
      TESISTAB_MAX_SUBMISSIONS_PER_JOB: '3',
      TESISTAB_PERSIST_JOBS: 'false',
    });
  });

  after(async () => {
    await stopServer(server);
  });

  test('GET /api/tesistab/config returns limits and request id', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/tesistab/config`);

    assert.equal(response.status, 200);
    assert.ok(response.body.requestId);
    assert.equal(response.body.limits.maxSubmissionsPerJob, 3);
    assert.ok(Array.isArray(response.body.allowedHosts));
  });

  test('POST /api/tesistab/submit rejects invalid payload with structured error', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/tesistab/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: { 'entry.1': 'hello' },
        count: 1,
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'invalid_form_url');
    assert.ok(response.body.requestId);
  });

  test('POST /api/tesistab/submit creates job and job is queryable', async () => {
    const createResponse = await fetchJson(`${server.baseUrl}/api/tesistab/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formUrl: 'https://docs.google.com/forms/d/e/test-form/formResponse',
        payload: {
          'entry.1': 'tesistab regression',
          fvv: '1',
          fbzx: 'test-token',
        },
        count: 1,
        ownOrAuthorized: true,
        delayMs: 700,
        jitterMs: 0,
        label: 'tesistab-api-test',
      }),
    });

    assert.equal(createResponse.status, 202);
    assert.ok(createResponse.body.id);
    assert.equal(createResponse.body.applied.count, 1);

    const jobId = createResponse.body.id;
    const getResponse = await fetchJson(`${server.baseUrl}/api/tesistab/jobs/${jobId}`);
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.id, jobId);
    assert.ok(getResponse.body.requestId);
    assert.equal(getResponse.body.label, 'tesistab-api-test');
  });

  test('GET /api/tesistab/jobs exposes totals and filter metadata', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/tesistab/jobs?limit=10&status=running`);

    assert.equal(response.status, 200);
    assert.ok(response.body.requestId);
    assert.equal(response.body.appliedFilters.limit, 10);
    assert.equal(response.body.appliedFilters.status, 'running');
    assert.equal(typeof response.body.totalStored, 'number');
    assert.equal(typeof response.body.totals, 'object');
    assert.ok(Array.isArray(response.body.jobs));
  });
});

describe('TESISTAB API key protection', () => {
  let server;
  const apiKey = 'tesistab-local-test-key';

  before(async () => {
    server = await startServer({
      TESISTAB_VALIDATION: 'off',
      TESISTAB_API_KEY: apiKey,
      TESISTAB_PERSIST_JOBS: 'false',
    });
  });

  after(async () => {
    await stopServer(server);
  });

  test('rejects requests without API key', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/tesistab/config`);

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'unauthorized');
    assert.ok(response.body.requestId);
  });

  test('accepts requests with API key', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/tesistab/config`, {
      headers: {
        'X-API-Key': apiKey,
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.protection.apiKeyRequired, true);
    assert.ok(response.body.requestId);
  });
});

describe('TESISTAB Forms por respuestas y controles de job', () => {
  let server;

  before(async () => {
    server = await startServer({
      TESISTAB_VALIDATION: 'off',
      TESISTAB_PERSIST_JOBS: 'false',
      TESISTAB_MAX_SUBMISSIONS_PER_JOB: '',
      TESISTAB_MIN_DELAY_MS: '1',
      TESISTAB_REQUEST_TIMEOUT_MS: '100',
      TESISTAB_RUN_JOBS_INLINE: 'false',
      LEGACY_API_SUNSET_AT: '2026-09-15T00:00:00Z',
    });
  });

  after(async () => {
    await stopServer(server);
  });

  test('no impone 250 y divide un trabajo grande en lotes de 100', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/tesistab/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formUrl: 'https://docs.google.com/forms/d/e/test-form/formResponse',
        payload: { 'entry.1': 'x', fvv: '1', fbzx: 'test-token' },
        count: 1200,
        ownOrAuthorized: true,
        idempotencyKey: 'test-large-job-1200',
        delayMs: 1,
      }),
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.requested, 1200);
    assert.equal(response.body.reserved, 1200);
    assert.equal(response.body.applied.count, 1200);
    assert.equal(response.body.applied.batchSize, 100);

    const job = await fetchJson(`${server.baseUrl}/api/tesistab/jobs/${response.body.id}`);
    assert.equal(job.body.totalBatches, 12);
    assert.equal(job.body.progress.requested, 1200);

    const paused = await fetchJson(
      `${server.baseUrl}/api/tesistab/jobs/${response.body.id}/pause`,
      { method: 'POST' }
    );
    assert.equal(paused.status, 200);
    assert.equal(paused.body.status, 'paused');

    const resumed = await fetchJson(
      `${server.baseUrl}/api/tesistab/jobs/${response.body.id}/resume`,
      { method: 'POST' }
    );
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.status, 'queued');

    const cancelled = await fetchJson(
      `${server.baseUrl}/api/tesistab/jobs/${response.body.id}/cancel`,
      { method: 'POST' }
    );
    assert.equal(cancelled.status, 202);
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(cancelled.body.progress.pending, 1200);
  });

  test('contrato /api/forms/jobs acepta requestedResponses, config y structureHash', async () => {
    const structureHash = 'a'.repeat(64);
    const response = await fetchJson(`${server.baseUrl}/api/forms/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formUrl: 'https://docs.google.com/forms/d/e/canonical-form/formResponse',
        requestedResponses: 7,
        config: {
          payload: { 'entry.1': 'x', fvv: '1' },
          delayMs: 5,
          jitterMs: 2,
          label: 'canonical-contract',
        },
        structureHash,
        ownOrAuthorized: true,
        idempotencyKey: 'canonical-job-contract-1',
      }),
    });
    assert.equal(response.status, 202);
    assert.equal(response.body.requested, 7);
    assert.equal(response.body.applied.count, 7);

    const job = await fetchJson(`${server.baseUrl}/api/forms/jobs/${response.body.id}`);
    assert.equal(job.status, 200);
    assert.equal(job.body.structureHash, structureHash);
    assert.equal(job.body.label, 'canonical-contract');
    assert.equal(job.body.formId, 'canonical-form');
    assert.equal(job.body.authorizationConfirmed, true);
    assertPublicJobHasNoExecutionSecrets(job.body);

    const list = await fetchJson(`${server.baseUrl}/api/forms/jobs`);
    const listedJob = list.body.jobs.find((item) => item.id === response.body.id);
    assert.ok(listedJob, 'el trabajo aparece en el listado');
    assertPublicJobHasNoExecutionSecrets(listedJob);
  });

  test('contrato /api/forms/jobs acepta rutas condicionales sanitizadas', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/forms/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formUrl: 'https://docs.google.com/forms/d/e/routed-form/formResponse',
        requestedResponses: 4,
        config: {
          payload: { 'entry.1': 'A', fvv: '1' },
          multiPage: {
            version: 1,
            guidedCapture: true,
            routes: [
              {
                id: 'route-a',
                fallback: true,
                when: { all: [{ field: 'entry.1', operator: 'equals', value: 'A' }] },
                payload: { 'entry.1': 'A', 'entry.2': 'solo A', fvv: '1', pageHistory: '0,1' },
                pages: [{ pageKey: 'root', entries: ['entry.1'] }, { pageKey: 'a', entries: ['entry.2'] }],
              },
              {
                id: 'route-b',
                when: { all: [{ field: 'entry.1', operator: 'equals', value: 'B' }] },
                payload: { 'entry.1': 'B', 'entry.3': 'solo B', fvv: '1', pageHistory: '0,2' },
                pages: [{ pageKey: 'root', entries: ['entry.1'] }, { pageKey: 'b', entries: ['entry.3'] }],
              },
            ],
          },
        },
        ownOrAuthorized: true,
        idempotencyKey: 'canonical-routed-job-1',
      }),
    });
    assert.equal(response.status, 202);
    assert.equal(response.body.applied.multiPageRoutes, 2);
    const job = await fetchJson(`${server.baseUrl}/api/forms/jobs/${response.body.id}`);
    assert.equal(job.body.multiPage.routeCount, 2);
    assert.deepEqual(job.body.multiPage.selectorEntries, ['entry.1']);
    assert.equal(job.body.multiPage.routes, undefined, 'GET no debe exponer payloads capturados');
    assertPublicJobHasNoExecutionSecrets(job.body);
    assert.doesNotMatch(JSON.stringify(job.body), /solo A|solo B|0,1|0,2/);

    const list = await fetchJson(`${server.baseUrl}/api/forms/jobs`);
    const listedJob = list.body.jobs.find((item) => item.id === response.body.id);
    assert.ok(listedJob, 'la ruta aparece en el listado sin datos de ejecucion');
    assertPublicJobHasNoExecutionSecrets(listedJob);
    assert.doesNotMatch(JSON.stringify(listedJob), /solo A|solo B|0,1|0,2/);
  });

  test('rechaza rutas condicionales con campos no permitidos', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/forms/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formUrl: 'https://docs.google.com/forms/d/e/routed-form/formResponse',
        requestedResponses: 1,
        config: {
          payload: { 'entry.1': 'A' },
          multiPage: {
            routes: [{
              id: 'unsafe',
              payload: { 'entry.1': 'A', callbackUrl: 'https://example.test' },
              when: { all: [] },
            }],
          },
        },
        ownOrAuthorized: true,
      }),
    });
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'invalid_multi_page');
    assert.match(response.body.field, /callbackUrl/);
  });

  test('exige confirmar que el formulario es propio o autorizado', async () => {
    const response = await fetchJson(`${server.baseUrl}/api/tesistab/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formUrl: 'https://docs.google.com/forms/d/e/test-form/formResponse',
        payload: { 'entry.1': 'x' },
        count: 1,
      }),
    });
    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'authorization_required');
  });

  test('adaptador legado anuncia deprecacion y Sunset configurable', async () => {
    const response = await fetch(`${server.baseUrl}/api/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId: 'legacy-header-test' }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('deprecation'), 'true');
    assert.equal(response.headers.get('sunset'), 'Tue, 15 Sep 2026 00:00:00 GMT');
  });
});

function pickPort() {
  return 5600 + Math.floor(Math.random() * 500);
}

function startServer(extraEnv = {}) {
  const port = pickPort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
      PORT: String(port),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  const onData = (chunk) => {
    logs += chunk.toString();
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Server start timeout. Logs:\n${logs}`));
    }, SERVER_START_TIMEOUT_MS);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}. Logs:\n${logs}`));
    });

    child.stdout.on('data', (chunk) => {
      const line = chunk.toString();
      if (line.includes('"event":"forms.service_started"')) {
        clearTimeout(timeout);
        resolve({
          child,
          baseUrl: `http://localhost:${port}`,
        });
      }
    });
  });
}

function stopServer(server) {
  if (!server?.child || server.child.killed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        server.child.kill('SIGKILL');
      } catch (error) {
        // ignore
      }
      resolve();
    }, SERVER_STOP_TIMEOUT_MS);

    server.child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      server.child.kill('SIGTERM');
    } catch (error) {
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await safeJson(response);
  return {
    status: response.status,
    body,
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}
