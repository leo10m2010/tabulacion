chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    enabled: true,
    backendBaseUrl: 'http://localhost:5000',
    apiKey: '',
    themeMode: 'system',
    panelViewMode: 'simple',
    submissionCount: 5,
    smartProfileMode: true,
    smartProfileType: 'favorable',
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

  const { borangTesistabSettings } = await chrome.storage.local.get(['borangTesistabSettings']);
  await chrome.storage.local.set({
    borangTesistabSettings: {
      ...defaults,
      ...(borangTesistabSettings || {}),
    },
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'BORANG_HTTP_REQUEST') {
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
