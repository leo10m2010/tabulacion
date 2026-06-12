const SETTINGS_KEY = 'borangQaSettings';
const DIAGNOSTICS_KEY = 'borangQaDiagnostics';

const DEFAULT_SETTINGS = {
  enabled: true,
  backendBaseUrl: 'https://tutorica-forms.onrender.com',
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

const POPUP_MAX_SUBMISSIONS = 250;
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

const elements = {
  enabled: document.getElementById('enabled'),
  themeMode: document.getElementById('themeMode'),
  backendBaseUrl: document.getElementById('backendBaseUrl'),
  apiKey: document.getElementById('apiKey'),
  requireConfirmation: document.getElementById('requireConfirmation'),
  multiPageMode: document.getElementById('multiPageMode'),
  backendLive: document.getElementById('backendLive'),
  lastRunState: document.getElementById('lastRunState'),
  saveBtn: document.getElementById('saveBtn'),
  testConnectionBtn: document.getElementById('testConnectionBtn'),
  refreshDiagBtn: document.getElementById('refreshDiagBtn'),
  status: document.getElementById('status'),
  backendMax: document.getElementById('backendMax'),
  backendGender: document.getElementById('backendGender'),
  backendAge: document.getElementById('backendAge'),
  backendFreq: document.getElementById('backendFreq'),
  diagJob: document.getElementById('diagJob'),
  diagStatus: document.getElementById('diagStatus'),
  diagError: document.getElementById('diagError'),
  diagUpdatedAt: document.getElementById('diagUpdatedAt'),
};

loadSettings();
loadDiagnostics();
loadBackendConfig(false);
decoratePopupIcons();

elements.saveBtn.addEventListener('click', saveSettings);
elements.testConnectionBtn.addEventListener('click', testConnection);
elements.refreshDiagBtn.addEventListener('click', async () => {
  await loadDiagnostics();
  showStatus('Estado actualizado.', false);
});

async function loadSettings() {
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };

  elements.enabled.checked = Boolean(settings.enabled);
  elements.themeMode.value = normalizeThemeMode(settings.themeMode);
  elements.backendBaseUrl.value = settings.backendBaseUrl;
  elements.apiKey.value = settings.apiKey || '';
  elements.requireConfirmation.checked = Boolean(settings.requireConfirmation);
  elements.multiPageMode.checked = Boolean(settings.multiPageMode);
  applyPopupTheme(elements.themeMode.value);
}

async function saveSettings() {
  const existing = await chrome.storage.local.get([SETTINGS_KEY]);
  const previous = { ...DEFAULT_SETTINGS, ...(existing[SETTINGS_KEY] || {}) };

  const sanitized = {
    ...previous,
    enabled: elements.enabled.checked,
    themeMode: normalizeThemeMode(elements.themeMode.value),
    backendBaseUrl: normalizeUrl(elements.backendBaseUrl.value),
    apiKey: String(elements.apiKey.value || '').trim(),
    requireConfirmation: elements.requireConfirmation.checked,
    multiPageMode: elements.multiPageMode.checked,
    delayMs: clamp(Number(previous.delayMs) || DEFAULT_SETTINGS.delayMs, 300, 60_000),
    jitterMs: clamp(Number(previous.jitterMs) || DEFAULT_SETTINGS.jitterMs, 0, 5_000),
    autoRandomizeText: Boolean(previous.autoRandomizeText),
    randomizeBeforeSubmit: Boolean(previous.randomizeBeforeSubmit),
    compatApiMode: Boolean(previous.compatApiMode),
  };

  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  applyPopupTheme(sanitized.themeMode);

  showStatus('Configuracion guardada.', false);
}

elements.themeMode.addEventListener('change', async () => {
  const themeMode = normalizeThemeMode(elements.themeMode.value);
  applyPopupTheme(themeMode);
  await persistThemeMode(themeMode);
  showStatus('Tema actualizado.', false);
});

