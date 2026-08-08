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
const { webcrypto } = require('node:crypto');

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
  const storageState = {};
  window.__testStorage = storageState;
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((key) => key in storageState)
            .map((key) => [key, storageState[key]])
        ),
        set: async (values) => Object.assign(storageState, values),
        remove: async (keys) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storageState[key];
        },
      },
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
  Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto });

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
  window.__testAsyncEventOrder = [];
  Array.from(window.document.querySelectorAll('label[data-value]')).forEach((label) => {
    label.addEventListener('click', () => {
      const container = label.closest('[role="listitem"]').querySelector('.geS5n');
      const sentinel = container.querySelector(
        'input[type="hidden"][name^="entry."][name$="_sentinel"]'
      );
      if (sentinel) {
        const realName = sentinel.name.replace(/_sentinel$/, '');
        window.__testAsyncEventOrder.push(`click:${realName}`);
        window.setTimeout(() => {
          let realInput = container.querySelector(`input[name="${realName}"]`);
          if (!realInput) {
            realInput = window.document.createElement('input');
            realInput.type = 'hidden';
            realInput.name = realName;
            container.appendChild(realInput);
          }
          realInput.value = label.dataset.value;
          window.__testAsyncEventOrder.push(`created:${realName}`);
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
    // preguntas asincronicas procesaria el primer evento de creacion antes
    // de disparar el segundo click; el orden de eventos de abajo lo detecta
    // sin depender de tiempos de pared.
    const window = buildDom();
    const form = window.document.getElementById('mockForm');
    const resultado = await window.fillUnansweredFormInputs(form);

    assert.equal(resultado.missingRequired.length, 0, 'no deberia quedar nada sin poder rellenar');
    // Reloj/eventos controlados: ambos clicks deben ocurrir antes de que el
    // primer input asincronico sea creado. Esta propiedad demuestra batching
    // sin depender de la velocidad de la maquina de CI.
    const events = Array.from(window.__testAsyncEventOrder);
    const firstCreation = events.findIndex((event) => event.startsWith('created:'));
    const clickEvents = events.filter((event) => event.startsWith('click:'));
    assert.equal(clickEvents.length, 2);
    assert.ok(firstCreation >= 2, `los clicks deben agruparse antes de esperar: ${events.join(', ')}`);
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

  test('cubre texto, parrafo, lista, casilla, cuadricula, fecha, hora y obligatorios', async () => {
    const window = buildDom();
    const form = window.document.createElement('form');
    form.innerHTML = `
      <div role="listitem" data-required="true"><input name="entry.1" type="text" required></div>
      <div role="listitem"><textarea name="entry.2"></textarea></div>
      <div role="listitem"><select name="entry.3"><option value="">Elegir</option><option value="A">A</option></select></div>
      <div role="listitem"><label><input name="entry.4" type="checkbox" value="Sí"> Sí</label></div>
      <div role="listitem"><label><input name="entry.5" type="radio" value="1"> Fila 1 / Columna 1</label></div>
      <div role="listitem"><label><input name="entry.6" type="radio" value="2"> Fila 2 / Columna 2</label></div>
      <div role="listitem"><input name="entry.7" type="date"></div>
      <div role="listitem"><input name="entry.8" type="time"></div>
    `;
    window.document.body.appendChild(form);

    const result = await window.fillUnansweredFormInputs(form);

    assert.equal(result.missingRequired.length, 0);
    assert.equal(result.filled, 8);
    assert.ok(form.querySelector('[name="entry.1"]').value);
    assert.ok(form.querySelector('[name="entry.2"]').value);
    assert.equal(form.querySelector('[name="entry.3"]').value, 'A');
    assert.equal(form.querySelector('[name="entry.4"]').checked, true);
    assert.equal(form.querySelector('[name="entry.5"]').checked, true);
    assert.equal(form.querySelector('[name="entry.6"]').checked, true);
    assert.equal(form.querySelector('[name="entry.7"]').value, '2026-01-15');
    assert.equal(form.querySelector('[name="entry.8"]').value, '10:00');
  });

  test('captura y combina paginas, y calcula un hash estructural reproducible', async () => {
    const window = buildDom();
    const first = window.document.getElementById('mockForm');
    first.action = 'https://docs.google.com/forms/d/e/form-multipage/formResponse';
    first.querySelector('[name="entry.101483971"]').value = 'Femenino';
    const firstSnapshot = window.createFormPageSnapshot(first);
    await window.persistMultiPageSnapshot(firstSnapshot);

    const second = window.document.createElement('form');
    second.action = first.action;
    second.innerHTML = '<label>Edad <input name="entry.202" value="25"></label>';
    const secondSnapshot = window.createFormPageSnapshot(second);
    const capture = await window.persistMultiPageSnapshot(secondSnapshot);
    assert.equal(capture.pages.length, 2);
    const merged = window.mergeCapturedPayload(capture.pages);
    assert.equal(merged['entry.101483971'], 'Femenino');
    assert.equal(merged['entry.202'], '25');

    const structure = window.buildCapturedStructure(capture.pages);
    const firstHash = await window.hashStableValue(structure);
    const secondHash = await window.hashStableValue(structure);
    assert.match(firstHash, /^[a-f0-9]{64}$/);
    assert.equal(firstHash, secondHash);
  });

  test('separa recorridos condicionales y deriva selectores sin mezclar ramas', async () => {
    const window = buildDom();
    const formId = 'conditional-form';
    const rootA = {
      formId,
      pageKey: `${formId}:root`,
      payload: { 'entry.10': 'Empresa', fvv: '1', pageHistory: '0' },
      fields: [{ entry: 'entry.10', question: 'Tipo', type: 'radio', options: ['Empresa', 'Persona'] }],
      terminal: false,
    };
    const companyEnd = {
      formId,
      pageKey: `${formId}:company`,
      payload: { 'entry.20': 'RUC 123', fvv: '1', fbzx: 'company-token', pageHistory: '0,1' },
      fields: [{ entry: 'entry.20', question: 'RUC', type: 'text', options: [] }],
      terminal: true,
    };
    await window.persistMultiPageSnapshot(rootA);
    await window.persistMultiPageSnapshot(companyEnd);

    // El usuario vuelve al inicio y elige la otra respuesta. Esto debe abrir
    // un fork, no actualizar la primera pagina dentro del recorrido Empresa.
    const rootB = {
      ...rootA,
      payload: { 'entry.10': 'Persona', fvv: '1', pageHistory: '0' },
    };
    await window.persistMultiPageSnapshot(rootB);
    const personEnd = {
      formId,
      pageKey: `${formId}:person`,
      payload: { 'entry.30': 'DNI 456', fvv: '1', fbzx: 'person-token', pageHistory: '0,2' },
      fields: [{ entry: 'entry.30', question: 'DNI', type: 'text', options: [] }],
      terminal: true,
    };
    const capture = await window.persistMultiPageSnapshot(personEnd);
    const config = window.buildCapturedMultiPageConfig(capture);

    assert.equal(config.routes.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(config.routes[0].when.all)), [{
      field: 'entry.10',
      operator: 'equals',
      value: 'Empresa',
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(config.routes[1].when.all)), [{
      field: 'entry.10',
      operator: 'equals',
      value: 'Persona',
    }]);
    assert.equal(config.routes[0].payload['entry.20'], 'RUC 123');
    assert.equal(config.routes[0].payload['entry.30'], undefined);
    assert.equal(config.routes[1].payload['entry.20'], undefined);
    assert.equal(config.routes[1].payload['entry.30'], 'DNI 456');
    assert.equal(config.routes[0].payload.pageHistory, '0,1');
    assert.equal(config.routes[1].payload.pageHistory, '0,2');

    const structure = window.buildCapturedStructure(capture);
    assert.equal(structure.version, 2);
    assert.equal(structure.routes.length, 2);
    assert.notEqual(
      await window.hashStableValue(structure),
      await window.hashStableValue({ ...structure, routes: structure.routes.slice(0, 1) })
    );
  });

  test('reconoce los controles de volver usados en captura guiada', () => {
    const window = buildDom();
    const button = window.document.createElement('div');
    button.setAttribute('role', 'button');
    button.textContent = 'Atrás';
    window.document.body.appendChild(button);
    assert.equal(window.isGoogleFormsPreviousTrigger(button), true);
  });
});
