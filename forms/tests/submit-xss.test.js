const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { after, before, describe, test } = require('node:test');

// XSS reflejado en /_submit.
//
// La pagina interpolaba req.query.id dentro de un bloque <script> usando
// JSON.stringify, que NO escapa la barra: un id que contenga "</script>" cierra
// el bloque y lo que sigue se interpreta como HTML. La ruta es publica (no pasa
// por el middleware de clave), asi que cualquiera podia ejecutar JavaScript en
// el origen de la API.
//
// Los ids de job son UUID; validarlo cierra la inyeccion en origen.

const SERVER_START_TIMEOUT_MS = 15000;
const CARGA = '</script><img src=x onerror=alert(1)>';

describe('/_submit no refleja HTML del parametro id', () => {
  let server;

  before(async () => {
    server = await startServer({ TESISTAB_VALIDATION: 'off', TESISTAB_PERSIST_JOBS: 'false' });
  });

  after(async () => { await stopServer(server); });

  test('rechaza un id que no es UUID', async () => {
    const res = await fetch(`${server.baseUrl}/_submit?id=${encodeURIComponent(CARGA)}`);
    const cuerpo = await res.text();

    assert.equal(res.status, 400);
    // Lo esencial: la carga no aparece en la respuesta bajo ninguna forma.
    assert.ok(!cuerpo.includes('</script><img'), 'la carga se reflejo en la respuesta');
    assert.ok(!cuerpo.includes('onerror'), 'la carga se reflejo en la respuesta');
  });

  test('rechaza tambien un id casi-UUID', async () => {
    const res = await fetch(`${server.baseUrl}/_submit?id=not-a-uuid-at-all`);
    assert.equal(res.status, 400);
  });

  test('sigue sirviendo la pagina con un UUID valido', async () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    const res = await fetch(`${server.baseUrl}/_submit?id=${uuid}`);
    const cuerpo = await res.text();

    assert.equal(res.status, 200);
    assert.ok(cuerpo.includes(uuid), 'la pagina deberia seguir usando el id');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('content-security-policy'));
  });
});

function startServer(extraEnv = {}) {
  const port = 6600 + Math.floor(Math.random() * 300);
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
