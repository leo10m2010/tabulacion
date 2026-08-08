// inspectGoogleResponse clasifica lo que Google Forms responde a un POST
// directo a /formResponse. Reportado en vivo: un formulario de 2 paginas
// devolvia "HTTP 400" a secas sin ninguna pista de por que, porque los
// chequeos de texto (restricciones conocidas, o Google devolviendo la pagina
// del formulario en vez de una confirmacion) solo corrian para status < 400
// — exactamente el caso real, donde Google respondio 400 Y devolvio la
// pagina del formulario con el aviso de pregunta obligatoria sin responder.
const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const app = require('../server.js');

const {
  inspectGoogleResponse,
  parseRetryAfterMs,
  computeProviderBackoffMs,
  retryProviderSubmission,
} = app;

const paginaFormularioConAviso = (aviso) => `
  <html><head><title>Encuesta de ejemplo</title>
  <style>.iPj4P { background-color: #5746e3 !important; }</style>
  <script>var DOCS_timing={}; DOCS_timing['pls']=new Date().getTime();</script>
  </head><body>
  <form>
    <input type="hidden" name="fbzx" value="123456789">
    <input type="hidden" name="fvv" value="1">
    <div>${aviso}</div>
  </form>
  </body></html>
`;

describe('inspectGoogleResponse — clasificacion de fallos HTTP >=400', () => {
  test('HTTP 400 con la pagina del formulario y aviso de obligatoria da un mensaje especifico, no "HTTP 400" a secas', () => {
    const body = paginaFormularioConAviso('Esta es una pregunta obligatoria');
    const r = inspectGoogleResponse({ status: 400, data: body });
    assert.equal(r.ok, false);
    assert.match(r.message, /missing required answers/i);
    assert.match(r.message, /HTTP 400/);
  });

  test('HTTP 400 con la pagina del formulario en ingles tambien se reconoce', () => {
    const body = paginaFormularioConAviso('This is a required question');
    const r = inspectGoogleResponse({ status: 400, data: body });
    assert.match(r.message, /missing required answers/i);
  });

  test('HTTP 400 sin marcas reconocibles sigue devolviendo el generico, pero con el preview del cuerpo', () => {
    const r = inspectGoogleResponse({ status: 400, data: '<html><body>Bad Request</body></html>' });
    assert.equal(r.ok, false);
    assert.equal(r.message, 'HTTP 400');
    assert.match(r.preview, /Bad Request/);
  });

  test('un texto de restriccion conocida se detecta aunque el status sea >=400', () => {
    const r = inspectGoogleResponse({ status: 400, data: 'Sorry, this form is not accepting responses right now.' });
    assert.equal(r.ok, false);
    assert.equal(r.fatal, true);
    assert.equal(r.code, 'form_closed');
    assert.equal(r.message, 'Rejected by Google Form restrictions');
  });

  test('CAPTCHA y trafico inusual pausan sin intentar evadir la verificacion', () => {
    const captcha = inspectGoogleResponse({ status: 200, data: '<h1>CAPTCHA</h1> unusual traffic' });
    assert.equal(captcha.ok, false);
    assert.equal(captcha.pause, true);
    assert.equal(captcha.code, 'provider_verification_required');
  });

  test('una pagina devuelta con una obligatoria nueva diagnostica cambio de estructura', () => {
    const result = inspectGoogleResponse({
      status: 400,
      data: paginaFormularioConAviso('Esta es una pregunta obligatoria'),
    });
    assert.equal(result.fatal, true);
    assert.equal(result.code, 'form_structure_changed');
  });

  test('429 pausa tras reintentos y 5xx se marca como temporal', () => {
    const limited = inspectGoogleResponse({ status: 429, data: 'Too many requests' });
    assert.equal(limited.retryable, true);
    assert.equal(limited.pause, true);
    assert.equal(limited.code, 'provider_rate_limited');

    const unavailable = inspectGoogleResponse({ status: 503, data: 'Unavailable' });
    assert.equal(unavailable.retryable, true);
    assert.equal(unavailable.pause, false);
    assert.equal(unavailable.code, 'provider_unavailable');
  });

  test('sigue funcionando igual que antes cuando el status es 200 (regresion)', () => {
    const aceptado = inspectGoogleResponse({ status: 200, data: 'Your response has been recorded.' });
    assert.equal(aceptado.ok, true);

    const paginaDevuelta = inspectGoogleResponse({
      status: 200,
      data: paginaFormularioConAviso('Esta es una pregunta obligatoria'),
    });
    assert.equal(paginaDevuelta.ok, false);
    assert.match(paginaDevuelta.message, /missing required answers/i);
    assert.doesNotMatch(paginaDevuelta.message, /HTTP 200/);
  });
});

describe('Retry-After y backoff sin esperas reales', () => {
  test('interpreta segundos y fechas HTTP, y limita el backoff exponencial', () => {
    assert.equal(parseRetryAfterMs('2.5'), 2500);
    const future = new Date(Date.now() + 4_000).toUTCString();
    assert.ok(parseRetryAfterMs(future) >= 2_500);
    assert.equal(computeProviderBackoffMs({ retryAfterMs: 7_000 }, 0), 7_000);
    assert.equal(computeProviderBackoffMs({}, 0), 750);
    assert.equal(computeProviderBackoffMs({}, 10), 30_000);
  });

  test('respeta Retry-After, aplica backoff a 5xx y termina al recibir confirmacion', async () => {
    const responses = [
      { status: 429, data: 'Too many requests', retryAfterMs: 2_000 },
      { status: 503, data: 'Unavailable', retryAfterMs: null },
      { status: 200, data: 'Your response has been recorded.' },
    ];
    const waits = [];
    let persisted = 0;
    const job = { formUrl: 'https://docs.google.com/forms/d/e/test/formResponse' };
    const result = await retryProviderSubmission(job, 'entry.1=x', {
      retries: 3,
      send: async () => responses.shift(),
      sleep: async (ms) => { waits.push(ms); },
      persist: async () => { persisted += 1; },
    });
    assert.equal(result.inspection.ok, true);
    assert.deepEqual(waits, [2_000, 1_500]);
    assert.equal(job.retryAttempts, 2);
    assert.equal(persisted, 2);
  });
});
