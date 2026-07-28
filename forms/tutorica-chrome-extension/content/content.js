const SETTINGS_KEY = 'tesistabSettings';
const CSV_ROWS_KEY = 'tesistabCsvRows';
const DIAGNOSTICS_KEY = 'tesistabDiagnostics';
const DEFAULT_SETTINGS = {
  enabled: true,
  backendBaseUrl: 'https://tabulacion-api.onrender.com',
  apiKey: '',
  accountEmail: '',
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
  hasSeenPanelTutorial: false,
};
// LIMITE: ajusta este valor para limitar maximo desde la extension.
const MAX_UI_SUBMISSIONS = 250;

let settings = { ...DEFAULT_SETTINGS };
let csvRows = [];
let csvCursor = 0;
let currentForm = null;
let boundForm = null;
let isTesistabRunStarting = false;
let lastTesistabTriggerAt = 0;
let lastMultiPageHintAt = 0;
let backendHealthTimer = null;
let activeJobId = '';
let activeJobStatus = '';
let isCancellingJob = false;
let activeJobProgressLabel = '';

const TESISTAB_TRIGGER_DEBOUNCE_MS = 1200;
const FORM_REBIND_INTERVAL_MS = 1200;
const MAX_MONITOR_TRANSIENT_ERRORS = 3;
const BACKEND_HEALTH_INTERVAL_MS = 15000;
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

init();

async function init() {
  settings = await loadSettings();
  if (!isSupportedFormPage()) {
    return;
  }

  recordDiagnostics({
    lastSeenFormUrl: window.location.href,
    updatedAt: new Date().toISOString(),
  });

  injectStatusPill(settings.enabled);
  injectActionsPanel();
  applyThemeToInjectedUi();

  const form = await waitForFormElement();
  currentForm = form;
  if (!form) {
    showStatus('Formulario no listo. Recarga e intenta de nuevo.', true);
    return;
  }

  await loadCsvRows();
  subscribeToSettingsChanges();
  subscribeToSystemThemeChanges();
  bindFormHandlers(form);
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);
  startFormRebindWatcher();
}

function bindFormHandlers(form) {
  if (!form || boundForm === form) {
    return;
  }

  if (boundForm) {
    boundForm.removeEventListener('submit', onFormSubmit, true);
  }

  boundForm = form;
  currentForm = form;
  boundForm.addEventListener('submit', onFormSubmit, true);
}

function startFormRebindWatcher() {
  window.setInterval(() => {
    if (!isSupportedFormPage()) {
      return;
    }

    injectStatusPill(settings.enabled);
    injectActionsPanel();
    applyThemeToInjectedUi();

    if (currentForm && document.contains(currentForm)) {
      return;
    }

    const form = document.querySelector('form');
    if (!form) {
      return;
    }

    bindFormHandlers(form);
  }, FORM_REBIND_INTERVAL_MS);
}

function isSupportedFormPage() {
  return (
    window.location.hostname === 'docs.google.com' &&
    (window.location.pathname.includes('/viewform') ||
      window.location.pathname.includes('/formResponse'))
  );
}

