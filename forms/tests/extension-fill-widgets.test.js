// Reportado en vivo: el auto-relleno de la extension ("Iniciar") mandaba
// preguntas sin responder en formularios reales de Google, sin avisar. La
// causa: Google Forms tiene AL MENOS tres formas distintas de representar la
// misma pregunta de opcion multiple en el DOM, y content.js solo sabia leer
// la mas antigua (input nativo con name="entry.X"). Esta prueba carga el
// content.js REAL (sin copiar/pegar nada, para que no se desincronice) en un
// DOM simulado que reproduce las otras dos variantes encontradas en un
// formulario real, y confirma que collectEntryGroups/fillEntryGroup las
// completa de verdad.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, describe } = require('node:test');
const { JSDOM } = require('jsdom');

const CONTENT_JS_PATH = path.join(
  __dirname, '..', 'tutorica-chrome-extension', 'content', 'content.js'
);
const contentJsSource = fs.readFileSync(CONTENT_JS_PATH, 'utf8');

// Estructura de DOM tomada de un formulario real (Marketing Verde... MYPES
// agroindustriales de Huanuco), inspeccionado en vivo con el navegador:
//
//   Caso A ("Genero"): el input oculto entry.X YA existe en el DOM, vacio.
//     El control visible es un <label> SIN ningun input nativo adentro.
//   Caso B (las 24 preguntas Likert de la ultima pagina): el input oculto
//     entry.X NO EXISTE todavia — lo unico presente es su "_sentinel".
//     Google lo crea recien cuando detecta el primer click real.
//   Caso C (control): una pregunta con <input type="radio"> nativo de toda
//     la vida, para confirmar que ese camino no se rompio.
// El heading va DENTRO del mismo contenedor .geS5n que las opciones y el
// input oculto (no como hermano suelto): asi es como esta anidado en el DOM
// real (confirmado con el navegador, escalando desde el input oculto hacia
// arriba). collectEntryGroups resuelve el contenedor de la pregunta con
// closest() desde el input oculto — si el heading quedara AFUERA de ese
// contenedor, extractQuestionText no lo encontraria aunque la pregunta se
// rellene bien, y el mensaje de aviso mostraria el entry.X en vez del texto
// real de la pregunta.
const MOCK_FORM_HTML = `
  <form id="mockForm" action="https://example.test/formResponse">
    <div role="listitem" class="Qr7Oae" id="q-genero">
      <div class="geS5n AFppSc">
        <div role="heading" class="HoXoMd">Género:</div>
        <input type="hidden" name="entry.101483971" value="">
        <label data-value="Femenino"><span>Femenino</span></label>
        <label data-value="Masculino"><span>Masculino</span></label>
      </div>
    </div>
    <div role="listitem" class="Qr7Oae" id="q-likert1">
      <div class="geS5n AFppSc">
        <div role="heading" class="HoXoMd">Pregunta Likert 1</div>
        <input type="hidden" name="entry.1545271284_sentinel" value="">
        <label data-value="Totalmente en desacuerdo"><span>Totalmente en desacuerdo</span></label>
        <label data-value="En desacuerdo"><span>En desacuerdo</span></label>
        <label data-value="De acuerdo"><span>De acuerdo</span></label>
      </div>
    </div>
    <div role="listitem" class="Qr7Oae" id="q-likert2">
      <div class="geS5n AFppSc">
        <div role="heading" class="HoXoMd">Pregunta Likert 2</div>
        <input type="hidden" name="entry.739643434_sentinel" value="">
        <label data-value="Totalmente en desacuerdo"><span>Totalmente en desacuerdo</span></label>
        <label data-value="En desacuerdo"><span>En desacuerdo</span></label>
        <label data-value="De acuerdo"><span>De acuerdo</span></label>
      </div>
    </div>
    <div role="listitem" class="Qr7Oae" id="q-nativa">
      <div class="geS5n AFppSc">
        <div role="heading" class="HoXoMd">Escala 1-5 nativa</div>
        <label><input type="radio" name="entry.999" value="1"> 1</label>
        <label><input type="radio" name="entry.999" value="2"> 2</label>
        <label><input type="radio" name="entry.999" value="3"> 3</label>
      </div>
    </div>
  </form>
`;

