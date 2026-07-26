const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { after, before, describe, test } = require('node:test');

// Aislamiento entre cuentas de los jobs de Forms.
//
// Los jobs vivian en un unico almacen en memoria sin dueno: cualquier cliente
// con una clave ttab_ valida leia las corridas de todos los demas (URL del
// formulario, etiqueta y resultado) y podia cancelarlas o borrar el historial
// completo del servicio. Estas pruebas fijan que cada cuenta solo ve lo suyo.

const SERVER_START_TIMEOUT_MS = 15000;
const CLAVE_ANA = 'ttab_ana';
const CLAVE_BRUNO = 'ttab_bruno';
const FORM_URL = 'https://docs.google.com/forms/d/e/test-form/formResponse';

describe('aislamiento de jobs entre cuentas', () => {
  let validador;
  let server;
  let jobDeAna;

  before(async () => {
    // TesisTab falso: cada clave pertenece a una cuenta distinta.
    validador = await startValidador({
      [CLAVE_ANA]: 'ana@uni.edu',
      [CLAVE_BRUNO]: 'bruno@uni.edu',
    });
    server = await startServer({
      TESISTAB_VALIDATION: 'on',
      TESISTAB_API_URL: validador.baseUrl,
      TESISTAB_PERSIST_JOBS: 'false',
      TESISTAB_MAX_SUBMISSIONS_PER_JOB: '3',
    });

    const creado = await crearJob(server.baseUrl, CLAVE_ANA, 'instrumento de ana');
    assert.equal(creado.status, 202, `no se creo la corrida: ${JSON.stringify(creado.body)}`);
    jobDeAna = creado.body.id;
    assert.ok(jobDeAna, 'la corrida de Ana deberia haberse creado');
  });

  after(async () => {
    await stopServer(server);
    await new Promise((resolve) => validador.server.close(resolve));
  });

  test('Bruno no puede leer la corrida de Ana', async () => {
    const respuesta = await fetchJson(`${server.baseUrl}/api/tesistab/jobs/${jobDeAna}`, {
      headers: { 'X-API-Key': CLAVE_BRUNO },
    });
    assert.equal(respuesta.status, 404);
    assert.equal(respuesta.body.error.code, 'job_not_found');
  });

  test('Ana si puede leer la suya', async () => {
    const respuesta = await fetchJson(`${server.baseUrl}/api/tesistab/jobs/${jobDeAna}`, {
      headers: { 'X-API-Key': CLAVE_ANA },
    });
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.label, 'instrumento de ana');
  });

  test('el listado de Bruno no incluye las corridas de Ana', async () => {
    const respuesta = await fetchJson(`${server.baseUrl}/api/tesistab/jobs`, {
      headers: { 'X-API-Key': CLAVE_BRUNO },
    });
    assert.equal(respuesta.status, 200);
    assert.deepEqual(respuesta.body.jobs, []);
    // El total tambien es el propio: revelarlo diria cuantas corridas tienen
    // los demas.
    assert.equal(respuesta.body.totalStored, 0);
  });

  test('el listado de Ana incluye la suya', async () => {
    const respuesta = await fetchJson(`${server.baseUrl}/api/tesistab/jobs`, {
      headers: { 'X-API-Key': CLAVE_ANA },
    });
    assert.equal(respuesta.body.jobs.length, 1);
    assert.equal(respuesta.body.jobs[0].id, jobDeAna);
  });

  test('Bruno no puede cancelar la corrida de Ana', async () => {
    const respuesta = await fetchJson(`${server.baseUrl}/api/tesistab/jobs/${jobDeAna}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': CLAVE_BRUNO },
    });
    assert.equal(respuesta.status, 404);

    const sigueViva = await fetchJson(`${server.baseUrl}/api/tesistab/jobs/${jobDeAna}`, {
      headers: { 'X-API-Key': CLAVE_ANA },
    });
    assert.equal(sigueViva.status, 200);
    assert.notEqual(sigueViva.body.status, 'cancelled');
  });

  test('el borrado masivo de Bruno no toca el historial de Ana', async () => {
    const borrado = await fetchJson(`${server.baseUrl}/api/tesistab/jobs`, {
      method: 'DELETE',
      headers: { 'X-API-Key': CLAVE_BRUNO },
    });
    assert.equal(borrado.status, 200);
    assert.equal(borrado.body.removed, 0);

    const deAna = await fetchJson(`${server.baseUrl}/api/tesistab/jobs`, {
      headers: { 'X-API-Key': CLAVE_ANA },
    });
    assert.equal(deAna.body.jobs.length, 1, 'Ana deberia conservar su corrida');
  });

  test('Ana si puede borrar su propio historial', async () => {
    const borrado = await fetchJson(`${server.baseUrl}/api/tesistab/jobs`, {
      method: 'DELETE',
      headers: { 'X-API-Key': CLAVE_ANA },
    });
    assert.equal(borrado.body.removed, 1);

    const despues = await fetchJson(`${server.baseUrl}/api/tesistab/jobs`, {
      headers: { 'X-API-Key': CLAVE_ANA },
    });
    assert.equal(despues.body.jobs.length, 0);
  });
});

function crearJob(baseUrl, apiKey, label) {
  return fetchJson(`${baseUrl}/api/tesistab/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      formUrl: FORM_URL,
      payload: { 'entry.1': 'x', fvv: '1', fbzx: 'token' },
      count: 1,
      delayMs: 700,
      jitterMs: 0,
      label,
    }),
  });
}

// TesisTab falso: responde /integrations/validate-key mapeando clave -> correo.
function startValidador(claves) {
  const server = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      let key = null;
      try { key = JSON.parse(cuerpo).key; } catch { key = null; }
      const email = claves[key];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(email
        ? { valid: true, email, plan: 'test' }
        : { valid: false, reason: 'clave_invalida' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function startServer(extraEnv = {}) {
  const port = 6100 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname + '/..',
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (c) => { logs += c.toString(); });
  child.stderr.on('data', (c) => { logs += c.toString(); });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Server start timeout. Logs:\n${logs}`));
    }, SERVER_START_TIMEOUT_MS);

    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}. Logs:\n${logs}`));
    });
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('escuchando en el puerto')) {
        clearTimeout(timeout);
        resolve({ child, baseUrl: `http://localhost:${port}` });
      }
    });
  });
}

function stopServer(server) {
  if (!server?.child) return Promise.resolve();
  return new Promise((resolve) => {
    server.child.once('exit', () => resolve());
    server.child.kill();
    setTimeout(resolve, 5000).unref?.();
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}