async function waitForFormElement(timeoutMs = 10000) {
  const initial = document.querySelector('form');
  if (initial) {
    return initial;
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const form = document.querySelector('form');
      if (form) {
        observer.disconnect();
        resolve(form);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

async function loadSettings() {
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

async function loadCsvRows() {
  const result = await chrome.storage.local.get([CSV_ROWS_KEY]);
  const savedRows = result[CSV_ROWS_KEY];
  if (!Array.isArray(savedRows)) {
    csvRows = [];
    csvCursor = 0;
    return;
  }

  csvRows = savedRows;
  csvCursor = 0;
}

async function onFormSubmit(event) {
  await startTesistabRun(event.currentTarget || currentForm || document.querySelector('form'), event);
}

async function onDocumentClick(event) {
  const target = resolveEventElementTarget(event);
  if (!target) {
    return;
  }

  const isSubmit = isGoogleFormsSubmitTrigger(target);
  if (isSubmit) {
    const form = target.closest('form') || currentForm || document.querySelector('form');
    await startTesistabRun(form, event);
    return;
  }

  settings = await loadSettings();
  if (settings.multiPageMode && isGoogleFormsNextTrigger(target)) {
      const now = Date.now();
      if (now - lastMultiPageHintAt > 2500) {
        lastMultiPageHintAt = now;
        showStatus('Pagina siguiente detectada. TesisHub se ejecuta en el ultimo paso.', false);
      }
  }
}

async function onDocumentKeyDown(event) {
  if (event.key !== 'Enter') {
    return;
  }

  const target = resolveEventElementTarget(event);
  if (!target) {
    return;
  }

  if (target.closest('#tesistab-qa-actions')) {
    return;
  }

  if (target.matches('textarea')) {
    return;
  }

  const form = target.closest('form') || currentForm || document.querySelector('form');
  if (!form) {
    return;
  }

  const isEnterSubmitContext = isGoogleFormsSubmitTrigger(target) || form.contains(target);
  if (!isEnterSubmitContext) {
    return;
  }

  await startTesistabRun(form, event);
}

async function startTesistabRun(form, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  settings = await loadSettings();
  if (!settings.enabled) {
    return;
  }

  if (isSessionLocked(settings)) {
    showStatus('Sesion bloqueada: abre la extension y desbloqueala con tu contrasena.', true);
    return;
  }

  const now = Date.now();
  if (now - lastTesistabTriggerAt < TESISTAB_TRIGGER_DEBOUNCE_MS) {
    return;
  }
  lastTesistabTriggerAt = now;

    if (!form) {
      showStatus('No se encontro el formulario para ejecutar TesisHub.', true);
      recordDiagnostics({
        lastError: 'No se encontro el formulario para ejecutar TesisHub.',
        updatedAt: new Date().toISOString(),
      });
      return;
    }

  if (isTesistabRunStarting) {
    showStatus('La ejecucion de TesisHub ya se esta iniciando...', true);
    return;
  }

  isTesistabRunStarting = true;
  syncJobActionButtons();

  try {
    // TesisHub NUNCA avanza solo entre paginas de un formulario de varias
    // secciones: solo captura y rellena lo que esta en la pagina ACTUAL. Si
    // esta pagina todavia tiene un boton "Siguiente" visible, quiere decir
    // que hay mas preguntas mas adelante que esta corrida no va a ver —
    // mandar de aca es mandar una base incompleta (o vacia, si esta pagina
    // es solo la portada). Reproducido en vivo: un formulario cuya primera
    // pagina es puro titulo/descripcion sin ninguna pregunta; "Iniciar" ahi
    // mandaba una respuesta vacia y Google la rechazaba con HTTP 400 sin
    // ninguna pista, porque fillUnansweredFormInputs no tenia nada que
    // reportar (no habia ninguna pregunta que rellenar EN ESA PAGINA).
    const nextButton = findNextPageButton(form);
    if (nextButton) {
      showStatus(
        'Este formulario tiene mas paginas. Avanza con "Siguiente" hasta la ultima antes de darle Iniciar.',
        true
      );
      scrollToAndHighlight(nextButton);
      recordDiagnostics({
        lastError: 'Boton "Siguiente" detectado: hay mas paginas antes de la ultima.',
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const rawCount = Number(settings.submissionCount) || 1;
    const count = clamp(rawCount, 1, MAX_UI_SUBMISSIONS);
    const delayMs = clamp(Number(settings.delayMs) || 1000, 300, 60_000);
    const jitterMs = clamp(Number(settings.jitterMs) || 0, 0, 5_000);

    if (settings.randomizeBeforeSubmit) {
      randomizeFormInputs(form);
    }

    const prefill = await fillUnansweredFormInputs(form);
    if (prefill.filled > 0) {
      showStatus(`Se completaron ${prefill.filled} respuestas faltantes para TesisHub.`);
    }
    if (prefill.missingRequired.length) {
      const firstMissing = prefill.missingRequired[0];
      const suffix = prefill.missingRequired.length > 1 ? ` (+${prefill.missingRequired.length - 1})` : '';
      // No siempre podemos confirmar que la pregunta es obligatoria (ver
      // fillUnansweredFormInputs), asi que el mensaje no lo afirma: solo dice
      // que no se pudo rellenar sola y que hay que completarla a mano antes
      // de reintentar, en vez de mandarla vacia y descubrir el rechazo de
      // Google recien despues de gastar los intentos.
      const message = `TesisHub no pudo completar sola esta pregunta, respondela y reintenta: ${firstMissing.label}${suffix}`;
      showStatus(message, true);
      // Ademas del mensaje, se hace scroll y se resalta la pregunta en la
      // pagina: en un formulario largo o de varias paginas, saber el NOMBRE
      // de la pregunta no alcanza para encontrarla rapido.
      scrollToAndHighlight(firstMissing.container);
      recordDiagnostics({
        lastError: message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (settings.requireConfirmation) {
      const accepted = await showTesistabConfirmDialog({
        count,
        delayMs,
        csvRowsCount: csvRows.length,
      });
      if (!accepted) {
      showStatus('Ejecucion cancelada por el usuario.', true);
      recordDiagnostics({
        lastError: 'Ejecucion cancelada por el usuario.',
        updatedAt: new Date().toISOString(),
      });
      return;
    }
  }

    showStatus('Envio detectado. Creando job de TesisHub...');
    let payload = formDataToPayload(new FormData(form));
    payload = applyCsvRowIfAvailable(payload);
    payload = applySmartProfilePayload(payload, form, settings);
    const specialEntryKey = resolveSpecialEntryKey(form, settings.specialQuestionKeyword);
    const smartProfile = buildSmartProfileConfig(
      settings,
      specialEntryKey,
      collectEntryOptions(form),
      collectQuestionTextByEntry(form)
    );
    const formUrl = form.action;

    if (!formUrl) {
      showStatus('No se pudo leer la URL del formulario desde la pagina.', true);
      recordDiagnostics({
        lastError: 'No se pudo leer la URL del formulario desde la pagina.',
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (settings.compatApiMode) {
      await submitWithCompatApi(formUrl, payload, count);
      return;
    }

    const response = await backendRequest('/api/tesistab/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        formUrl,
        payload,
        count,
        delayMs,
        jitterMs,
        autoRandomizeText: Boolean(settings.autoRandomizeText),
        smartProfile,
        label: document.title,
      }),
    });

    const result = response.data;
    if (!response.ok) {
      throw new Error(extractErrorMessage(response));
    }

    const warning = result.warning ? ` (${result.warning})` : '';
    activeJobId = result.id;
    activeJobStatus = result.status || 'queued';
    activeJobProgressLabel = `0/${count}`;
    syncJobActionButtons();
    showStatus(`Job ${result.id.slice(0, 8)} creado${warning}.`);
    recordDiagnostics({
      lastJobId: result.id,
      lastJobStatus: result.status,
      lastError: '',
      updatedAt: new Date().toISOString(),
    });
    monitorJob(
      result.id,
      normalizeBackendUrl(settings.backendBaseUrl),
      count * (delayMs + jitterMs + 2_000)
    );
  } catch (error) {
    showStatus(error.message || 'Error desconocido al crear el job.', true);
    recordDiagnostics({
      lastError: error.message || 'Unknown error when creating job.',
      updatedAt: new Date().toISOString(),
    });
  } finally {
    isTesistabRunStarting = false;
    syncJobActionButtons();
  }
}

function subscribeToSettingsChanges() {
  if (subscribeToSettingsChanges.initialized) {
    return;
  }

  subscribeToSettingsChanges.initialized = true;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes[SETTINGS_KEY]?.newValue) {
      settings = {
        ...DEFAULT_SETTINGS,
        ...changes[SETTINGS_KEY].newValue,
      };
      injectStatusPill(settings.enabled);
      injectActionsPanel();
      applyThemeToInjectedUi();
      syncJobActionButtons();
    }

    if (changes[CSV_ROWS_KEY]) {
      const nextRows = Array.isArray(changes[CSV_ROWS_KEY].newValue) ? changes[CSV_ROWS_KEY].newValue : [];
      csvRows = nextRows;
      csvCursor = 0;
    }
  });
}

function isGoogleFormsSubmitTrigger(target) {
  const trigger = target.closest('button, input[type="submit"], div[role="button"]');
  if (!trigger) {
    return false;
  }

  if (
    trigger.closest('#tesistab-qa-actions') ||
    trigger.closest('#tesistab-qa-status') ||
    trigger.closest('#tesistab-qa-pill')
  ) {
    return false;
  }

  if (trigger.matches('input[type="submit"], button[type="submit"]')) {
    return true;
  }

  const text = String(trigger.textContent || '').toLowerCase();
  const ariaLabel = String(trigger.getAttribute('aria-label') || '').toLowerCase();
  const tooltip = String(trigger.getAttribute('data-tooltip') || '').toLowerCase();
  const marker = `${text} ${ariaLabel} ${tooltip}`;

  if (trigger.getAttribute('jsname') === 'M2UYVd') {
    return true;
  }

  return /(submit|enviar|send|kirim)/.test(marker);
}

// Escanea la pagina en busca de un boton "Siguiente" visible, SIN esperar a
// que el usuario lo clickee (a diferencia de isGoogleFormsNextTrigger, que
// solo reacciona a un click). Se usa para bloquear "Iniciar" de entrada
// cuando la pagina actual no es la ultima del formulario.
function findNextPageButton(form) {
  const scope = form instanceof HTMLElement ? form : document;
  const candidates = scope.querySelectorAll('button, input[type="button"], div[role="button"]');

  for (const trigger of candidates) {
    if (
      trigger.closest('#tesistab-qa-actions') ||
      trigger.closest('#tesistab-qa-status') ||
      trigger.closest('#tesistab-qa-pill') ||
      trigger.closest('#tesistab-qa-confirm-overlay') ||
      !isElementInteractable(trigger)
    ) {
      continue;
    }

    const text = String(trigger.textContent || '').toLowerCase();
    const ariaLabel = String(trigger.getAttribute('aria-label') || '').toLowerCase();
    const marker = `${text} ${ariaLabel}`;

    if (/(next|siguiente|continuar|continue)/.test(marker)) {
      return trigger;
    }
  }

  return null;
}

function isGoogleFormsNextTrigger(target) {
  const trigger = target.closest('button, input[type="button"], div[role="button"]');
  if (!trigger) {
    return false;
  }

  if (
    trigger.closest('#tesistab-qa-status') ||
    trigger.closest('#tesistab-qa-pill')
  ) {
    return false;
  }

  const text = String(trigger.textContent || '').toLowerCase();
  const ariaLabel = String(trigger.getAttribute('aria-label') || '').toLowerCase();
  const tooltip = String(trigger.getAttribute('data-tooltip') || '').toLowerCase();
  const marker = `${text} ${ariaLabel} ${tooltip}`;

  return /(next|siguiente|continuar|continue)/.test(marker);
}

async function monitorJob(jobId, backendBaseUrl, expectedDurationMs = 0) {
  const pollEveryMs = 1200;
  // El presupuesto de espera escala con la corrida (count * delay) mas un
  // margen; el minimo conserva el comportamiento previo (~5 minutos).
  const budgetMs = Math.max(290_000, Number(expectedDurationMs) || 0) + 90_000;
  const maxPolls = Math.ceil(budgetMs / pollEveryMs);
  let transientErrors = 0;

  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollEveryMs);

    try {
      const response = await backendRequest(`/api/tesistab/jobs/${jobId}`, {
        baseUrl: backendBaseUrl,
      });

      if (!response.ok && [0, 429, 500, 502, 503, 504].includes(response.status)) {
        transientErrors += 1;
        if (transientErrors <= MAX_MONITOR_TRANSIENT_ERRORS) {
          showStatus(
            `Reintento ${transientErrors}/${MAX_MONITOR_TRANSIENT_ERRORS} para job ${jobId.slice(0, 8)}...`,
            true
          );
          continue;
        }
      }

      if (!response.ok) {
        clearActiveJobState(jobId);
        showStatus(`Job ${jobId.slice(0, 8)} no encontrado.`, true);
        recordDiagnostics({
          lastJobId: jobId,
          lastJobStatus: 'not_found',
          lastError: `Job ${jobId.slice(0, 8)} no encontrado.`,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      transientErrors = 0;
      const job = response.data?.job || response.data;
      const progress = `${job.sent + job.failed}/${job.count}`;
      activeJobProgressLabel = progress;

      if (job.status === 'running' || job.status === 'queued') {
        activeJobId = job.id;
        activeJobStatus = job.status;
        syncJobActionButtons();
        showStatus(`Job ${job.id.slice(0, 8)} en progreso ${progress}...`);
        recordDiagnostics({
          lastJobId: job.id,
          lastJobStatus: job.status,
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      const uncertainty = job.uncertain > 0 ? `, inciertos: ${job.uncertain}` : '';
      if (job.status === 'completed' || job.status === 'completed_with_errors') {
        const withErrors = job.failed > 0;
        const latestMessage = String(job.latestResult?.message || '').trim();
        const firstError = String(job.errors?.[0]?.message || '').trim();
        // latestMessage para un fallo HTTP es solo "HTTP 400": el servidor SI
        // captura el cuerpo real que Google devuelve (inspectGoogleResponse ->
        // preview, primeros 240 caracteres sin etiquetas HTML) pero antes se
        // descartaba aqui, dejando al usuario sin forma de saber POR QUE
        // Google rechazo la peticion (formulario cerrado, requiere inicio de
        // sesion, un campo obligatorio que ya no coincide, etc.).
        const preview = String(job.latestResult?.preview || '').trim();
        const baseDetail = latestMessage || firstError;
        const detail = preview && preview !== baseDetail
          ? `${baseDetail}${baseDetail ? ' — ' : ''}${preview}`
          : baseDetail;
        if (job.sent === 0 && job.failed > 0) {
          clearActiveJobState(job.id);
          showStatus(
            `Terminado con errores. Enviados: 0, fallidos: ${job.failed}. ${detail || 'Revisa restricciones o inicio de sesion.'}`,
            true
          );
          recordDiagnostics({
            lastJobId: job.id,
            lastJobStatus: job.status,
            lastError: detail || `failed=${job.failed}`,
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        clearActiveJobState(job.id);
        showStatus(
          `Terminado. Enviados: ${job.sent}/${job.count}, fallidos: ${job.failed}${uncertainty}${detail && withErrors ? `. ${detail}` : ''}.`,
          withErrors
        );
        recordDiagnostics({
          lastJobId: job.id,
          lastJobStatus: job.status,
          lastError: withErrors ? detail || `failed=${job.failed}` : '',
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      if (job.status === 'cancelled') {
        clearActiveJobState(job.id);
        showStatus(`Job cancelado en ${progress}.`, true);
        recordDiagnostics({
          lastJobId: job.id,
          lastJobStatus: job.status,
          lastError: 'Job cancelado',
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      showStatus(`Job finalizado: ${job.status}.`, job.failed > 0);
      clearActiveJobState(job.id);
      recordDiagnostics({
        lastJobId: job.id,
        lastJobStatus: job.status,
        lastError: job.failed > 0 ? `failed=${job.failed}` : '',
        updatedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      transientErrors += 1;
      if (transientErrors <= MAX_MONITOR_TRANSIENT_ERRORS) {
        showStatus(
          `Error temporal (${transientErrors}/${MAX_MONITOR_TRANSIENT_ERRORS}): ${error.message}`,
          true
        );
        continue;
      }

      showStatus(`Error al monitorear: ${error.message}`, true);
      clearActiveJobState(jobId);
      recordDiagnostics({
        lastJobId: jobId,
        lastJobStatus: 'monitor_error',
        lastError: error.message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
  }

  showStatus('Tiempo agotado al monitorear. Revisa logs del backend.', true);
  clearActiveJobState(jobId);
  recordDiagnostics({
    lastJobId: jobId,
    lastJobStatus: 'timeout',
    lastError: 'Tiempo agotado al monitorear. Revisa logs del backend.',
    updatedAt: new Date().toISOString(),
  });
}

function normalizeBackendUrl(value) {
  const input = String(value || DEFAULT_SETTINGS.backendBaseUrl).trim();
  const candidate = /^https?:\/\//i.test(input) ? input : `http://${input}`;

  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    return DEFAULT_SETTINGS.backendBaseUrl;
  }
}

function formDataToPayload(formData) {
  const payload = {};

  for (const [key, value] of formData.entries()) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      if (!Array.isArray(payload[key])) {
        payload[key] = [payload[key]];
      }
      payload[key].push(value);
      continue;
    }

    payload[key] = value;
  }

  return payload;
}

function injectStatusPill(enabled) {
  const existing = document.getElementById('tesistab-qa-pill');
  if (existing) {
    existing.className = enabled ? 'is-on' : 'is-off';
    existing.textContent = enabled ? 'TesisHub Forms: ON' : 'TesisHub Forms: OFF';
    existing.setAttribute('data-theme', resolveEffectiveThemeMode(settings.themeMode));
    return;
  }

  const pill = document.createElement('div');
  pill.id = 'tesistab-qa-pill';
  pill.className = enabled ? 'is-on' : 'is-off';
  pill.textContent = enabled ? 'TesisHub Forms: ON' : 'TesisHub Forms: OFF';
  pill.setAttribute('data-theme', resolveEffectiveThemeMode(settings.themeMode));
  document.documentElement.appendChild(pill);
}

function injectActionsPanel() {
  const existing = document.getElementById('tesistab-qa-actions');
  if (existing) {
    const existingCount = existing.querySelector('#tesistab-qa-count');
    if (existingCount instanceof HTMLInputElement && document.activeElement !== existingCount) {
      existingCount.value = String(clamp(Number(settings.submissionCount) || 1, 1, MAX_UI_SUBMISSIONS));
    }
    const existingProfile = existing.querySelector('#tesistab-qa-profile');
    if (existingProfile instanceof HTMLSelectElement) {
      existingProfile.value = normalizeInlineProfileType(settings.smartProfileType);
    }
    syncInlineDistributionControls(existing);
    syncInlineAdvancedControls(existing);
    syncPanelViewMode(existing);
    return;
  }

  const panel = document.createElement('div');
  panel.id = 'tesistab-qa-actions';
  panel.setAttribute('data-theme', resolveEffectiveThemeMode(settings.themeMode));

  const header = document.createElement('div');
  header.className = 'tesistab-qa-header';

  const title = document.createElement('div');
  title.className = 'tesistab-qa-title';
  setPanelLabel(title, 'send', 'Envios automaticos');

  const backendStatus = document.createElement('div');
  backendStatus.id = 'tesistab-qa-backend-status';
  backendStatus.className = 'is-checking';
  backendStatus.title = 'Verificando backend';
  backendStatus.setAttribute('aria-label', 'Verificando backend');

  const tutorialToggle = document.createElement('button');
  tutorialToggle.type = 'button';
  tutorialToggle.id = 'tesistab-qa-tutorial-toggle';
  tutorialToggle.textContent = '?';
  tutorialToggle.title = 'Como funciona';
  tutorialToggle.setAttribute('aria-label', 'Como funciona TesisHub Forms');
  tutorialToggle.onclick = () => {
    const banner = document.getElementById('tesistab-qa-tutorial');
    if (banner) {
      banner.hidden = !banner.hidden;
    }
  };

  header.append(title, tutorialToggle, backendStatus);

  // Se muestra sola la primera vez (persistido en chrome.storage, igual que
  // el resto de settings) y despues queda disponible con el "?" de arriba:
  // el panel no tiene ninguna explicacion de que hace "Iniciar" ni de que
  // pasa si no puede completar una pregunta sola, y el flujo automatico no
  // es obvio la primera vez que se ve (reportado en vivo probando el
  // llenado de un formulario real).
  const tutorialBanner = document.createElement('div');
  tutorialBanner.id = 'tesistab-qa-tutorial';
  tutorialBanner.hidden = Boolean(settings.hasSeenPanelTutorial);

  const tutorialText = document.createElement('p');
  tutorialText.textContent = 'TesisHub completa sola las preguntas que puede y manda '
    + '"Cantidad" respuestas con el tono de "Perfil". Si una pregunta no se puede '
    + 'completar sola, te lo avisa para que la respondas vos antes de reintentar '
    + 'con "Iniciar".';

  const tutorialDismiss = document.createElement('button');
  tutorialDismiss.type = 'button';
  tutorialDismiss.textContent = 'Entendido';
  tutorialDismiss.onclick = async () => {
    tutorialBanner.hidden = true;
    await markPanelTutorialSeen();
  };

  tutorialBanner.append(tutorialText, tutorialDismiss);

  const viewRow = document.createElement('label');
  viewRow.className = 'tesistab-qa-count-row';
  const viewLabel = document.createElement('span');
  viewLabel.replaceChildren(createHelpLabel('Vista', 'Simple muestra solo lo esencial. Avanzada muestra controles extra.'));
  const viewSelect = document.createElement('select');
  viewSelect.id = 'tesistab-qa-view-mode';
  viewSelect.innerHTML = [
    '<option value="simple">Simple</option>',
    '<option value="advanced">Avanzada</option>',
  ].join('');
  viewSelect.value = normalizePanelViewMode(settings.panelViewMode);
  viewSelect.addEventListener('change', () => saveInlinePanelViewMode(viewSelect));
  viewRow.append(viewLabel, viewSelect);

  const countRow = document.createElement('label');
  countRow.className = 'tesistab-qa-count-row';

  const countLabel = document.createElement('span');
  countLabel.replaceChildren(createHelpLabel('Cantidad', 'Numero de respuestas que se enviaran en esta corrida.'));

  const countInput = document.createElement('input');
  countInput.id = 'tesistab-qa-count';
  countInput.type = 'number';
  countInput.min = '1';
  countInput.max = String(MAX_UI_SUBMISSIONS);
  countInput.step = '1';
  countInput.value = String(clamp(Number(settings.submissionCount) || 1, 1, MAX_UI_SUBMISSIONS));
  countInput.addEventListener('change', () => saveInlineSubmissionCount(countInput));
  countInput.addEventListener('blur', () => saveInlineSubmissionCount(countInput));

  countRow.append(countLabel, countInput);

  const profileRow = document.createElement('label');
  profileRow.className = 'tesistab-qa-count-row';

  const profileLabel = document.createElement('span');
  profileLabel.replaceChildren(createHelpLabel('Perfil', 'Define el tono general de las respuestas tipo escala o Likert.'));

  const profileSelect = document.createElement('select');
  profileSelect.id = 'tesistab-qa-profile';
  profileSelect.innerHTML = [
    '<option value="favorable">Favorable</option>',
    '<option value="intermedio">Intermedio</option>',
    '<option value="desfavorable">Desfavorable</option>',
    '<option value="auto">Automatico</option>',
  ].join('');
  profileSelect.value = normalizeInlineProfileType(settings.smartProfileType);
  profileSelect.addEventListener('change', () => saveInlineProfileType(profileSelect));

  profileRow.append(profileLabel, profileSelect);

  const distributionPanel = document.createElement('details');
  distributionPanel.className = 'tesistab-qa-advanced';
  distributionPanel.dataset.panelSection = 'advanced';

  const distributionSummary = document.createElement('summary');
  setPanelLabel(distributionSummary, 'chart', 'Distribucion de perfil');
  distributionPanel.appendChild(distributionSummary);

  const distributionBody = document.createElement('div');
  distributionBody.className = 'tesistab-qa-advanced-body';

  const distributionModeRow = createInlineAdvancedToggle(
    'profileDistributionEnabled',
    'Usar porcentajes',
    Boolean(settings.profileDistributionEnabled)
  );

  const distributionGrid = document.createElement('div');
  distributionGrid.className = 'tesistab-qa-distribution-grid';
  distributionGrid.id = 'tesistab-qa-distribution-grid';
  distributionGrid.append(
    createInlineDistributionField('profileShareFavorable', 'Favorable %', settings.profileShareFavorable, 60),
    createInlineDistributionField('profileShareIntermedio', 'Intermedio %', settings.profileShareIntermedio, 25),
    createInlineDistributionField('profileShareDesfavorable', 'Desfavorable %', settings.profileShareDesfavorable, 15)
  );

  distributionBody.append(distributionModeRow, distributionGrid);
  distributionPanel.appendChild(distributionBody);

  const advancedPanel = document.createElement('details');
  advancedPanel.className = 'tesistab-qa-advanced';
  advancedPanel.dataset.panelSection = 'advanced';

  const advancedSummary = document.createElement('summary');
  setPanelLabel(advancedSummary, 'sliders', 'Opciones avanzadas');
  advancedPanel.appendChild(advancedSummary);

  const advancedBody = document.createElement('div');
  advancedBody.className = 'tesistab-qa-advanced-body';

  const advancedModeRow = createInlineAdvancedToggle(
    'advancedMode',
    'Activar demografia',
    Boolean(settings.advancedMode)
  );
  const advancedGenderRow = createInlineAdvancedToggle(
    'advancedGender',
    'Usar genero',
    Boolean(settings.advancedGender)
  );
  const advancedAgeRow = createInlineAdvancedToggle(
    'advancedAge',
    'Usar edad',
    Boolean(settings.advancedAge)
  );
  const advancedFrequencyRow = createInlineAdvancedToggle(
    'advancedFrequency',
    'Usar frecuencia',
    Boolean(settings.advancedFrequency)
  );
  const advancedPersonalityRow = createInlineAdvancedToggle(
    'advancedPersonality',
    'Usar personalidad',
    Boolean(settings.advancedPersonality)
  );

  advancedBody.append(
    advancedModeRow,
    advancedGenderRow,
    advancedAgeRow,
    advancedFrequencyRow,
    advancedPersonalityRow
  );
  advancedPanel.appendChild(advancedBody);

  const runTesistabBtn = document.createElement('button');
  runTesistabBtn.type = 'button';
  runTesistabBtn.id = 'tesistab-qa-run-btn';
  runTesistabBtn.className = 'tesistab-qa-main-action';
  const runMainLabel = document.createElement('span');
  runMainLabel.className = 'main-label';
  runMainLabel.textContent = 'Iniciar';
  const runHoverLabel = document.createElement('span');
  runHoverLabel.className = 'hover-label';
  runHoverLabel.textContent = 'Detener';
  runTesistabBtn.append(runMainLabel, runHoverLabel);
  runTesistabBtn.onclick = async () => {
    const running = Boolean(activeJobId && (activeJobStatus === 'queued' || activeJobStatus === 'running'));
    if (running) {
      await stopActiveTesistabJob();
      return;
    }

    const form = currentForm || document.querySelector('form');
    if (!form) {
      showStatus('Formulario no disponible para TesisHub.', true);
      return;
    }

    await startTesistabRun(form, null);
  };

  const randomizeBtn = document.createElement('button');
  randomizeBtn.type = 'button';
  randomizeBtn.textContent = 'Completar esta pagina';
  randomizeBtn.dataset.panelSection = 'advanced';
  randomizeBtn.onclick = () => {
    if (!currentForm) {
      showStatus('El formulario todavia no esta disponible.', true);
      return;
    }

    randomizeFormInputs(currentForm);
    showStatus('Se completaron respuestas en esta pagina.');
  };

  const importCsvBtn = document.createElement('button');
  importCsvBtn.type = 'button';
  importCsvBtn.textContent = 'Importar CSV';
  importCsvBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        const parsed = parseCsvRows(text);
        if (!parsed.length) {
          showStatus('El CSV no tiene filas de datos.', true);
          return;
        }

        csvRows = parsed;
        csvCursor = 0;
        await chrome.storage.local.set({ [CSV_ROWS_KEY]: parsed });
        showStatus(`CSV cargado: ${parsed.length} filas.`);
      } catch (error) {
        showStatus(`Error de CSV: ${error.message}`, true);
      }
    };

    input.click();
  };

  const clearCsvBtn = document.createElement('button');
  clearCsvBtn.type = 'button';
  clearCsvBtn.textContent = 'Limpiar CSV';
  clearCsvBtn.onclick = async () => {
    csvRows = [];
    csvCursor = 0;
    await chrome.storage.local.set({ [CSV_ROWS_KEY]: [] });
    showStatus('Datos CSV eliminados.');
  };

  const csvPanel = document.createElement('details');
  csvPanel.className = 'tesistab-qa-advanced';
  csvPanel.dataset.panelSection = 'advanced';

  const csvSummary = document.createElement('summary');
  setPanelLabel(csvSummary, 'file', 'Herramientas CSV');
  csvPanel.appendChild(csvSummary);

  const csvBody = document.createElement('div');
  csvBody.className = 'tesistab-qa-advanced-body';
  csvBody.append(importCsvBtn, clearCsvBtn);
  csvPanel.appendChild(csvBody);

  panel.append(
    header,
    tutorialBanner,
    viewRow,
    countRow,
    profileRow,
    distributionPanel,
    csvPanel,
    advancedPanel,
    randomizeBtn,
    runTesistabBtn
  );
  document.documentElement.appendChild(panel);
  syncInlineDistributionControls(panel);
  syncInlineAdvancedControls(panel);
  syncPanelViewMode(panel);
  syncJobActionButtons();
  startBackendHealthMonitor();
}

function createHelpLabel(text, helpText) {
  const fragment = document.createDocumentFragment();
  const labelText = document.createElement('span');
  labelText.textContent = text;
  const help = document.createElement('span');
  help.className = 'tesistab-qa-help';
  help.textContent = '?';
  help.title = helpText;
  help.setAttribute('aria-label', helpText);
  fragment.append(labelText, help);
  return fragment;
}

function setPanelLabel(element, iconKey, text) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.replaceChildren(createPanelIcon(iconKey), document.createTextNode(text));
}

function createPanelIcon(iconKey) {
  const span = document.createElement('span');
  span.className = 'tesistab-qa-icon';
  span.setAttribute('aria-hidden', 'true');

  const paths = {
    send: '<path d="M4 12h11"/><path d="M11 5l7 7-7 7"/><path d="M4 6h5"/><path d="M4 18h5"/>',
    chart: '<path d="M5 19V9"/><path d="M12 19V5"/><path d="M19 19v-8"/><path d="M3 19h18"/>',
    sliders: '<path d="M4 7h10"/><path d="M16 7h4"/><circle cx="14" cy="7" r="2"/><path d="M4 17h4"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/>',
    file: '<path d="M8 3h7l4 4v14H8z"/><path d="M15 3v5h5"/><path d="M11 13h5"/><path d="M11 17h5"/>',
  };

  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[iconKey] || paths.send}</svg>`;
  return span;
}

async function saveInlineSubmissionCount(input) {
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const raw = String(input.value || '').trim();
  const value = clamp(Number(raw) || 1, 1, MAX_UI_SUBMISSIONS);
  input.value = String(value);

  settings = {
    ...settings,
    submissionCount: value,
  };

  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const saved = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...saved,
      submissionCount: value,
    },
  });
}

async function markPanelTutorialSeen() {
  settings = { ...settings, hasSeenPanelTutorial: true };
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const saved = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...saved,
      hasSeenPanelTutorial: true,
    },
  });
}

async function saveInlinePanelViewMode(select) {
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  const value = normalizePanelViewMode(select.value);
  select.value = value;
  settings = {
    ...settings,
    panelViewMode: value,
  };

  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const saved = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...saved,
      panelViewMode: value,
    },
  });

  const panel = document.getElementById('tesistab-qa-actions');
  if (panel) {
    syncPanelViewMode(panel);
  }
}

function normalizePanelViewMode(value) {
  return String(value || '').toLowerCase() === 'advanced' ? 'advanced' : 'simple';
}

function syncPanelViewMode(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  const viewMode = normalizePanelViewMode(settings.panelViewMode);
  const select = container.querySelector('#tesistab-qa-view-mode');
  if (select instanceof HTMLSelectElement) {
    select.value = viewMode;
  }

  container.querySelectorAll('[data-panel-section="advanced"]').forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.hidden = viewMode !== 'advanced';
  });
}

async function saveInlineProfileType(select) {
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  const value = normalizeInlineProfileType(select.value);
  select.value = value;
  settings = {
    ...settings,
    smartProfileMode: true,
    smartProfileType: value,
  };

  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const saved = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...saved,
      smartProfileMode: true,
      smartProfileType: value,
    },
  });
}

function normalizeInlineProfileType(value) {
  const normalized = String(value || '').toLowerCase();
  if (
    normalized === 'favorable' ||
    normalized === 'intermedio' ||
    normalized === 'desfavorable' ||
    normalized === 'auto'
  ) {
    return normalized;
  }

  return DEFAULT_SETTINGS.smartProfileType;
}

function createInlineDistributionField(key, label, rawValue, fallback) {
  const wrapper = document.createElement('label');
  wrapper.className = 'tesistab-qa-count-row';
  wrapper.dataset.distributionKey = key;

  const text = document.createElement('span');
  text.textContent = label;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = String(clampPercent(rawValue, fallback));
  input.addEventListener('blur', () => saveInlineDistributionField(key, input));

  wrapper.append(text, input);
  return wrapper;
}

function syncInlineDistributionControls(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  const enabled = Boolean(settings.profileDistributionEnabled);
  const valueMap = {
    profileShareFavorable: clampPercent(settings.profileShareFavorable, 60),
    profileShareIntermedio: clampPercent(settings.profileShareIntermedio, 25),
    profileShareDesfavorable: clampPercent(settings.profileShareDesfavorable, 15),
  };

  container.querySelectorAll('[data-distribution-key]').forEach((row) => {
    if (!(row instanceof HTMLElement)) {
      return;
    }

    const key = row.dataset.distributionKey || '';
    const input = row.querySelector('input[type="number"]');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    input.value = String(valueMap[key] ?? 0);
    input.disabled = !enabled;
    row.classList.toggle('is-disabled', !enabled);
  });

  const distributionToggle = container.querySelector('[data-setting-key="profileDistributionEnabled"] input[type="checkbox"]');
  if (distributionToggle instanceof HTMLInputElement) {
    distributionToggle.checked = enabled;
  }
}

async function saveInlineDistributionField(key, input) {
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const fallbacks = {
    profileShareFavorable: 60,
    profileShareIntermedio: 25,
    profileShareDesfavorable: 15,
  };
  const value = clampPercent(input.value, fallbacks[key] ?? 0);
  input.value = String(value);
  settings = {
    ...settings,
    [key]: value,
  };

  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const saved = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...saved,
      [key]: value,
    },
  });
}

async function stopActiveTesistabJob() {
  if (!activeJobId || isCancellingJob) {
    return;
  }

  isCancellingJob = true;
  syncJobActionButtons();
  showStatus('Deteniendo envios...', true);

  const response = await backendRequest(`/api/tesistab/jobs/${activeJobId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    isCancellingJob = false;
    syncJobActionButtons();
    showStatus(extractErrorMessage(response) || 'No se pudo detener el job.', true);
    return;
  }

  activeJobStatus = 'cancelled';
  isCancellingJob = false;
  syncJobActionButtons();
  showStatus('Solicitud de cancelacion enviada.', true);
}

function createInlineAdvancedToggle(key, label, checked) {
  const row = document.createElement('label');
  row.className = 'tesistab-qa-toggle-row';
  row.dataset.settingKey = key;

  const text = document.createElement('span');
  text.textContent = label;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.addEventListener('change', () => saveInlineAdvancedOption(key, input.checked));

  row.append(text, input);
  return row;
}

function syncInlineAdvancedControls(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  const modeEnabled = Boolean(settings.advancedMode);
  container.querySelectorAll('.tesistab-qa-toggle-row').forEach((row) => {
    if (!(row instanceof HTMLElement)) {
      return;
    }

    const key = row.dataset.settingKey || '';
    const input = row.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    if (!key.startsWith('advanced')) {
      return;
    }

    input.checked = Boolean(settings[key]);
    if (key !== 'advancedMode') {
      input.disabled = !modeEnabled;
      row.classList.toggle('is-disabled', !modeEnabled);
    }
  });
}

async function saveInlineAdvancedOption(key, checked) {
  const allowedKeys = new Set([
    'profileDistributionEnabled',
    'advancedMode',
    'advancedGender',
    'advancedAge',
    'advancedFrequency',
    'advancedPersonality',
  ]);
  if (!allowedKeys.has(key)) {
    return;
  }

  const nextSettings = {
    ...settings,
    [key]: Boolean(checked),
  };

  if (key === 'profileDistributionEnabled') {
    if (checked) {
      nextSettings.smartProfileMode = true;
    }
    settings = nextSettings;

    const result = await chrome.storage.local.get([SETTINGS_KEY]);
    const saved = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...saved,
        smartProfileMode: checked ? true : Boolean(saved.smartProfileMode),
        profileDistributionEnabled: Boolean(nextSettings.profileDistributionEnabled),
      },
    });

    const panel = document.getElementById('tesistab-qa-actions');
    if (panel) {
      syncInlineDistributionControls(panel);
    }
    return;
  }

  if (key !== 'advancedMode' && checked) {
    nextSettings.advancedMode = true;
  }

  if (key === 'advancedMode' && !checked) {
    nextSettings.advancedGender = false;
    nextSettings.advancedAge = false;
    nextSettings.advancedFrequency = false;
    nextSettings.advancedPersonality = false;
  }

  settings = nextSettings;

  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const saved = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...saved,
      advancedMode: Boolean(nextSettings.advancedMode),
      advancedGender: Boolean(nextSettings.advancedGender),
      advancedAge: Boolean(nextSettings.advancedAge),
      advancedFrequency: Boolean(nextSettings.advancedFrequency),
      advancedPersonality: Boolean(nextSettings.advancedPersonality),
    },
  });

  const panel = document.getElementById('tesistab-qa-actions');
  if (panel) {
    syncInlineAdvancedControls(panel);
  }
}

function startBackendHealthMonitor() {
  if (backendHealthTimer) {
    return;
  }

  updateBackendHealthIndicator('checking', 'Verificando backend');
  checkBackendHealth();
  backendHealthTimer = window.setInterval(checkBackendHealth, BACKEND_HEALTH_INTERVAL_MS);
}

async function checkBackendHealth() {
  const indicator = document.getElementById('tesistab-qa-backend-status');
  if (!indicator) {
    if (backendHealthTimer) {
      window.clearInterval(backendHealthTimer);
      backendHealthTimer = null;
    }
    return;
  }

  updateBackendHealthIndicator('checking', 'Verificando backend');
  const response = await backendRequest('/api/tesistab/config', {
    method: 'GET',
  });

  if (response.ok) {
    updateBackendHealthIndicator('online', 'Backend conectado');
    return;
  }

  updateBackendHealthIndicator('offline', extractErrorMessage(response) || 'Backend no disponible');
}

function updateBackendHealthIndicator(state, title) {
  const indicator = document.getElementById('tesistab-qa-backend-status');
  if (!(indicator instanceof HTMLElement)) {
    return;
  }

  indicator.className = '';
  indicator.classList.add(state === 'online' ? 'is-online' : state === 'offline' ? 'is-offline' : 'is-checking');
  indicator.title = title || 'Estado backend';
  indicator.setAttribute('aria-label', title || 'Estado backend');
}

// Sesion bloqueada (auto-bloqueo del popup): hay cuenta y su expiracion paso.
function isSessionLocked(currentSettings) {
  if (!currentSettings.accountEmail) {
    return false;
  }
  const expiresAt = Number(currentSettings.sessionExpiresAt) || 0;
  return expiresAt > 0 && Date.now() >= expiresAt;
}

function normalizeThemeMode(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'dark' || normalized === 'system' ? normalized : 'light';
}

function applyThemeToInjectedUi() {
  const themeMode = resolveEffectiveThemeMode(settings.themeMode);
  ['tesistab-qa-pill', 'tesistab-qa-actions', 'tesistab-qa-status', 'tesistab-qa-confirm-overlay'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.setAttribute('data-theme', themeMode);
    }
  });
}

function resolveEffectiveThemeMode(themeMode) {
  const normalized = normalizeThemeMode(themeMode);
  if (normalized === 'system') {
    return systemThemeQuery.matches ? 'dark' : 'light';
  }

  return normalized;
}

function subscribeToSystemThemeChanges() {
  if (subscribeToSystemThemeChanges.initialized) {
    return;
  }

  subscribeToSystemThemeChanges.initialized = true;
  systemThemeQuery.addEventListener('change', () => {
    if (normalizeThemeMode(settings.themeMode) === 'system') {
      applyThemeToInjectedUi();
    }
  });
}

function showTesistabConfirmDialog(details) {
  const existing = document.getElementById('tesistab-qa-confirm-overlay');
  if (existing) {
    existing.remove();
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'tesistab-qa-confirm-overlay';
    overlay.setAttribute('data-theme', resolveEffectiveThemeMode(settings.themeMode));

    const dialog = document.createElement('div');
    dialog.id = 'tesistab-qa-confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'tesistab-qa-confirm-title');

    const title = document.createElement('h3');
    title.id = 'tesistab-qa-confirm-title';
    title.textContent = 'Confirmar envio automatico';

    const subtitle = document.createElement('p');
    subtitle.className = 'tesistab-qa-confirm-subtitle';
    subtitle.textContent = 'Revisa los datos antes de iniciar la corrida.';

    const detailsBox = document.createElement('div');
    detailsBox.className = 'tesistab-qa-confirm-details';
    detailsBox.append(
      createTesistabConfirmRow('Cantidad', String(details?.count || 1)),
      createTesistabConfirmRow('Espera', `${Number(details?.delayMs || 0)} ms`)
    );

    if (Number(details?.csvRowsCount || 0) > 0) {
      detailsBox.append(createTesistabConfirmRow('CSV', `${details.csvRowsCount} filas cargadas`));
    }

    const actions = document.createElement('div');
    actions.className = 'tesistab-qa-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary';
    cancelBtn.textContent = 'Cancelar';

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.textContent = 'Iniciar ahora';

    const cleanup = (accepted) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(Boolean(accepted));
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(false);
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });
    cancelBtn.onclick = () => cleanup(false);
    acceptBtn.onclick = () => cleanup(true);
    document.addEventListener('keydown', onKeyDown, true);

    actions.append(cancelBtn, acceptBtn);
    dialog.append(title, subtitle, detailsBox, actions);
    overlay.appendChild(dialog);
    document.documentElement.appendChild(overlay);
    acceptBtn.focus();
  });
}

function createTesistabConfirmRow(label, value) {
  const row = document.createElement('div');
  row.className = 'tesistab-qa-confirm-row';

  const labelNode = document.createElement('span');
  labelNode.className = 'label';
  labelNode.textContent = label;

  const valueNode = document.createElement('span');
  valueNode.className = 'value';
  valueNode.textContent = value;

  row.append(labelNode, valueNode);
  return row;
}

function syncJobActionButtons() {
  const runBtn = document.getElementById('tesistab-qa-run-btn');
  const running = Boolean(activeJobId && (activeJobStatus === 'queued' || activeJobStatus === 'running'));

  if (runBtn instanceof HTMLButtonElement) {
    runBtn.disabled = isTesistabRunStarting || isCancellingJob;
    runBtn.classList.toggle('is-running', running);
    runBtn.classList.toggle('is-stopping', isCancellingJob);
    const mainLabel = runBtn.querySelector('.main-label');
    const hoverLabel = runBtn.querySelector('.hover-label');
    if (mainLabel instanceof HTMLElement) {
      if (isCancellingJob) {
        mainLabel.textContent = 'Deteniendo...';
      } else if (isTesistabRunStarting) {
        mainLabel.textContent = 'Iniciando...';
      } else if (running) {
        mainLabel.textContent = activeJobProgressLabel || 'En progreso';
      } else {
        mainLabel.textContent = 'Iniciar';
      }
    }
    if (hoverLabel instanceof HTMLElement) {
      hoverLabel.textContent = running ? 'Detener' : 'Iniciar';
    }
  }
}

function clearActiveJobState(jobId) {
  if (jobId && activeJobId && jobId !== activeJobId) {
    return;
  }

  activeJobId = '';
  activeJobStatus = '';
  isCancellingJob = false;
  activeJobProgressLabel = '';
  syncJobActionButtons();
}

function showStatus(message, isError) {
  const previous = document.getElementById('tesistab-qa-status');
  if (previous) {
    previous.remove();
  }

  const status = document.createElement('div');
  status.id = 'tesistab-qa-status';
  status.className = isError ? 'is-error' : 'is-ok';
  status.textContent = message;
  status.setAttribute('data-theme', resolveEffectiveThemeMode(settings.themeMode));
  document.documentElement.appendChild(status);

  window.setTimeout(() => {
    status.remove();
  }, 5000);
}

async function submitWithCompatApi(formUrl, payload, count) {
  const backend = normalizeBackendUrl(settings.backendBaseUrl);
  const formId = crypto.randomUUID();

  await backendRequest('/api/forms', {
    baseUrl: backend,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ formId }),
  });

  const params = new URLSearchParams();
  params.append('url', formUrl);
  params.append('counter', String(count));
  params.append('fromExtensionBackground', 'true');
  params.append('formId', formId);

  for (const [name, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(name, String(item));
      }
      continue;
    }

    params.append(name, String(value));
  }

  const response = await backendRequest('/api/forms/submit', {
    baseUrl: backend,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
  if (!response.ok) {
    throw new Error(text || extractErrorMessage(response));
  }

  const match = text.match(/id=([a-f0-9-]+)/i);
  if (match?.[1]) {
    showStatus(`Compat job ${match[1].slice(0, 8)} created.`);
    monitorJob(match[1], backend);
  } else {
    showStatus('Compat submit sent.');
  }
}

function applyCsvRowIfAvailable(payload) {
  if (!csvRows.length) {
    return payload;
  }

  const row = csvRows[csvCursor % csvRows.length];
  csvCursor += 1;

  const merged = { ...payload };
  for (const [key, value] of Object.entries(row)) {
    merged[key] = value;
  }

  return merged;
}

function applySmartProfilePayload(payload, form, runtimeSettings) {
  if (!runtimeSettings?.smartProfileMode || !form) {
    return payload;
  }

  const output = { ...payload };
  const optionsByEntry = collectEntryOptions(form);
  const questionByEntry = collectQuestionTextByEntry(form);
  const distributionEnabled = Boolean(runtimeSettings?.profileDistributionEnabled);
  const profile = resolveSmartProfile(runtimeSettings.smartProfileType);
  const specialKeyword = normalizeText(runtimeSettings.specialQuestionKeyword || '');
  const specialPreferred = String(runtimeSettings.specialQuestionPreferred || '').trim();

  for (const [key, rawValue] of Object.entries(output)) {
    if (!/^entry\.\d+$/.test(key) || Array.isArray(rawValue)) {
      continue;
    }

    const value = String(rawValue || '');
    const questionText = questionByEntry.get(key) || '';
    const options = optionsByEntry.get(key) || [];

    if (specialKeyword && normalizeText(questionText).includes(specialKeyword) && specialPreferred) {
      output[key] = findBestOptionValue(options, specialPreferred) || specialPreferred;
      continue;
    }

    const currentScore = resolveLikertScore(value);
    const hasLikertOptions = options.some((option) => resolveLikertScore(option.value) > 0);
    if (!distributionEnabled && (currentScore > 0 || hasLikertOptions)) {
      const targetScore = pickLikertScore(profile);
      const pickedLikert = pickLikertValue(options, targetScore, value);
      if (pickedLikert) {
        output[key] = pickedLikert;
      }
    }
  }

  return output;
}

function buildSmartProfileConfig(runtimeSettings, specialEntryKey, optionsByEntry, questionByEntry) {
  const entryMeta = {};
  if (optionsByEntry instanceof Map || questionByEntry instanceof Map) {
    const keys = new Set([
      ...Array.from(optionsByEntry instanceof Map ? optionsByEntry.keys() : []),
      ...Array.from(questionByEntry instanceof Map ? questionByEntry.keys() : []),
    ]);

    for (const entryKey of keys) {
      if (!/^entry\.\d+$/.test(entryKey || '')) {
        continue;
      }

      const question = String(
        questionByEntry instanceof Map ? questionByEntry.get(entryKey) || '' : ''
      )
        .trim()
        .slice(0, 240);
      const options = Array.from(
        new Set(
          (optionsByEntry instanceof Map ? optionsByEntry.get(entryKey) || [] : [])
            .map((item) => String(item?.value || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 24);

      if (!question && !options.length) {
        continue;
      }

      entryMeta[entryKey] = {
        question,
        options,
      };
    }
  }

  return {
    enabled: Boolean(runtimeSettings?.smartProfileMode),
    type: resolveSmartProfile(runtimeSettings?.smartProfileType),
    distribution: {
      enabled: Boolean(runtimeSettings?.profileDistributionEnabled),
      shares: {
        favorable: clampPercent(runtimeSettings?.profileShareFavorable, 60),
        intermedio: clampPercent(runtimeSettings?.profileShareIntermedio, 25),
        desfavorable: clampPercent(runtimeSettings?.profileShareDesfavorable, 15),
      },
    },
    specialEntryKey: specialEntryKey || '',
    specialPreferred: String(runtimeSettings?.specialQuestionPreferred || '').trim(),
    advanced: {
      mode: Boolean(runtimeSettings?.advancedMode),
      gender: Boolean(runtimeSettings?.advancedMode && runtimeSettings?.advancedGender),
      age: Boolean(runtimeSettings?.advancedMode && runtimeSettings?.advancedAge),
      frequency: Boolean(runtimeSettings?.advancedMode && runtimeSettings?.advancedFrequency),
      personality: Boolean(runtimeSettings?.advancedMode && runtimeSettings?.advancedPersonality),
    },
    entryMeta,
  };
}

function resolveSpecialEntryKey(form, keyword) {
  const normalizedKeyword = normalizeText(keyword || '');
  if (!normalizedKeyword || !form) {
    return '';
  }

  const questionByEntry = collectQuestionTextByEntry(form);
  for (const [entry, questionText] of questionByEntry.entries()) {
    if (normalizeText(questionText).includes(normalizedKeyword)) {
      return entry;
    }
  }

  return '';
}

function collectEntryOptions(form) {
  const map = new Map();
  const put = (name, value) => {
    if (!/^entry\.\d+$/.test(name || '') || !value) {
      return;
    }

    if (!map.has(name)) {
      map.set(name, []);
    }

    const list = map.get(name);
    if (!list.some((item) => item.value === value)) {
      list.push({ value });
    }
  };

  form.querySelectorAll('input[name^="entry."]').forEach((input) => {
    if (input.type === 'radio' || input.type === 'checkbox') {
      put(input.name, String(input.value || '').trim());
    }
  });

  form.querySelectorAll('select[name^="entry."]').forEach((select) => {
    Array.from(select.options).forEach((option) => {
      const value = String(option.value || option.textContent || '').trim();
      put(select.name, value);
    });
  });

  return map;
}

function collectQuestionTextByEntry(form) {
  const map = new Map();

  form.querySelectorAll('[name^="entry."]').forEach((element) => {
    const name = element.getAttribute('name');
    if (!/^entry\.\d+$/.test(name || '') || map.has(name)) {
      return;
    }

    const questionText = extractQuestionText(element);
    if (questionText) {
      map.set(name, questionText);
    }
  });

  return map;
}

function extractQuestionText(element) {
  const container = element.closest('[role="listitem"], .Qr7Oae, .geS5n');
  if (!container) {
    return '';
  }

  const title = container.querySelector('[role="heading"], .M7eMe, .HoXoMd, .zHQkBf');
  return String(title?.textContent || '').trim();
}

function resolveSmartProfile(value) {
  const selected = String(value || '').toLowerCase();
  if (selected === 'favorable' || selected === 'intermedio' || selected === 'desfavorable') {
    return selected;
  }

  if (selected === 'auto') {
    const roll = Math.random();
    if (roll < 0.6) {
      return 'favorable';
    }
    if (roll < 0.85) {
      return 'intermedio';
    }
    return 'desfavorable';
  }

  return 'favorable';
}

function pickLikertScore(profile) {
  const dominant = profile === 'desfavorable' ? 2 : profile === 'intermedio' ? 3 : 4;

  if (Math.random() < 0.8) {
    if (dominant === 4 && Math.random() < 0.35) {
      return 5;
    }
    if (dominant === 2 && Math.random() < 0.35) {
      return 1;
    }
    return dominant;
  }

  const delta = Math.random() < 0.5 ? -1 : 1;
  return clamp(dominant + delta, 1, 5);
}

function pickLikertValue(options, targetScore, fallbackValue) {
  const scored = (options || [])
    .map((option) => ({ value: option.value, score: resolveLikertScore(option.value) }))
    .filter((item) => item.score > 0);

  if (!scored.length) {
    return fallbackValue;
  }

  const exact = scored.filter((item) => item.score === targetScore);
  if (exact.length) {
    return exact[Math.floor(Math.random() * exact.length)].value;
  }

  scored.sort((a, b) => Math.abs(a.score - targetScore) - Math.abs(b.score - targetScore));
  return scored[0].value;
}

function resolveLikertScore(value) {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }

  if (
    text.includes('totalmente en desacuerdo') ||
    text.includes('muy en desacuerdo') ||
    text.includes('strongly disagree')
  ) {
    return 1;
  }

  if (text === 'en desacuerdo' || text.includes('disagree')) {
    return 2;
  }

  if (
    text.includes('ni de acuerdo ni en desacuerdo') ||
    text.includes('neutral') ||
    text.includes('ni en desacuerdo ni de acuerdo')
  ) {
    return 3;
  }

  if (text === 'de acuerdo' || text.includes('agree')) {
    return 4;
  }

  if (
    text.includes('totalmente de acuerdo') ||
    text.includes('muy de acuerdo') ||
    text.includes('strongly agree')
  ) {
    return 5;
  }

  return 0;
}

function looksLikeGenderField(questionText, value, options) {
  const joined = normalizeText(
    `${questionText || ''} ${value || ''} ${(options || []).map((opt) => opt.value).join(' ')}`
  );

  return (
    joined.includes('genero') ||
    joined.includes('sexo') ||
    joined.includes('gender') ||
    joined.includes('sex') ||
    joined.includes('male') ||
    joined.includes('female') ||
    joined.includes('hombre') ||
    joined.includes('mujer') ||
    joined.includes('masculino') ||
    joined.includes('femenino') ||
    joined.includes('identidad de genero')
  );
}

function pickGenderValue(options, fallbackValue) {
  const values = Array.from(
    new Set((options || []).map((option) => String(option.value || '').trim()).filter(Boolean))
  );
  if (!values.length) {
    return fallbackValue;
  }

  const current = normalizeText(fallbackValue);
  const pool = values.filter((value) => normalizeText(value) !== current);
  const source = pool.length ? pool : values;

  const categorized = {
    male: source.filter((value) => /masculino|male|hombre/i.test(value)),
    female: source.filter((value) => /femenino|female|mujer/i.test(value)),
    other: source.filter((value) => /otro|other|prefiero no/i.test(value)),
  };

  const roll = Math.random();
  if (roll < 0.48 && categorized.male.length) {
    return categorized.male[Math.floor(Math.random() * categorized.male.length)];
  }
  if (roll < 0.96 && categorized.female.length) {
    return categorized.female[Math.floor(Math.random() * categorized.female.length)];
  }
  if (categorized.other.length) {
    return categorized.other[Math.floor(Math.random() * categorized.other.length)];
  }

  return source[Math.floor(Math.random() * source.length)] || fallbackValue;
}

function looksLikeAgeField(questionText, value, options) {
  const joined = normalizeText(
    `${questionText || ''} ${value || ''} ${(options || []).map((opt) => opt.value).join(' ')}`
  );

  return (
    joined.includes('edad') ||
    joined.includes('rango de edad') ||
    joined.includes('grupo de edad') ||
    joined.includes('age') ||
    joined.includes('years old') ||
    joined.includes('anos') ||
    joined.includes('anios') ||
    /\b\d{1,2}\s*-\s*\d{1,2}\b/.test(joined) ||
    /\b\d{1,2}\s*(a|to)\s*\d{1,2}\b/.test(joined) ||
    /\b(18|20|25|30|35|40|45|50|55|60)\b/.test(joined)
  );
}

function looksLikePersonalityField(questionText, value, options) {
  const joined = normalizeText(
    `${questionText || ''} ${value || ''} ${(options || []).map((opt) => opt.value).join(' ')}`
  );

  return (
    joined.includes('personalidad') ||
    joined.includes('personality') ||
    joined.includes('temperamento') ||
    joined.includes('caracter') ||
    joined.includes('introvert') ||
    joined.includes('extrovert') ||
    joined.includes('mbti') ||
    joined.includes('eneagrama') ||
    joined.includes('enneagram') ||
    joined.includes('big five')
  );
}

function pickPersonalityValue(options, fallbackValue) {
  const values = Array.from(
    new Set(
      (options || [])
        .map((option) => String(option.value || '').trim())
        .filter((value) => value && !/^seleccione|select/i.test(value))
    )
  );

  if (values.length) {
    const current = normalizeText(fallbackValue);
    const pool = values.filter((value) => normalizeText(value) !== current);
    const source = pool.length ? pool : values;
    return source[Math.floor(Math.random() * source.length)];
  }

  const fallback = String(fallbackValue || '').trim();
  if (!fallback) {
    return fallbackValue;
  }

  const splitBy = fallback.split(/\s*[,/|]\s*/).map((part) => part.trim()).filter(Boolean);
  if (splitBy.length > 1) {
    return splitBy[Math.floor(Math.random() * splitBy.length)];
  }

  return fallbackValue;
}

function pickRandomOptionValue(options, fallbackValue) {
  const values = Array.from(
    new Set(
      (options || [])
        .map((option) => String(option.value || '').trim())
        .filter((value) => value && !/^seleccione|select/i.test(value))
    )
  );

  if (!values.length) {
    return fallbackValue;
  }

  const current = normalizeText(fallbackValue);
  const pool = values.filter((value) => normalizeText(value) !== current);
  const source = pool.length ? pool : values;

  return source[Math.floor(Math.random() * source.length)];
}

function findBestOptionValue(options, targetText) {
  const target = normalizeText(targetText);
  if (!target) {
    return '';
  }

  const values = (options || []).map((option) => String(option.value || '').trim()).filter(Boolean);
  const exact = values.find((value) => normalizeText(value) === target);
  if (exact) {
    return exact;
  }

  const partial = values.find((value) => normalizeText(value).includes(target));
  return partial || '';
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveEventElementTarget(event) {
  const target = event?.target;
  if (target instanceof Element) {
    return target;
  }

  if (target && target.nodeType === Node.TEXT_NODE) {
    return target.parentElement;
  }

  return null;
}

function parseCsvRows(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) {
        continue;
      }
      row[header] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current.trim());
  return out;
}

function randomizeFormInputs(form) {
  const textLike = form.querySelectorAll('input[type="text"], input[type="email"], input[type="number"], textarea');
  textLike.forEach((input) => {
    if (input.disabled || input.readOnly) {
      return;
    }

    if (input.type === 'email') {
      input.value = `tesistab_${randomToken(6)}@example.test`;
    } else if (input.type === 'number') {
      input.value = String(Math.floor(Math.random() * 10) + 1);
    } else {
      input.value = `TESISTAB ${randomToken(6)}`;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const radioGroups = new Map();
  form.querySelectorAll('input[type="radio"]').forEach((radio) => {
    if (!radio.name || radio.disabled) {
      return;
    }
    if (!radioGroups.has(radio.name)) {
      radioGroups.set(radio.name, []);
    }
    radioGroups.get(radio.name).push(radio);
  });

  radioGroups.forEach((group) => {
    // shuffled().some(tryCheckOption): igual que en fillEntryGroup, prueba
    // opciones hasta que una se CONFIRME marcada (via .click() real primero,
    // checked+eventos sinteticos como respaldo) en vez de asumir que la
    // primera elegida funciono sin verificarlo.
    shuffled(group).some((candidate) => tryCheckOption(candidate));
  });

  form.querySelectorAll('select').forEach((select) => {
    if (select.disabled || !select.options.length) {
      return;
    }

    const option = pickSelectableOption(Array.from(select.options));
    if (!option) {
      return;
    }

    option.selected = true;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// Lleva la vista a la pregunta que no se pudo completar sola y la resalta
// unos segundos. En un formulario largo (o de varias paginas: todas las
// preguntas viven en el mismo <form>, aunque solo una se vea a la vez) el
// mensaje de estado dice el NOMBRE de la pregunta, pero no ayuda a
// encontrarla rapido — esto la pone directamente frente al usuario.
function scrollToAndHighlight(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  container.classList.add('tesistab-qa-highlight');
  window.setTimeout(() => {
    container.classList.remove('tesistab-qa-highlight');
  }, 4000);
}

async function fillUnansweredFormInputs(form) {
  const groups = collectEntryGroups(form);
  let filled = 0;
  const missingRequired = [];
  // Preguntas cuyo input oculto Google todavia no creo (ver collectEntryGroups
  // / asyncCreate): se dispara UN click por pregunta aca abajo, sin verificar
  // nada todavia, y se juntan para esperar UNA sola vez al final. Verificar
  // pregunta por pregunta (click, esperar, click, esperar...) tardaria
  // ~2-3.5s POR PREGUNTA — con 24 preguntas Likert en una sola pagina, mas de
  // un minuto — cuando en la practica Google parece vaciar ese lote entero
  // de una vez, sin importar cuantas preguntas se hayan clickeado antes de
  // esperar (confirmado en vivo: 4 preguntas clickeadas seguidas aparecieron
  // las 4 juntas tras una sola espera de 3.5s).
  const pendingAsync = [];

  const reportMissing = (group) => {
    // Antes esto solo se reportaba si isQuestionRequired(group.container)
    // confirmaba que la pregunta era obligatoria (por texto "obligatoria" o
    // un atributo aria-required). Esa deteccion depende de como Google Forms
    // marque el requisito en el DOM en cada momento, y si el marcador no
    // coincide (o el contenedor no se encuentra, p.ej. Google cambio sus
    // clases CSS internas), el resultado era asumir "no es obligatoria" y
    // dejar pasar la pregunta vacia hasta que Google la rechazaba en el envio
    // real — gastando los intentos sin ningun aviso util (asi se reprodujo el
    // caso real: una escala lineal de 1 a 5 que nunca se pudo rellenar sola,
    // enviada igual, con 5 fallos HTTP 400 sin explicacion).
    //
    // Ahora cualquier pregunta que NO pudimos rellenar solos se reporta,
    // independientemente de si logramos confirmar que es obligatoria: el
    // costo de avisar de mas sobre una pregunta opcional (el usuario la
    // completa manualmente, o ignora el aviso y esta ya tenia otra respuesta)
    // es minimo comparado con enviar una base incompleta y quemar intentos
    // reales contra Google sin poder explicar por que fallaron.
    const label = extractQuestionText(group.container) || group.name || 'Pregunta sin titulo';
    const confirmedRequired = isQuestionRequired(group.container);
    missingRequired.push({
      label: confirmedRequired ? label : `${label} (no se pudo confirmar si es obligatoria)`,
      container: group.container || null,
    });
  };

  for (const group of groups.values()) {
    if (groupHasAnswer(group)) {
      continue;
    }

    if (group.asyncCreate) {
      const candidates = (group.options || []).filter((label) => isElementInteractable(label));
      if (!candidates.length) {
        reportMissing(group);
        continue;
      }
      candidates[Math.floor(Math.random() * candidates.length)].click();
      pendingAsync.push(group);
      continue;
    }

    const completed = fillEntryGroup(group);
    if (completed) {
      filled += 1;
      continue;
    }

    reportMissing(group);
  }

  if (pendingAsync.length) {
    const stillPending = await waitForAsyncWidgetGroups(pendingAsync);
    filled += pendingAsync.length - stillPending.length;
    stillPending.forEach(reportMissing);
  }

  return {
    filled,
    missingRequired,
  };
}

const ASYNC_WIDGET_POLL_INTERVAL_MS = 250;
const ASYNC_WIDGET_TIMEOUT_MS = 6000;

// Espera UNA sola vez (con polling corto, para salir apenas terminen en vez
// de siempre esperar el maximo) a que Google termine de crear/sincronizar
// los input ocultos de un lote de preguntas ya clickeadas. Devuelve las que
// siguen sin responder pasado el limite.
function waitForAsyncWidgetGroups(groups) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ASYNC_WIDGET_TIMEOUT_MS;

    const check = () => {
      const stillPending = groups.filter((group) => {
        const scope = group.container || document;
        const hiddenInput = scope.querySelector(`[name="${group.name}"]`);
        return !(hiddenInput && elementHasAnswer(hiddenInput));
      });

      if (!stillPending.length || Date.now() >= deadline) {
        resolve(stillPending);
        return;
      }

      window.setTimeout(check, ASYNC_WIDGET_POLL_INTERVAL_MS);
    };

    check();
  });
}

function collectEntryGroups(form) {
  const groups = new Map();

  form.querySelectorAll('[name^="entry."]').forEach((element) => {
    if (!(element instanceof HTMLElement) || element.disabled) {
      return;
    }

    const name = String(element.getAttribute('name') || '').trim();
    if (!/^entry\.\d+$/.test(name)) {
      return;
    }

    if (!groups.has(name)) {
      groups.set(name, {
        name,
        elements: [],
        options: null,
        container: element.closest('[role="listitem"], .Qr7Oae, .geS5n'),
      });
    }

    groups.get(name).elements.push(element);
  });

  // Google Forms mas reciente no pone `name="entry.X"` en el control VISIBLE
  // de opcion multiple/casillas: el usuario clickea un <label> sin ningun
  // input nativo adentro, y el propio JS de Google recien sincroniza el
  // valor a un <input type="hidden" name="entry.X"> aparte cuando detecta el
  // click real. Si el UNICO elemento que encontramos para ese name es ese
  // input oculto, no hay nada clickeable en `elements` — se buscan las
  // opciones reales (los <label>) dentro del mismo contenedor de la
  // pregunta, para que fillEntryGroup tenga algo que clickear de verdad en
  // vez de rendirse porque lo unico que ve esta oculto.
  groups.forEach((group) => {
    const onlyHidden = group.elements.every(
      (el) => el instanceof HTMLInputElement && el.type === 'hidden'
    );
    if (!onlyHidden || !group.container) {
      return;
    }

    const labels = Array.from(group.container.querySelectorAll('label'));
    if (labels.length) {
      group.options = labels;
    }
  });

  // Variante mas dificil del mismo problema: en algunas preguntas, el input
  // oculto real entry.X NI SIQUIERA EXISTE en el DOM todavia — Google solo
  // lo crea/rellena la primera vez que detecta un click real. Antes de eso
  // lo unico presente es su "_sentinel" (entry.X_sentinel), que YA se
  // ignoraba a proposito (no matchea /^entry\.\d+$/) porque no es una
  // pregunta real — pero es la unica pista que existe todavia de que ESA
  // pregunta esta ahi y sigue sin responder. Se agrupa por CONTENEDOR (no
  // por name, que todavia no existe), usando el sentinel solo para saber
  // cual seria el nombre real una vez que exista.
  const containersYaCubiertos = new Set(
    Array.from(groups.values()).map((g) => g.container).filter(Boolean)
  );
  form.querySelectorAll('[name$="_sentinel"]').forEach((sentinel) => {
    const container = sentinel.closest('[role="listitem"], .Qr7Oae, .geS5n');
    if (!container || containersYaCubiertos.has(container)) {
      return;
    }
    containersYaCubiertos.add(container);

    const sentinelName = String(sentinel.getAttribute('name') || '').trim();
    const realName = sentinelName.replace(/_sentinel$/, '');
    if (!/^entry\.\d+$/.test(realName) || realName === sentinelName) {
      return;
    }

    const labels = Array.from(container.querySelectorAll('label'));
    if (!labels.length) {
      return;
    }

    groups.set(realName, {
      name: realName,
      elements: [],
      options: labels,
      container,
      // A diferencia del grupo de la pasada anterior (donde entry.X ya
      // existe, aunque vacio, y Google lo actualiza en el momento del
      // click), aca entry.X TODAVIA NO EXISTE — Google recien lo crea en un
      // ciclo propio de guardado (el mismo de "Borrador guardado"), medido
      // en vivo entre ~2 y ~3.5 segundos DESPUES del click, y compartido
      // entre varias preguntas a la vez. Este flag le dice a
      // fillUnansweredFormInputs que no puede verificar esta pregunta en el
      // momento del click: tiene que disparar el click y esperar despues,
      // junto con las demas preguntas iguales, no una por una.
      asyncCreate: true,
    });
  });

  return groups;
}

function groupHasAnswer(group) {
  return group.elements.some((element) => elementHasAnswer(element));
}

function elementHasAnswer(element) {
  if (!(element instanceof HTMLElement) || element.disabled) {
    return false;
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === 'radio' || element.type === 'checkbox') {
      return element.checked;
    }

    return String(element.value || '').trim() !== '';
  }

  if (element instanceof HTMLTextAreaElement) {
    return String(element.value || '').trim() !== '';
  }

  if (element instanceof HTMLSelectElement) {
    const selected = element.selectedOptions?.[0];
    return isSelectableOption(selected || null);
  }

  return false;
}

// Intenta CONFIRMAR una opcion de radio/checkbox, no solo "intentarlo una
// vez y asumir que funciono" (asi estaba antes: devolvia true sin verificar,
// asi que una pregunta que en realidad seguia sin responder se contaba como
// "rellenada" y se enviaba vacia igual). Primero .click() real — dispara
// mousedown/mouseup/click/change tal como un click humano, lo que Google
// Forms necesita cuando el control visible es un decorativo por encima del
// input nativo — y si eso no lo marca, cae al metodo anterior
// (checked + eventos sinteticos) como respaldo. Si ninguno de los dos
// confirma la respuesta, se prueba con OTRA opcion del grupo en vez de
// rendirse con la primera que fallo (reproducido con una escala lineal 1-5
// real: la primera opcion no siempre "prendia", la segunda si).
function tryCheckOption(candidate) {
  if (!(candidate instanceof HTMLInputElement)) {
    return false;
  }

  candidate.click();
  if (elementHasAnswer(candidate)) {
    return true;
  }

  candidate.checked = true;
  candidate.dispatchEvent(new Event('input', { bubbles: true }));
  candidate.dispatchEvent(new Event('change', { bubbles: true }));
  return elementHasAnswer(candidate);
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function fillEntryGroup(group) {
  if (group.options && group.options.length) {
    return fillCustomWidgetGroup(group);
  }

  const visibleElements = group.elements.filter((element) => isElementInteractable(element));
  if (!visibleElements.length) {
    return false;
  }

  const first = visibleElements[0];
  if (first instanceof HTMLInputElement) {
    if (first.type === 'radio' || first.type === 'checkbox') {
      return shuffled(visibleElements).some((candidate) => tryCheckOption(candidate));
    }

    return fillTextLikeInput(first);
  }

  if (first instanceof HTMLTextAreaElement) {
    first.value = `TESISTAB ${randomToken(6)}`;
    first.dispatchEvent(new Event('input', { bubbles: true }));
    first.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  if (first instanceof HTMLSelectElement) {
    const option = pickSelectableOption(Array.from(first.options));
    if (!option) {
      return false;
    }

    option.selected = true;
    first.dispatchEvent(new Event('input', { bubbles: true }));
    first.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  return false;
}

// Pregunta de opcion multiple/casillas de la Google Forms mas reciente: el
// unico elemento con name="entry.X" es el <input type="hidden"> que Google
// sincroniza solo, y group.options son los <label> visibles que el usuario
// clickearia de verdad (ver collectEntryGroups). Se clickea un <label> al
// azar y se CONFIRMA mirando si el input oculto paso a tener valor — clickear
// no alcanza si el JS de Google no llego a reaccionar, y sin esta
// verificacion se estaria dando por respondida una pregunta que en realidad
// sigue vacia (el mismo patron de tryCheckOption, pero mirando el input
// oculto en vez de .checked porque aqui no hay ningun input nativo visible).
function fillCustomWidgetGroup(group) {
  const candidates = group.options.filter((label) => isElementInteractable(label));
  if (!candidates.length) {
    return false;
  }

  for (const label of shuffled(candidates)) {
    label.click();
    // Se busca el input oculto DE NUEVO despues de cada click, en vez de
    // guardar una referencia de antes: en algunas preguntas el input
    // entry.X ni siquiera existe en el DOM hasta que Google detecta el
    // primer click real (antes de eso solo esta su "_sentinel"), asi que
    // no hay nada que guardar de antemano.
    const scope = group.container || document;
    const hiddenInput = scope.querySelector(`[name="${group.name}"]`);
    if (hiddenInput && elementHasAnswer(hiddenInput)) {
      return true;
    }
  }

  return false;
}

function fillTextLikeInput(input) {
  if (!(input instanceof HTMLInputElement) || input.disabled || input.readOnly) {
    return false;
  }

  if (input.type === 'email') {
    input.value = `tesistab_${randomToken(6)}@example.test`;
  } else if (input.type === 'number') {
    input.value = String(Math.floor(Math.random() * 10) + 1);
  } else if (input.type === 'date') {
    input.value = '2026-01-15';
  } else if (input.type === 'time') {
    input.value = '10:00';
  } else {
    input.value = `TESISTAB ${randomToken(6)}`;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function isElementInteractable(element) {
  if (!(element instanceof HTMLElement) || element.disabled) {
    return false;
  }

  if (element instanceof HTMLInputElement && element.type === 'hidden') {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  // Ya NO se exige getClientRects().length > 0: Google Forms suele dejar el
  // <input type="radio"/checkbox> nativo con tamaño 0 o superpuesto por un
  // decorativo estilizado encima (patron comun de accesibilidad: el control
  // real sigue siendo el input nativo, clickeable via JS, aunque no ocupe
  // espacio visual propio). Ese input pasaba display/visibility pero fallaba
  // este chequeo de tamaño, así que se descartaba como "no interactuable" y
  // fillEntryGroup nunca llegaba a intentar rellenarlo (reproducido con una
  // pregunta de escala lineal 1-5 real). display/visibility ya cubren el caso
  // que de verdad importa (elemento oculto de proposito, no solo sin tamaño).
  return true;
}

function isQuestionRequired(container) {
  if (!(container instanceof HTMLElement)) {
    return false;
  }

  const text = normalizeText(container.textContent || '');
  if (/obligatoria|required/.test(text)) {
    return true;
  }

  return Boolean(
    container.querySelector('[aria-label*="Required" i], [aria-label*="Obligatoria" i], [data-required="true"]')
  );
}

function pickSelectableOption(options) {
  const candidates = (options || []).filter((option) => isSelectableOption(option));
  if (!candidates.length) {
    return null;
  }

  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

function isSelectableOption(option) {
  if (!(option instanceof HTMLOptionElement) || option.disabled) {
    return false;
  }

  const text = normalizeText(option.textContent || option.value || '');
  const value = String(option.value || '').trim();
  if (!text || !value) {
    return false;
  }

  return !/^(seleccione|select|choose|elige|escoge)/.test(text);
}

function randomToken(length) {
  return Math.random().toString(36).slice(2, 2 + length);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampPercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(Math.round(numeric), 0, 100);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function backendRequest(path, options = {}) {
  const baseUrl = normalizeBackendUrl(options.baseUrl || settings.backendBaseUrl);
  const url = `${baseUrl}${path}`;
  const headers = {
    ...options.headers,
    ...getAuthHeaders(),
  };

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });

    const data = await readResponseBody(response);
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: null,
    };
  } catch (error) {
    const viaBackground = await sendBackgroundHttpRequest({
      url,
      method: options.method || 'GET',
      headers,
      body: options.body,
    });

    if (viaBackground) {
      return viaBackground;
    }

    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message || 'Network request failed',
    };
  }
}

async function readResponseBody(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

async function sendBackgroundHttpRequest(payload) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'tesistab_HTTP_REQUEST',
      payload,
    });

    if (!response || typeof response !== 'object') {
      return {
        ok: false,
        status: 0,
        data: null,
        error: 'Empty response from background request',
      };
    }

    return response;
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message || 'Failed to contact extension background',
    };
  }
}

function getAuthHeaders() {
  const apiKey = String(settings.apiKey || '').trim();
  if (!apiKey) {
    return {};
  }

  return {
    'X-API-Key': apiKey,
  };
}

function extractErrorMessage(response) {
  if (!response) {
    return 'Request failed';
  }

  if (response.error) {
    return response.error;
  }

  const data = response.data;
  if (data?.error?.message) {
    return data.error.message;
  }

  if (data?.message) {
    return data.message;
  }

  return 'Request failed';
}

async function recordDiagnostics(patch) {
  try {
    const result = await chrome.storage.local.get([DIAGNOSTICS_KEY]);
    await chrome.storage.local.set({
      [DIAGNOSTICS_KEY]: {
        ...(result[DIAGNOSTICS_KEY] || {}),
        ...patch,
      },
    });
  } catch (error) {
    // ignore diagnostics write failures
  }
}
