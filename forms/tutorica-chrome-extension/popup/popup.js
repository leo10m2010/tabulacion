const SETTINGS_KEY = 'tesistabSettings';
const DIAGNOSTICS_KEY = 'tesistabDiagnostics';

const DEFAULT_SETTINGS = {
  enabled: true,
  backendBaseUrl: 'https://tabulacion-api.onrender.com',
  apiKey: '',
  accountEmail: '',
  // Auto-bloqueo estilo caja fuerte: minutos hasta pedir la contrasena de
  // nuevo (0 = nunca). sessionExpiresAt es el instante (ms) en que expira.
  sessionLockMinutes: 1440,
  sessionExpiresAt: 0,
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

// Declarado antes de las llamadas de arranque: decoratePopupIcons() corre al
// cargar y un const posterior quedaria en zona muerta temporal (ReferenceError
// que dejaba el popup sin iconos ni listeners).
const ICON_PATHS = {
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
  login: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 4v16"/>',
  logout: '<path d="M16 17l5-5-5-5"/><path d="M21 12H9"/><path d="M3 4v16"/>',
  status: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 3"/>',
  backend: '<rect x="4" y="5" width="16" height="6" rx="2"/><rect x="4" y="13" width="16" height="6" rx="2"/><path d="M8 8h.01"/><path d="M8 16h.01"/>',
  diagnostics: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.9.8-1.7 1.3-1.7 2.7"/><path d="M12 17h.01"/>',
  save: '<path d="M5 20h14"/><path d="M12 4v10"/><path d="M8 10l4 4 4-4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0 2 5.3"/><path d="M20 4v7h-7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M3 3l18 18"/><path d="M10.6 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3 3.9"/><path d="M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a10.7 10.7 0 0 0 5.4-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

const elements = {
  avatarChip: document.getElementById('avatarChip'),
  viewLogin: document.getElementById('viewLogin'),
  viewLock: document.getElementById('viewLock'),
  viewMain: document.getElementById('viewMain'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginBtn: document.getElementById('loginBtn'),
  lockEmail: document.getElementById('lockEmail'),
  lockPassword: document.getElementById('lockPassword'),
  unlockBtn: document.getElementById('unlockBtn'),
  lockLogoutBtn: document.getElementById('lockLogoutBtn'),
  connCard: document.getElementById('connCard'),
  connDot: document.getElementById('connDot'),
  connTitle: document.getElementById('connTitle'),
  connSub: document.getElementById('connSub'),
  connRefreshBtn: document.getElementById('connRefreshBtn'),
  enabled: document.getElementById('enabled'),
  themeMode: document.getElementById('themeMode'),
  lastRunState: document.getElementById('lastRunState'),
  sessionSection: document.getElementById('sessionSection'),
  sessionEmail: document.getElementById('sessionEmail'),
  lockTimeoutRow: document.getElementById('lockTimeoutRow'),
  sessionLockMinutes: document.getElementById('sessionLockMinutes'),
  lockNowBtn: document.getElementById('lockNowBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
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

initPopup();
decoratePopupIcons();
setupPasswordToggles();

elements.loginBtn.addEventListener('click', () => authenticate('login'));
elements.unlockBtn.addEventListener('click', () => authenticate('unlock'));
elements.loginPassword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') authenticate('login');
});
elements.lockPassword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') authenticate('unlock');
});
elements.logoutBtn.addEventListener('click', logout);
elements.lockLogoutBtn.addEventListener('click', logout);
elements.lockNowBtn.addEventListener('click', lockNow);
elements.sessionLockMinutes.addEventListener('change', persistLockMinutes);
elements.connRefreshBtn.addEventListener('click', () => refreshConnection(true));
elements.themeMode.addEventListener('change', async () => {
  const themeMode = normalizeThemeMode(elements.themeMode.value);
  applyPopupTheme(themeMode);
  await patchSettings({ themeMode });
  showStatus('Tema actualizado.', false);
});
elements.enabled.addEventListener('change', async () => {
  await patchSettings({ enabled: elements.enabled.checked });
});

async function initPopup() {
  const settings = await readSettings();
  applyPopupTheme(settings.themeMode);
  fillFields(settings);

  // Ventana deslizante: usar el popup desbloqueado renueva la expiracion.
  if (computeView(settings) === 'main' && settings.accountEmail && settings.sessionLockMinutes > 0) {
    await patchSettings({ sessionExpiresAt: Date.now() + settings.sessionLockMinutes * 60_000 });
  }

  showView(computeView(settings), settings);
  loadDiagnostics();
  if (computeView(settings) === 'main') {
    refreshConnection(false);
  }
}

async function readSettings() {
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

async function patchSettings(patch) {
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const merged = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

function fillFields(settings) {
  elements.enabled.checked = Boolean(settings.enabled);
  elements.themeMode.value = normalizeThemeMode(settings.themeMode);
  elements.sessionLockMinutes.value = String(normalizeLockMinutes(settings.sessionLockMinutes));
}

// ── Estados de vista ─────────────────────────────────────────────────────────

function computeView(settings) {
  if (!settings.accountEmail) {
    return settings.apiKey ? 'main' : 'login';
  }
  return isSessionLocked(settings) ? 'lock' : 'main';
}

function isSessionLocked(settings) {
  const expiresAt = Number(settings.sessionExpiresAt) || 0;
  return expiresAt > 0 && Date.now() >= expiresAt;
}

function showView(view, settings) {
  elements.viewLogin.hidden = view !== 'login';
  elements.viewLock.hidden = view !== 'lock';
  elements.viewMain.hidden = view !== 'main';

  const email = settings.accountEmail || '';
  elements.avatarChip.hidden = !email;
  elements.avatarChip.textContent = emailInitials(email);
  elements.lockEmail.textContent = email || '-';

  if (view === 'main') {
    const manualMode = !email;
    elements.sessionEmail.textContent = manualMode ? 'Clave manual' : email;
    elements.sessionEmail.className = `status-pill ${manualMode ? 'is-muted' : 'is-ok'}`;
    elements.lockTimeoutRow.hidden = manualMode;
    elements.lockNowBtn.hidden = manualMode;
    elements.logoutBtn.textContent = manualMode ? 'Quitar clave' : 'Cerrar sesion';
    decorateButtonIcon(elements.logoutBtn, 'logout');
  }

  if (view === 'lock') {
    elements.lockPassword.value = '';
    window.setTimeout(() => elements.lockPassword.focus(), 50);
  }
}

function emailInitials(email) {
  const namePart = String(email || '').split('@')[0];
  if (!namePart) return '-';
  const pieces = namePart.split(/[._-]+/).filter(Boolean);
  const initials = pieces.length >= 2 ? pieces[0][0] + pieces[1][0] : namePart.slice(0, 2);
  return initials.toUpperCase();
}

// ── Autenticacion ────────────────────────────────────────────────────────────

async function authenticate(mode) {
  const settings = await readSettings();
  const backendBaseUrl = normalizeUrl(settings.backendBaseUrl);
  const email = mode === 'login' ? String(elements.loginEmail.value || '').trim() : settings.accountEmail;
  const password = mode === 'login' ? String(elements.loginPassword.value || '') : String(elements.lockPassword.value || '');
  const button = mode === 'login' ? elements.loginBtn : elements.unlockBtn;

  if (!email || !password) {
    showStatus('Escribe tu correo y contrasena.', true);
    return;
  }

  button.disabled = true;
  showStatus(mode === 'login' ? 'Iniciando sesion...' : 'Desbloqueando...', false);

  try {
    const loginResponse = await apiRequest(`${backendBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = loginResponse.data;
    if (!loginResponse.ok || !loginBody?.token) {
      showStatus(loginBody?.error || `No se pudo iniciar sesion (HTTP ${loginResponse.status}).`, true);
      return;
    }

    const keyResponse = await apiRequest(`${backendBaseUrl}/auth/api-key`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const keyBody = keyResponse.data;
    if (!keyResponse.ok || !keyBody?.apiKey) {
      showStatus(keyBody?.error || `No se pudo obtener tu clave (HTTP ${keyResponse.status}).`, true);
      return;
    }

    const accountEmail = loginBody.user?.email || email;
    const lockMinutes = normalizeLockMinutes(settings.sessionLockMinutes);
    const updated = await patchSettings({
      backendBaseUrl,
      apiKey: keyBody.apiKey,
      accountEmail,
      sessionExpiresAt: lockMinutes > 0 ? Date.now() + lockMinutes * 60_000 : 0,
    });

    elements.loginPassword.value = '';
    elements.lockPassword.value = '';
    fillFields(updated);
    showView('main', updated);
    showStatus(mode === 'login' ? `Sesion iniciada como ${accountEmail}.` : 'Sesion desbloqueada.', false);
    refreshConnection(false);
  } catch (error) {
    showStatus(`No se pudo conectar: ${error.message || 'Error desconocido'}`, true);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  const updated = await patchSettings({ apiKey: '', accountEmail: '', sessionExpiresAt: 0 });
  elements.loginEmail.value = '';
  elements.loginPassword.value = '';
  elements.lockPassword.value = '';
  fillFields(updated);
  showView('login', updated);
  showStatus('Sesion cerrada en este navegador.', false);
}

async function lockNow() {
  const updated = await patchSettings({ sessionExpiresAt: Date.now() - 1 });
  showView('lock', updated);
  showStatus('Sesion bloqueada.', false);
}

async function persistLockMinutes() {
  const lockMinutes = normalizeLockMinutes(elements.sessionLockMinutes.value);
  await patchSettings({
    sessionLockMinutes: lockMinutes,
    sessionExpiresAt: lockMinutes > 0 ? Date.now() + lockMinutes * 60_000 : 0,
  });
  showStatus(lockMinutes > 0 ? 'Auto-bloqueo actualizado.' : 'La sesion ya no se bloquea sola.', false);
}

function normalizeLockMinutes(value) {
  const allowed = [0, 15, 60, 240, 720, 1440, 10080];
  const numeric = Number(value);
  return allowed.includes(numeric) ? numeric : DEFAULT_SETTINGS.sessionLockMinutes;
}

// ── Estado de conexion ───────────────────────────────────────────────────────

function setConnectionState(state, title, sub) {
  elements.connCard.className = `conn-card is-${state}`;
  elements.connTitle.textContent = title;
  elements.connSub.textContent = sub || 'Servicio TesisHub';
}

async function refreshConnection(announce) {
  const settings = await readSettings();
  const backendBaseUrl = normalizeUrl(settings.backendBaseUrl);
  const apiKey = String(settings.apiKey || '').trim();

  setConnectionState('checking', 'Verificando conexion...', 'Servicio TesisHub');

  try {
    const headers = apiKey ? { 'X-API-Key': apiKey } : {};
    const response = await apiRequest(`${backendBaseUrl}/api/tesistab/config`, { method: 'GET', headers });
    const result = response.data;

    if (!response.ok || !result) {
      const message = result?.error?.message || result?.message || `HTTP ${response.status}`;
      const unauthorized = response.status === 401;
      setConnectionState(
        'offline',
        unauthorized ? 'Clave no valida' : 'Sin conexion',
        unauthorized ? 'Inicia sesion de nuevo para renovarla' : message,
      );
      if (announce) showStatus(`Error del backend: ${message}`, true);
      return;
    }

    applyBackendConfig(result);
    // Forms funciona por usos (1 uso = 1 corrida de llenado). null significa
    // usos ilimitados (admin) o backend sin control de usos (modo legado).
    const usesLeft = result?.user?.usesLeft;
    const connectionSub = usesLeft === null || usesLeft === undefined
      ? 'Listo para enviar respuestas'
      : usesLeft > 0
        ? `Usos de Forms disponibles: ${usesLeft}`
        : 'Sin usos disponibles: pide una recarga en TesisHub';
    setConnectionState('online', 'Conectado', connectionSub);
    if (announce) showStatus('Conexion verificada.', false);
  } catch (error) {
    setConnectionState('offline', 'Sin conexion', 'Revisa tu internet o intenta luego');
    if (announce) showStatus(`No se pudo conectar: ${error.message || 'Error desconocido'}`, true);
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

// ── Diagnostico ──────────────────────────────────────────────────────────────

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

// Las peticiones salen por el service worker: con host_permissions no esta
// sujeto a CORS, a diferencia del documento del popup (las rutas /auth/* del
// backend no publican Access-Control-Allow-Origin para extensiones antiguas).
// Si el mensaje falla se intenta el fetch directo como respaldo.
async function apiRequest(url, options = {}) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'tesistab_HTTP_REQUEST',
      payload: {
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
      },
    });
    if (response && typeof response.status === 'number' && response.status > 0) {
      const data = typeof response.data === 'object' ? response.data : null;
      return { ok: Boolean(response.ok), status: response.status, data };
    }
    if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    // Solo errores de mensajeria caen al fetch directo; los del servidor se
    // propagan tal cual para mostrarse al usuario.
    if (error?.message && !/message port|Receiving end|context invalidated/i.test(error.message)) {
      throw error;
    }
  }

  const direct = await fetch(url, options);
  return { ok: direct.ok, status: direct.status, data: await safeReadJson(direct) };
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

// ── Tema ─────────────────────────────────────────────────────────────────────

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

systemThemeQuery.addEventListener('change', () => {
  if (normalizeThemeMode(elements.themeMode.value) === 'system') {
    applyPopupTheme('system');
  }
});

// ── Iconos ───────────────────────────────────────────────────────────────────

function decoratePopupIcons() {
  document.querySelectorAll('.with-icon[data-icon]').forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const text = element.textContent || '';
    element.replaceChildren(createPopupIcon(element.dataset.icon || ''), document.createTextNode(text));
  });

  document.querySelectorAll('.hero-icon[data-hero]').forEach((element) => {
    if (element instanceof HTMLElement) {
      element.innerHTML = createIconSvg(element.dataset.hero || 'account', 2.2);
    }
  });

  elements.connRefreshBtn.innerHTML = createIconSvg('refresh', 1.8);
  decorateButtonIcon(elements.loginBtn, 'login');
  decorateButtonIcon(elements.unlockBtn, 'unlock');
  decorateButtonIcon(elements.lockNowBtn, 'lock');
  decorateButtonIcon(elements.logoutBtn, 'logout');
  decorateButtonIcon(elements.lockLogoutBtn, 'logout');
}

function decorateButtonIcon(button, iconKey) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const text = button.textContent || '';
  button.replaceChildren(createPopupIcon(iconKey), document.createTextNode(text));
}

function createIconSvg(iconKey, strokeWidth) {
  const path = ICON_PATHS[iconKey] || ICON_PATHS.help;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth || 1.8}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function createPopupIcon(iconKey) {
  const span = document.createElement('span');
  span.className = 'section-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = createIconSvg(iconKey, 1.8);
  return span;
}

function setupPasswordToggles() {
  document.querySelectorAll('button[data-toggle-password]').forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const input = document.getElementById(button.dataset.togglePassword || '');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    button.innerHTML = createIconSvg('eye', 1.8);
    button.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.innerHTML = createIconSvg(reveal ? 'eyeOff' : 'eye', 1.8);
      button.setAttribute('aria-label', reveal ? 'Ocultar contrasena' : 'Mostrar contrasena');
      input.focus();
    });
  });
}

// ── Mensajes y pildoras ──────────────────────────────────────────────────────

function showStatus(message, isError) {
  elements.status.textContent = message;
  elements.status.className = isError ? 'error' : 'ok';
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
