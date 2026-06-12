const PRODUCTION_BACKEND_URL = 'https://tabulacion-api.onrender.com';
const SETTINGS_KEY = 'tesistabSettings';
// Claves de versiones anteriores (prefijo duplicado): se migran y eliminan.
const LEGACY_KEY_MAP = {
  tesistabTesistabSettings: 'tesistabSettings',
  tesistabTesistabCsvRows: 'tesistabCsvRows',
  tesistabTesistabDiagnostics: 'tesistabDiagnostics',
};
// Defaults antiguos que deben migrarse al server de produccion.
const LEGACY_BACKEND_URLS = new Set([
  'http://localhost:5000',
  'https://localhost:5000',
  'http://127.0.0.1:5000',
  'https://127.0.0.1:5000',
]);

chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    enabled: true,
    backendBaseUrl: PRODUCTION_BACKEND_URL,
    apiKey: '',
    themeMode: 'system',
    panelViewMode: 'simple',
    submissionCount: 5,
    multiPageMode: true,
    smartProfileMode: true,
    smartProfileType: 'favorable',
    specialQuestionKeyword: '',
    specialQuestionPreferred: '',
    profileDistributionEnabled: false,
    profileShareFavorable: 60,
    profileShareIntermedio: 25,
    profileShareDesfavorable: 15,
    advancedMode: false,
    advancedGender: false,
    advancedAge: false,
    advancedFrequency: false,
    advancedPersonality: false,
    delayMs: 1000,
    jitterMs: 100,
    autoRandomizeText: false,
    requireConfirmation: true,
    randomizeBeforeSubmit: false,
    compatApiMode: false,
  };

  const stored = await chrome.storage.local.get([SETTINGS_KEY, ...Object.keys(LEGACY_KEY_MAP)]);
  const migrated = {};
  const obsoleteKeys = [];
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_MAP)) {
    if (stored[oldKey] !== undefined) {
      if (stored[newKey] === undefined && newKey !== SETTINGS_KEY) {
        migrated[newKey] = stored[oldKey];
      }
      obsoleteKeys.push(oldKey);
    }
  }

  const existing = { ...(stored[SETTINGS_KEY] || stored.tesistabTesistabSettings || {}) };
  if (LEGACY_BACKEND_URLS.has(String(existing.backendBaseUrl || '').trim().replace(/\/$/, ''))) {
    existing.backendBaseUrl = PRODUCTION_BACKEND_URL;
  }

  await chrome.storage.local.set({
    ...migrated,
    [SETTINGS_KEY]: {
      ...defaults,
      ...existing,
    },
  });
  if (obsoleteKeys.length > 0) {
    await chrome.storage.local.remove(obsoleteKeys);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'tesistab_HTTP_REQUEST') {
    return false;
  }

  (async () => {
    try {
      const result = await handleHttpRequest(message.payload);
      sendResponse(result);
    } catch (error) {
      sendResponse({
        ok: false,
        status: 0,
        data: null,
        error: error?.message || 'Background request failed',
      });
    }
  })();

  return true;
});

async function handleHttpRequest(payload) {
  const request = payload || {};
  const response = await fetch(request.url, {
    method: request.method || 'GET',
    headers: request.headers || {},
    body: request.body,
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return {
    ok: response.ok,
    status: response.status,
    data,
    error: null,
  };
}
