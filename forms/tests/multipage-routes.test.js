const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const app = require('../server.js');

const routeContract = {
  version: 1,
  guidedCapture: true,
  routes: [
    {
      id: 'ruta-corta',
      fallback: true,
      when: { all: [{ field: 'entry.10', operator: 'equals', value: '4' }] },
      payload: {
        'entry.10': '4',
        'entry.20': 'solo ruta corta',
        fvv: '1',
        fbzx: 'token-corto',
        pageHistory: '0,1',
      },
      pages: [
        { pageKey: 'inicio', entries: ['entry.10'] },
        { pageKey: 'corta', entries: ['entry.20'] },
      ],
    },
    {
      id: 'ruta-larga',
      when: { all: [{ field: 'entry.10', operator: 'equals', value: '5' }] },
      payload: {
        'entry.10': '5',
        'entry.30': 'solo ruta larga',
        fvv: '1',
        fbzx: 'token-largo',
        pageHistory: '0,2,3',
      },
      pages: [
        { pageKey: 'inicio', entries: ['entry.10'] },
        { pageKey: 'larga-1', entries: ['entry.30'] },
        { pageKey: 'larga-2', entries: [] },
      ],
    },
  ],
};

describe('contrato seguro de rutas multipagina', () => {
  test('normaliza rutas, condiciones, payload y metadatos permitidos', () => {
    const result = app.sanitizeMultiPageConfig(routeContract);
    assert.equal(result.ok, true);
    assert.equal(result.value.routes.length, 2);
    assert.deepEqual(result.value.routes[1].when.all[0], {
      field: 'entry.10',
      operator: 'equals',
      value: '5',
    });
    assert.equal(result.value.routes[1].payload.pageHistory, '0,2,3');
    assert.deepEqual(result.value.routes[1].pages[0].entries, ['entry.10']);
  });

  test('rechaza campos arbitrarios, ids duplicados y mas de un fallback', () => {
    const arbitrary = structuredClone(routeContract);
    arbitrary.routes[0].payload.callbackUrl = 'https://evil.example';
    assert.equal(app.sanitizeMultiPageConfig(arbitrary).ok, false);

    const duplicate = structuredClone(routeContract);
    duplicate.routes[1].id = duplicate.routes[0].id;
    assert.equal(app.sanitizeMultiPageConfig(duplicate).ok, false);

    const fallbacks = structuredClone(routeContract);
    fallbacks.routes[1].fallback = true;
    assert.equal(app.sanitizeMultiPageConfig(fallbacks).ok, false);
  });
});

describe('seleccion de ruta por respuesta', () => {
  test('elige despues del perfil y no mezcla entries ni pageHistory de otra rama', () => {
    const sanitized = app.sanitizeMultiPageConfig(routeContract).value;
    const execution = {
      __tesistabExecutionVersion: 2,
      basePayload: {
        // Simula el payload plano heredado de la ruta corta. Debe descartarse
        // cuando la evaluacion del perfil elige la ruta larga.
        'entry.10': '4',
        'entry.20': 'no debe sobrevivir',
        fvv: '1',
      },
      multiPage: sanitized,
    };
    const originalRandom = Math.random;
    Math.random = () => 0.1; // perfil favorable convierte 4 en 5
    try {
      const result = app.buildRoutedAttemptPayload(
        execution,
        0,
        false,
        { enabled: true, type: 'favorable' },
        null,
      );
      assert.equal(result.routeId, 'ruta-larga');
      assert.equal(result.payload['entry.10'], '5');
      assert.equal(result.payload['entry.30'], 'solo ruta larga');
      assert.equal(result.payload['entry.20'], undefined);
      assert.equal(result.payload.pageHistory, '0,2,3');
      assert.equal(result.payload.fbzx, 'token-largo');
    } finally {
      Math.random = originalRandom;
    }
  });

  test('rota rutas sin condiciones y conserva cada payload como unidad', () => {
    const noConditions = structuredClone(routeContract);
    noConditions.routes.forEach((route) => { route.when = { all: [] }; });
    const sanitized = app.sanitizeMultiPageConfig(noConditions).value;
    const execution = {
      __tesistabExecutionVersion: 2,
      basePayload: { 'entry.999': 'comun' },
      multiPage: sanitized,
    };
    const first = app.buildRoutedAttemptPayload(execution, 0, false, { enabled: false }, null);
    const second = app.buildRoutedAttemptPayload(execution, 1, false, { enabled: false }, null);
    assert.equal(first.routeId, 'ruta-corta');
    assert.equal(first.payload['entry.20'], 'solo ruta corta');
    assert.equal(first.payload['entry.30'], undefined);
    assert.equal(second.routeId, 'ruta-larga');
    assert.equal(second.payload['entry.20'], undefined);
    assert.equal(second.payload['entry.30'], 'solo ruta larga');
    assert.equal(second.payload['entry.999'], 'comun');
  });
});