async function testConnection() {
  const backendBaseUrl = normalizeUrl(elements.backendBaseUrl.value);
  const apiKey = String(elements.apiKey.value || '').trim();

  showStatus('Probando backend...', false);

  try {
    const headers = apiKey
      ? {
          'X-API-Key': apiKey,
        }
      : {};

    const response = await fetch(`${backendBaseUrl}/api/qa/config`, {
      method: 'GET',
      headers,
    });

    const result = await safeReadJson(response);
    if (!response.ok) {
      setBackendLiveState(false, 'No disponible');
      const message = result?.error?.message || result?.message || `HTTP ${response.status}`;
      showStatus(`Error del backend: ${message}`, true);
      return;
    }

    applyBackendConfig(result);
    setBackendLiveState(true, 'Conectado');
    const hostCount = Array.isArray(result.allowedHosts) ? result.allowedHosts.length : 0;
    const keyMode = result?.protection?.apiKeyRequired
      ? 'API key requerida'
      : 'API key no requerida';
    showStatus(`Conectado. Hosts permitidos: ${hostCount}. ${keyMode}.`, false);
  } catch (error) {
    setBackendLiveState(false, 'No disponible');
    showStatus(`No se pudo conectar: ${error.message || 'Error desconocido'}`, true);
  }
}

async function loadBackendConfig(showErrors = false) {
  const backendBaseUrl = normalizeUrl(elements.backendBaseUrl?.value || DEFAULT_SETTINGS.backendBaseUrl);
  const apiKey = String(elements.apiKey?.value || '').trim();

  try {
    const headers = apiKey
      ? {
          'X-API-Key': apiKey,
        }
      : {};

    const response = await fetch(`${backendBaseUrl}/api/qa/config`, {
      method: 'GET',
      headers,
    });

    const result = await safeReadJson(response);
    if (!response.ok || !result) {
      setBackendLiveState(false, 'No disponible');
      if (showErrors) {
        const message = result?.error?.message || result?.message || `HTTP ${response.status}`;
        showStatus(`Error del backend: ${message}`, true);
      }
      return;
    }

    applyBackendConfig(result);
    setBackendLiveState(true, 'Conectado');
  } catch (error) {
    setBackendLiveState(false, 'No disponible');
    if (showErrors) {
      showStatus(`No se pudo cargar config: ${error.message || 'Error desconocido'}`, true);
    }
  }
}

function applyBackendConfig(config) {
  const maxFromBackend = Number(config?.limits?.maxSubmissionsPerJob);
  const maxSubmissions = Number.isFinite(maxFromBackend)
    ? Math.max(1, Math.floor(maxFromBackend))
    : POPUP_MAX_SUBMISSIONS;

  const genderMin = Number(config?.distribution?.genderShareRange?.min);
  const genderMax = Number(config?.distribution?.genderShareRange?.max);
  const age = config?.distribution?.ageShares || {};
  const frequency = config?.distribution?.purchaseFrequencyShares || {};

  elements.backendMax.textContent = `Max por corrida: ${maxSubmissions}`;
  elements.backendGender.textContent = `Genero (rango): ${toPct(genderMin)}-${toPct(genderMax)}`;
  elements.backendAge.textContent =
    `Edad (pesos): 18-25 ${toPct(age.age_18_25)}, 26-35 ${toPct(age.age_26_35)}, ` +
    `36-45 ${toPct(age.age_36_45)}, 46+ ${toPct(age.age_46_plus)}`;
  elements.backendFreq.textContent =
    `Frecuencia (pesos): Sem ${toPct(frequency.weekly)}, Quin ${toPct(frequency.biweekly)}, ` +
    `Mens ${toPct(frequency.monthly)}, Ocas ${toPct(frequency.occasional)}`;
}

function toPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return '-';
  }

  return `${Math.round(numeric * 100)}%`;
}

async function loadDiagnostics() {
  const result = await chrome.storage.local.get([DIAGNOSTICS_KEY]);
  const diagnostics = result[DIAGNOSTICS_KEY] || {};

  elements.diagJob.textContent = `Job: ${diagnostics.lastJobId || '-'}`;
  elements.diagStatus.textContent = `Estado: ${diagnostics.lastJobStatus || '-'}`;
  elements.diagError.textContent = `Error: ${diagnostics.lastError || '-'}`;
  elements.diagUpdatedAt.textContent = `Actualizado: ${formatDateTime(diagnostics.updatedAt)}`;
  setLastRunState(diagnostics.lastJobStatus, diagnostics.lastError);
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
}

function normalizeUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    return DEFAULT_SETTINGS.backendBaseUrl;
  }

  const candidate = /^https?:\/\//i.test(input) ? input : `http://${input}`;

  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    return DEFAULT_SETTINGS.backendBaseUrl;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeThemeMode(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'dark' || normalized === 'system' ? normalized : 'light';
}

function applyPopupTheme(themeMode) {
  document.body.setAttribute('data-theme', resolveEffectiveThemeMode(themeMode));
}

function resolveEffectiveThemeMode(themeMode) {
  const normalized = normalizeThemeMode(themeMode);
  if (normalized === 'system') {
    return systemThemeQuery.matches ? 'dark' : 'light';
  }

  return normalized;
}

async function persistThemeMode(themeMode) {
  const existing = await chrome.storage.local.get([SETTINGS_KEY]);
  const previous = { ...DEFAULT_SETTINGS, ...(existing[SETTINGS_KEY] || {}) };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...previous,
      themeMode: normalizeThemeMode(themeMode),
    },
  });
}

systemThemeQuery.addEventListener('change', () => {
  if (normalizeThemeMode(elements.themeMode.value) === 'system') {
    applyPopupTheme('system');
  }
});

function decoratePopupIcons() {
  document.querySelectorAll('.with-icon[data-icon]').forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const text = element.textContent || '';
    element.replaceChildren(createPopupIcon(element.dataset.icon || ''), document.createTextNode(text));
  });

  decorateButtonIcon(elements.saveBtn, 'save');
  decorateButtonIcon(elements.testConnectionBtn, 'backend');
  decorateButtonIcon(elements.refreshDiagBtn, 'refresh');
}

function decorateButtonIcon(button, iconKey) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const text = button.textContent || '';
  button.replaceChildren(createPopupIcon(iconKey), document.createTextNode(text));
}

function createPopupIcon(iconKey) {
  const span = document.createElement('span');
  span.className = 'section-icon';
  span.setAttribute('aria-hidden', 'true');

  const paths = {
    status: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 3"/>',
    backend: '<rect x="4" y="5" width="16" height="6" rx="2"/><rect x="4" y="13" width="16" height="6" rx="2"/><path d="M8 8h.01"/><path d="M8 16h.01"/>',
    diagnostics: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.9.8-1.7 1.3-1.7 2.7"/><path d="M12 17h.01"/>',
    save: '<path d="M5 20h14"/><path d="M12 4v10"/><path d="M8 10l4 4 4-4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0 2 5.3"/><path d="M20 4v7h-7"/>',
  };

  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[iconKey] || paths.help}</svg>`;
  return span;
}

function showStatus(message, isError) {
  elements.status.textContent = message;
  elements.status.className = isError ? 'error' : 'ok';
}

function setBackendLiveState(isOnline, label) {
  elements.backendLive.textContent = label;
  elements.backendLive.className = `status-pill ${isOnline ? 'is-ok' : 'is-error'}`;
}

function setLastRunState(status, error) {
  const value = String(status || '').trim();
  if (!value) {
    elements.lastRunState.textContent = 'Sin actividad';
    elements.lastRunState.className = 'status-pill is-muted';
    return;
  }

  if (value === 'completed') {
    elements.lastRunState.textContent = 'Completado';
    elements.lastRunState.className = 'status-pill is-ok';
    return;
  }

  if (value === 'cancelled') {
    elements.lastRunState.textContent = 'Cancelado';
    elements.lastRunState.className = 'status-pill is-warning';
    return;
  }

  if (value === 'completed_with_errors' || error) {
    elements.lastRunState.textContent = 'Con errores';
    elements.lastRunState.className = 'status-pill is-error';
    return;
  }

  if (value === 'running' || value === 'queued') {
    elements.lastRunState.textContent = 'En progreso';
    elements.lastRunState.className = 'status-pill is-warning';
    return;
  }

  elements.lastRunState.textContent = value;
  elements.lastRunState.className = 'status-pill is-muted';
}
