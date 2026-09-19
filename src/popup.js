// Notion 剪存 — popup controller.
// Talks to background.js only through browser.runtime.sendMessage per collaboration/CONTRACT.md.
// Never uses innerHTML with page-derived text; all untrusted strings go through textContent/value.
// Never reads storage directly; background.js is the only holder of tokens.

const browserApi = globalThis.browser || globalThis.chrome;

const SOURCE_LABELS = {
  selection: '已選取文字',
  facebook: 'Facebook 貼文',
  article: '文章',
  metadata: '網頁資訊',
};

const LIMITS = { title: 80, summary: 600 };

const el = (id) => document.getElementById(id);

const nodes = {
  sourceChip: el('sourceChip'),
  setupBanner: el('setupBanner'),
  openOptionsButton: el('openOptionsButton'),
  loadingStatus: el('loadingStatus'),
  loadingText: el('loadingText'),
  errorBanner: el('errorBanner'),
  errorMessage: el('errorMessage'),
  partialLink: el('partialLink'),
  retryButton: el('retryButton'),
  clipForm: el('clipForm'),
  warningsBox: el('warningsBox'),
  warningsList: el('warningsList'),
  titleInput: el('titleInput'),
  titleCounter: el('titleCounter'),
  summaryInput: el('summaryInput'),
  summaryCounter: el('summaryCounter'),
  urlInput: el('urlInput'),
  keywordsInput: el('keywordsInput'),
  textInput: el('textInput'),
  imageSection: el('imageSection'),
  imageGallery: el('imageGallery'),
  aiButton: el('aiButton'),
  aiStatus: el('aiStatus'),
  recaptureButton: el('recaptureButton'),
  saveButton: el('saveButton'),
  duplicateBanner: el('duplicateBanner'),
  duplicateLink: el('duplicateLink'),
  forceSaveButton: el('forceSaveButton'),
  successBanner: el('successBanner'),
  successLink: el('successLink'),
  saveAnotherButton: el('saveAnotherButton'),
};

const EDITABLE_FIELDS = [
  nodes.titleInput,
  nodes.summaryInput,
  nodes.urlInput,
  nodes.keywordsInput,
  nodes.textInput,
];

const state = {
  clip: null,
  settings: null,
  saving: false,
  aiBusy: false,
  aiRequestId: 0,
  // 'capture' | 'save' — which operation the visible error banner belongs to,
  // so the retry button repeats that operation instead of discarding edits.
  errorContext: null,
  lastForce: false,
};

function sendMessage(type, payload) {
  return browserApi.runtime.sendMessage({ type, ...(payload || {}) });
}

function hide(node) {
  node.hidden = true;
}

function showOnly(node) {
  node.hidden = false;
}

function resetTransientBanners() {
  hide(nodes.errorBanner);
  hide(nodes.duplicateBanner);
  hide(nodes.successBanner);
}

function setButtonBusy(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

function renderSourceChip(source) {
  if (!source) {
    hide(nodes.sourceChip);
    return;
  }
  nodes.sourceChip.textContent = SOURCE_LABELS[source] || source;
  showOnly(nodes.sourceChip);
}

function renderWarnings(warnings) {
  nodes.warningsList.textContent = '';
  if (!warnings || warnings.length === 0) {
    hide(nodes.warningsBox);
    return;
  }
  for (const text of warnings) {
    const li = document.createElement('li');
    li.textContent = text;
    nodes.warningsList.appendChild(li);
  }
  showOnly(nodes.warningsBox);
}

function renderImages(images) {
  nodes.imageGallery.textContent = '';
  const includeImages = Boolean(state.settings && state.settings.includeImages);
  const list = Array.isArray(images) ? images.slice(0, 8) : [];
  if (!includeImages || list.length === 0) {
    hide(nodes.imageSection);
    return;
  }
  for (const src of list) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    nodes.imageGallery.appendChild(img);
  }
  showOnly(nodes.imageSection);
}

function updateCounter(counterNode, length, max) {
  counterNode.textContent = `${length} / ${max}`;
  counterNode.classList.toggle('over-limit', length > max);
}

function updateCounters() {
  updateCounter(nodes.titleCounter, nodes.titleInput.value.length, LIMITS.title);
  updateCounter(nodes.summaryCounter, nodes.summaryInput.value.length, LIMITS.summary);
}