function buildDom() {
  const dom = new JSDOM(`<!doctype html><html><body>${MOCK_FORM_HTML}</body></html>`, {
    runScripts: 'dangerously',
    url: 'https://example.test/',
  });
  const { window } = dom;

  // content.js llama a chrome.storage.local.get al cargar (init(), que no
  // hace nada mas porque isSupportedFormPage() da false fuera de
  // docs.google.com) y a window.matchMedia para el tema del panel — ninguno
  // de los dos importa para lo que se prueba aqui, solo hace falta que no
  // tiren excepcion al cargar el script.
  window.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async () => ({ ok: false }),
      onMessage: { addListener: () => {} },
    },
  };
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }

  // Simula lo que el JS REAL de Google Forms hace al clickear un <label> de
  // opcion multiple — confirmado en vivo con el navegador real sobre un
  // formulario real, no supuesto:
  //   - Caso A (Genero, el input oculto entry.X YA existe): se actualiza
  //     SINCRONICAMENTE, en el mismo tick del click.
  //   - Caso B (Likert, solo existe el _sentinel): el input oculto entry.X
  //     NO se crea en el click. Se crea recien despues, en un ciclo propio
  //     de guardado de Google (el mismo de "Borrador guardado"), medido en
  //     vivo entre ~2 y ~3.5 segundos DESPUES del click — de ahi el
  //     setTimeout aca abajo, para que esta prueba de verdad ejercite el
  //     camino asincronico de fillUnansweredFormInputs en vez de esconder
  //     ese timing detras de una actualizacion instantanea irreal.
  const ASYNC_CREATE_DELAY_MS = 120;
  window.__testAsyncCreateDelayMs = ASYNC_CREATE_DELAY_MS;
  Array.from(window.document.querySelectorAll('label[data-value]')).forEach((label) => {
    label.addEventListener('click', () => {
      const container = label.closest('[role="listitem"]').querySelector('.geS5n');
      const sentinel = container.querySelector(
        'input[type="hidden"][name^="entry."][name$="_sentinel"]'
      );
      if (sentinel) {
        const realName = sentinel.name.replace(/_sentinel$/, '');
        window.setTimeout(() => {
          let realInput = container.querySelector(`input[name="${realName}"]`);
          if (!realInput) {
            realInput = window.document.createElement('input');
            realInput.type = 'hidden';
            realInput.name = realName;
            container.appendChild(realInput);
          }
          realInput.value = label.dataset.value;
        }, ASYNC_CREATE_DELAY_MS);
        return;
      }
      const realInput = container.querySelector('input[type="hidden"][name^="entry."]');
      realInput.value = label.dataset.value;
    });
  });

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = contentJsSource;
  window.document.body.appendChild(scriptEl);

  return window;
}

