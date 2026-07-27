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

const { inspectGoogleResponse } = app;

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
    assert.equal(r.message, 'Rejected by Google Form restrictions');
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