function fillForm(clip) {
  nodes.titleInput.value = clip.title || '';
  nodes.summaryInput.value = clip.summary || '';
  nodes.urlInput.value = clip.url || '';
  nodes.textInput.value = clip.text || '';
  nodes.keywordsInput.value = Array.isArray(clip.keywords) ? clip.keywords.join(', ') : '';
  renderWarnings(clip.warnings);
  renderSourceChip(clip.source);
  renderImages(clip.images);
  updateCounters();
}

function collectClip() {
  const keywords = nodes.keywordsInput.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ...state.clip,
    title: nodes.titleInput.value.trim(),
    summary: nodes.summaryInput.value.trim(),
    url: nodes.urlInput.value.trim(),
    text: nodes.textInput.value,
    keywords,
  };
}

function showError(message, partialUrl, context) {
  resetTransientBanners();
  state.errorContext = context || null;
  nodes.errorMessage.textContent = message || '發生未預期的錯誤，請重試。';
  if (partialUrl) {
    nodes.partialLink.href = partialUrl;
    showOnly(nodes.partialLink);
  } else {
    hide(nodes.partialLink);
  }
  showOnly(nodes.errorBanner);
}

function showDuplicate(page) {
  resetTransientBanners();
  if (page && page.url) {
    nodes.duplicateLink.href = page.url;
    showOnly(nodes.duplicateLink);
  } else {
    hide(nodes.duplicateLink);
  }
  showOnly(nodes.duplicateBanner);
}

function showSuccess(page) {
  resetTransientBanners();
  if (page && page.url) {
    nodes.successLink.href = page.url;
    showOnly(nodes.successLink);
  } else {
    hide(nodes.successLink);
  }
  showOnly(nodes.successBanner);
}

function updateSetupBanner() {
  const configured = Boolean(state.settings && state.settings.hasNotionToken && state.settings.dataSourceId);
  nodes.setupBanner.hidden = configured;
  nodes.saveButton.disabled = !configured || state.aiBusy;
}

function updateAiButton() {
  const canUseAi = Boolean(
    state.settings && state.settings.aiEnabled && state.settings.hasAiKey,
  );
  nodes.aiButton.hidden = !canUseAi;
}

async function loadSettings() {
  try {
    const res = await sendMessage('SETTINGS_GET');
    if (res && res.ok) {
      state.settings = res.settings;
    }
  } catch (err) {
    // Settings are optional context for the popup UI; capture must still proceed.
    state.settings = state.settings || null;
  }
  updateSetupBanner();
  updateAiButton();
}

function useEmptyManualClip() {
  return { title: '', summary: '', url: '', text: '', keywords: [], warnings: [], images: [], source: '' };
}

async function runCapture() {
  resetTransientBanners();
  hide(nodes.clipForm);
  nodes.loadingText.textContent = '擷取中…';
  showOnly(nodes.loadingStatus);
  try {
    const res = await sendMessage('CAPTURE');
    hide(nodes.loadingStatus);
    if (!res || !res.ok) {
      // Capture failed: still expose an editable, empty form so the user can
      // enter title/url/text manually instead of being stuck on an error only.
      state.clip = useEmptyManualClip();
      fillForm(state.clip);
      showOnly(nodes.clipForm);
      showError(res ? res.error : '無法連線至擴充功能背景程式，請重新開啟彈出視窗。', res && res.partialUrl, 'capture');
      return;
    }
    state.clip = res.clip;
    fillForm(state.clip);
    showOnly(nodes.clipForm);
  } catch (err) {
    hide(nodes.loadingStatus);
    state.clip = useEmptyManualClip();
    fillForm(state.clip);
    showOnly(nodes.clipForm);
    showError('無法連線至擴充功能背景程式，請重新開啟彈出視窗。', undefined, 'capture');
  }
}

function setFormBusy(busy) {
  for (const field of EDITABLE_FIELDS) field.disabled = busy;
  nodes.recaptureButton.disabled = busy;
  updateSetupBanner();
  if (busy) nodes.saveButton.disabled = true;
}

async function requestAnthropicPermission() {
  if (!browserApi.permissions || typeof browserApi.permissions.request !== 'function') {
    // Older Safari / browsers without the permissions API: proceed without
    // an explicit grant rather than blocking the feature entirely.
    return true;
  }
  try {
    return await browserApi.permissions.request({ origins: ['https://api.anthropic.com/*'] });
  } catch (err) {
    return false;
  }
}