describe('fillUnansweredFormInputs contra las variantes reales de Google Forms', () => {
  test('rellena las 3 variantes (input ya existente, input creado al clickear, radio nativo) y no deja nada pendiente', async () => {
    const window = buildDom();
    const form = window.document.getElementById('mockForm');

    assert.equal(form.querySelector('[name="entry.101483971"]').value, '', 'Genero arranca vacio');
    assert.equal(form.querySelector('[name="entry.1545271284"]'), null, 'el input real de Likert1 no existe todavia');

    const resultado = await window.fillUnansweredFormInputs(form);

    // length, no deepEqual contra un [] literal: resultado.missingRequired
    // es un array del realm de JSDOM (otro contexto de JS), y
    // assert.deepEqual/deepStrictEqual trata dos arrays de realms distintos
    // como no-equivalentes aunque esten vacios los dos — no es un bug real,
    // es como Node distingue identidad entre contextos de vm.
    assert.equal(resultado.missingRequired.length, 0, 'no deberia quedar nada sin poder rellenar');
    assert.equal(resultado.filled, 4, 'Genero + Likert1 + Likert2 + Nativa');

    const genero = form.querySelector('[name="entry.101483971"]').value;
    const likert1 = form.querySelector('[name="entry.1545271284"]')?.value;
    const likert2 = form.querySelector('[name="entry.739643434"]')?.value;
    const nativa = form.querySelector('[name="entry.999"]:checked')?.value;

    assert.ok(['Femenino', 'Masculino'].includes(genero), `Genero (input ya existente) quedo con un valor real: ${genero}`);
    assert.ok(likert1, 'Likert1 (input creado recien al clickear, DESPUES de esperar el ciclo asincronico) quedo con un valor real');
    assert.ok(likert2, 'Likert2 (confirma que no se corta despues del primer grupo custom) quedo con un valor real');
    assert.ok(nativa, 'la pregunta con radio nativo de toda la vida sigue funcionando');
  });

  test('varias preguntas de creacion asincronica se esperan UNA sola vez, no una por una', async () => {
    // Esto es lo que realmente se rompia: fillCustomWidgetGroup verificaba
    // el input oculto EN EL MISMO TICK del click, pero Google (confirmado en
    // vivo) recien lo crea despues de un ciclo propio de guardado — asi que
    // la verificacion siempre fallaba y las 24 preguntas Likert de un
    // formulario real se mandaban vacias. La solucion dispara todos los
    // clicks primero y espera UNA vez al final; si alguien la regresiona a
    // "click, esperar, click, esperar..." por pregunta, este formulario de 2
    // preguntas asincronicas tardaria ~2x ASYNC_CREATE_DELAY_MS en vez de
    // ~1x, y la prueba de tiempo de abajo lo agarra.
    const window = buildDom();
    const form = window.document.getElementById('mockForm');
    const delay = window.__testAsyncCreateDelayMs;

    const antes = Date.now();
    const resultado = await window.fillUnansweredFormInputs(form);
    const transcurrido = Date.now() - antes;

    assert.equal(resultado.missingRequired.length, 0, 'no deberia quedar nada sin poder rellenar');
    // Umbral generoso (no delay*2 exacto): el intervalo de polling real de
    // content.js (250ms) hace piso en el tiempo minimo detectable aunque la
    // espera SEA compartida, asi que un batch tarda ~1 intervalo de polling
    // (~250-350ms observado) mientras que uno secuencial (click, esperar
    // TODO el ciclo, click, esperar TODO el ciclo...) tardaria ~2 ciclos
    // completos (>=500ms). El umbral de abajo cae comodo en el medio.
    const umbralSecuencial = delay + 300;
    assert.ok(
      transcurrido < umbralSecuencial,
      `si Likert1 y Likert2 se esperaran uno por uno tardaria bastante mas de ${umbralSecuencial}ms; tardo ${transcurrido}ms, lo que confirma que se esperaron juntos`
    );
  });

  test('una pregunta ya respondida no se vuelve a tocar', async () => {
    const window = buildDom();
    const form = window.document.getElementById('mockForm');
    form.querySelector('[name="entry.101483971"]').value = 'Femenino';

    const resultado = await window.fillUnansweredFormInputs(form);

    assert.equal(form.querySelector('[name="entry.101483971"]').value, 'Femenino', 'no se toca lo que ya tenia respuesta');
    assert.equal(resultado.filled, 3, 'Genero no cuenta como "rellenado" porque ya lo estaba');
  });

  test('si ninguna opcion es clickeable, se reporta como no rellenable en vez de fallar en silencio', async () => {
    const window = buildDom();
    const form = window.document.getElementById('mockForm');
    // Deshabilita las 2 opciones de Genero: no deberia poder rellenarse.
    form.querySelectorAll('#q-genero label').forEach((label) => {
      label.style.display = 'none';
    });

    const resultado = await window.fillUnansweredFormInputs(form);

    assert.ok(
      resultado.missingRequired.some((m) => /Género/i.test(m.label)),
      'Genero debe aparecer en missingRequired cuando no hay ninguna opcion clickeable'
    );
  });

  test('findNextPageButton detecta un boton "Siguiente" visible', () => {
    const window = buildDom();
    const form = window.document.getElementById('mockForm');
    // Dentro del <form>: en el DOM real, el boton "Siguiente" vive adentro
    // del mismo <form> que las preguntas (confirmado con el navegador real
    // sobre el formulario que reprodujo el bug original).
    const nextBtn = window.document.createElement('div');
    nextBtn.setAttribute('role', 'button');
    nextBtn.textContent = 'Siguiente';
    form.appendChild(nextBtn);

    const found = window.findNextPageButton(form);
    assert.equal(found, nextBtn);
  });

  test('findNextPageButton no encuentra nada si no hay boton de avanzar', () => {
    const window = buildDom();
    const found = window.findNextPageButton(window.document.getElementById('mockForm'));
    assert.equal(found, null);
  });
});