async function handleAiClick() {
  if (state.aiBusy || state.saving) return;
  state.aiBusy = true;
  nodes.aiButton.disabled = true;
  // Must be the first awaited call in this gesture-triggered handler so
  // Safari still treats the permission prompt as user-initiated.
  const granted = await requestAnthropicPermission();
  if (!granted) {
    state.aiBusy = false;
    nodes.aiButton.disabled = false;
    nodes.aiStatus.textContent = '需要授權存取 AI 服務網域才能使用此功能，請重試並允許權限請求。';
    return;
  }

  state.aiBusy = true;
  const requestId = ++state.aiRequestId;
  setButtonBusy(nodes.aiButton, true, 'AI 產生中…', '使用 AI 產生摘要與關鍵字');
  setFormBusy(true);
  nodes.aiStatus.textContent = '';
  try {
    const res = await sendMessage('REWRITE', { clip: collectClip() });
    if (requestId !== state.aiRequestId) {
      // A newer AI request (or a recapture) superseded this one; drop the
      // stale response instead of overwriting whatever the user has now.
      return;
    }
    if (!res || !res.ok) {
      nodes.aiStatus.textContent = res ? res.error : 'AI 產生失敗，請重試。';
      return;
    }
    state.clip = res.clip;
    fillForm(state.clip);
    nodes.aiStatus.textContent = 'AI 已更新摘要與關鍵字。';
  } catch (err) {
    if (requestId === state.aiRequestId) {
      nodes.aiStatus.textContent = '無法連線至擴充功能背景程式。';
    }
  } finally {
    if (requestId === state.aiRequestId) {
      state.aiBusy = false;
      setButtonBusy(nodes.aiButton, false, 'AI 產生中…', '使用 AI 產生摘要與關鍵字');
      setFormBusy(false);
    }
  }
}

async function performSave(force) {
  if (state.saving || state.aiBusy) return;
  const clip = collectClip();
  if (!clip.title) {
    showError('標題不可空白，請先填寫標題再儲存。', undefined, 'save');
    return;
  }
  if (clip.title.length > LIMITS.title) {
    showError(`標題超過 ${LIMITS.title} 字上限（目前 ${clip.title.length} 字），請縮短後再儲存，避免內容被系統截斷。`, undefined, 'save');
    return;
  }
  if (clip.summary.length > LIMITS.summary) {
    showError(`摘要超過 ${LIMITS.summary} 字上限（目前 ${clip.summary.length} 字），請縮短後再儲存，避免內容被系統截斷。`, undefined, 'save');
    return;
  }
  state.saving = true;
  state.lastForce = Boolean(force);
  setButtonBusy(nodes.saveButton, true, '儲存中…', '儲存到 Notion');
  try {
    const res = await sendMessage('SAVE', { clip, force: Boolean(force) });
    if (!res || !res.ok) {
      showError(res ? res.error : '儲存時發生未預期的錯誤，請重試。', res && res.partialUrl, 'save');
      return;
    }
    if (res.duplicate) {
      showDuplicate(res.page);
    } else {
      showSuccess(res.page);
    }
  } catch (err) {
    showError('無法連線至擴充功能背景程式，請重試。', undefined, 'save');
  } finally {
    state.saving = false;
    setButtonBusy(nodes.saveButton, false, '儲存中…', '儲存到 Notion');
  }
}

nodes.clipForm.addEventListener('submit', (event) => {
  event.preventDefault();
  performSave(false);
});

nodes.titleInput.addEventListener('input', updateCounters);
nodes.summaryInput.addEventListener('input', updateCounters);

nodes.forceSaveButton.addEventListener('click', () => {
  performSave(true);
});

nodes.recaptureButton.addEventListener('click', () => {
  runCapture();
});

nodes.retryButton.addEventListener('click', () => {
  // Retry repeats whichever operation actually failed: re-run CAPTURE only
  // when capture itself failed, otherwise retry SAVE and keep the user's
  // current edits instead of discarding them.
  if (state.errorContext === 'save') {
    performSave(state.lastForce);
  } else {
    runCapture();
  }
});

nodes.aiButton.addEventListener('click', () => {
  handleAiClick();
});

nodes.saveAnotherButton.addEventListener('click', () => {
  resetTransientBanners();
  showOnly(nodes.clipForm);
});

nodes.openOptionsButton.addEventListener('click', async () => {
  try {
    await sendMessage('OPEN_OPTIONS');
  } catch (err) {
    // If messaging fails there is nothing further the popup can do; the user
    // can still open the extension's options from Safari's extension settings.
  }
});

el('settingsButton').addEventListener('click', () => sendMessage('OPEN_OPTIONS'));

async function init() {
  await loadSettings();
  await runCapture();
}

init();
