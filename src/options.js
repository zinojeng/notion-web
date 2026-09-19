// Notion 剪存 — options page controller.
// Talks to background.js only through browser.runtime.sendMessage per collaboration/CONTRACT.md.
// schema.properties shape confirmed with notion-web-notion (message notion-ack-003):
// an object keyed by property name, e.g. {"New Project": {id, type: "title", ...}}.
// Never uses innerHTML with page-/API-derived text; all untrusted strings go through textContent/value.
// Never reads storage directly; background.js is the only holder of tokens.

const browserApi = globalThis.browser || globalThis.chrome;

const DEFAULT_AI_MODEL = 'claude-haiku-4-5';

const MAPPING_FIELDS = [
  { key: 'title', label: '標題', types: ['title'] },
  { key: 'summary', label: '摘要', types: ['rich_text'] },
  { key: 'url', label: '網址', types: ['url'] },
  { key: 'aiSummary', label: 'AI 摘要', types: ['rich_text'] },
  { key: 'keywords', label: '關鍵字 / 標籤', types: ['multi_select', 'rich_text'] },
  { key: 'category', label: '分類', types: ['select', 'multi_select'] },
  { key: 'images', label: '圖檔', types: ['files'] },
];

const el = (id) => document.getElementById(id);

const nodes = {
  notionTokenInput: el('notionTokenInput'),
  clearTokenButton: el('clearTokenButton'),
  connectButton: el('connectButton'),
  connectStatus: el('connectStatus'),
  sourceSection: el('sourceSection'),
  sourceSearch: el('sourceSearch'),
  sourceList: el('sourceList'),
  mappingSection: el('mappingSection'),
  mappingTable: el('mappingTable'),
  includeImagesInput: el('includeImagesInput'),
  aiEnabledInput: el('aiEnabledInput'),
  aiKeyInput: el('aiKeyInput'),
  aiModelInput: el('aiModelInput'),
  optionsForm: el('optionsForm'),
  saveSettingsButton: el('saveSettingsButton'),
  saveStatus: el('saveStatus'),
};

const state = {
  settings: null,
  sources: [],
  dataSourceId: '',
  schema: null,
  mapping: {},
  saving: false,
};

let notionTokenTouched = false;
let aiKeyTouched = false;

function sendMessage(type, payload) {
  return browserApi.runtime.sendMessage({ type, ...(payload || {}) });
}

function showStatus(node, message, kind) {
  node.textContent = message;
  node.hidden = !message;
  node.classList.remove('status-error', 'status-success');
  if (kind) node.classList.add(`status-${kind}`);
}

function setButtonBusy(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

function propertyEntries(properties) {
  if (!properties) return [];
  if (Array.isArray(properties)) {
    return properties.map((prop) => [prop.name, prop]);
  }
  return Object.entries(properties);
}

function renderTokenPlaceholders() {
  const hasToken = Boolean(state.settings && state.settings.hasNotionToken);
  nodes.notionTokenInput.placeholder = hasToken ? '•••••••• 已設定' : 'ntn_…';
  const hasAiKey = Boolean(state.settings && state.settings.hasAiKey);
  nodes.aiKeyInput.placeholder = hasAiKey ? '•••••••• 已設定' : 'sk-…';
}

function renderSourceList() {
  const query = nodes.sourceSearch.value.trim().toLowerCase();
  nodes.sourceList.textContent = '';
  const filtered = state.sources.filter(
    (source) => !query || (source.name || '').toLowerCase().includes(query),
  );
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-item';
    li.textContent = state.sources.length === 0 ? '尚未列出任何資料來源。' : '找不到符合的資料來源。';
    nodes.sourceList.appendChild(li);
    return;
  }
  for (const source of filtered) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-item';
    button.textContent = source.name || source.id;
    button.dataset.id = source.id;
    button.setAttribute('aria-pressed', source.id === state.dataSourceId ? 'true' : 'false');
    // An explicit click is always treated as choosing a (possibly different)
    // source, so it gets the fresh server-suggested mapping, never the
    // previously saved one for a different data source.
    button.addEventListener('click', () => selectSource(source.id));
    li.appendChild(button);
    nodes.sourceList.appendChild(li);
  }
}

function renderMapping() {
  nodes.mappingTable.textContent = '';
  if (!state.schema) {
    nodes.mappingSection.hidden = true;
    return;
  }
  const entries = propertyEntries(state.schema.properties);
  for (const field of MAPPING_FIELDS) {
    const row = document.createElement('div');
    row.className = 'mapping-row';

    const label = document.createElement('label');
    const selectId = `mapping-${field.key}`;
    label.setAttribute('for', selectId);
    label.textContent = field.label;

    const select = document.createElement('select');
    select.id = selectId;
    select.name = field.key;

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '（不使用）';
    select.appendChild(emptyOption);

    const compatible = entries.filter(([, prop]) => field.types.includes(prop.type));
    for (const [name, prop] of compatible) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = `${name}（${prop.type}）`;
      select.appendChild(option);
    }

    const currentValue = state.mapping[field.key] || '';
    const currentIsCompatible = compatible.some(([name]) => name === currentValue);
    if (currentValue && !currentIsCompatible) {
      // Keep a previously saved mapping visible even if the live schema no
      // longer reports it as type-compatible, instead of silently dropping it.
      const staleOption = document.createElement('option');
      staleOption.value = currentValue;
      staleOption.textContent = `${currentValue}（型別可能已變更，請確認）`;
      select.appendChild(staleOption);
    }
    select.value = currentValue;

    row.appendChild(label);
    row.appendChild(select);
    nodes.mappingTable.appendChild(row);
  }
  nodes.mappingSection.hidden = false;
}

function collectMapping() {
  const mapping = {};
  for (const field of MAPPING_FIELDS) {
    const select = el(`mapping-${field.key}`);
    mapping[field.key] = select ? select.value : '';
  }
  return mapping;
}

function findDuplicateMappingConflict(mapping) {
  const seenBy = new Map();
  for (const field of MAPPING_FIELDS) {
    const value = mapping[field.key];
    if (!value) continue;
    if (seenBy.has(value)) {
      return { property: value, first: seenBy.get(value), second: field.label };
    }
    seenBy.set(value, field.label);
  }
  return null;
}

function mergeWithSavedMapping(serverMapping, savedMapping) {
  const merged = {};
  for (const field of MAPPING_FIELDS) {
    const suggested = serverMapping ? serverMapping[field.key] : '';
    const saved = savedMapping ? savedMapping[field.key] : undefined;
    // A saved mapping that already has this key — including an explicit ''
    // meaning "intentionally unmapped" — always wins over the suggestion.
    // Only an absent key (never saved, e.g. brand-new settings) falls back.
    merged[field.key] = typeof saved === 'string' ? saved : suggested || '';
  }
  return merged;
}

async function requestNotionPermission() {
  if (!browserApi.permissions || typeof browserApi.permissions.request !== 'function') {
    // Older Safari / browsers without the permissions API: proceed without
    // an explicit grant rather than blocking the feature entirely.
    return true;
  }
  try {
    return await browserApi.permissions.request({ origins: ['https://api.notion.com/*'] });
  } catch (err) {
    return false;
  }
}

async function listSources({ silent } = {}) {
  if (!silent) setButtonBusy(nodes.connectButton, true, '連線中…', '連線並列出資料來源');
  try {
    const res = await sendMessage('NOTION_LIST');
    if (!res || !res.ok) {
      showStatus(nodes.connectStatus, res ? res.error : '無法連線至擴充功能背景程式。', 'error');
      return false;
    }
    state.sources = res.sources || [];
    nodes.sourceSection.hidden = false;
    renderSourceList();
    return true;
  } catch (err) {
    showStatus(nodes.connectStatus, '無法連線至擴充功能背景程式，請重新整理設定頁面。', 'error');
    return false;
  } finally {
    if (!silent) setButtonBusy(nodes.connectButton, false, '連線中…', '連線並列出資料來源');
  }
}

async function selectSource(dataSourceId, { preserveSaved } = {}) {
  showStatus(nodes.connectStatus, '', null);
  try {
    const res = await sendMessage('NOTION_SCHEMA', { dataSourceId });
    if (!res || !res.ok) {
      showStatus(nodes.connectStatus, res ? res.error : '無法讀取資料庫欄位結構。', 'error');
      return;
    }
    state.dataSourceId = dataSourceId;
    state.schema = res.schema;
    // On initial page load for the already-saved data source, keep the
    // user's saved mapping; only an explicit new-source pick (preserveSaved
    // unset) takes the fresh server suggestion outright.
    state.mapping = preserveSaved
      ? mergeWithSavedMapping(res.mapping, state.settings && state.settings.mapping)
      : res.mapping || {};
    renderSourceList();
    renderMapping();
  } catch (err) {
    showStatus(nodes.connectStatus, '無法連線至擴充功能背景程式，請重新整理設定頁面。', 'error');
  }
}

nodes.notionTokenInput.addEventListener('input', () => {
  notionTokenTouched = true;
});

nodes.clearTokenButton.addEventListener('click', () => {
  nodes.notionTokenInput.value = '';
  notionTokenTouched = true;
});

nodes.aiKeyInput.addEventListener('input', () => {
  aiKeyTouched = true;
});

nodes.sourceSearch.addEventListener('input', () => {
  renderSourceList();
});

nodes.connectButton.addEventListener('click', async () => {
  showStatus(nodes.connectStatus, '', null);
  // Must be the first awaited call in this click handler so Safari still
  // treats the permission prompt as triggered by the user's gesture.
  const granted = await requestNotionPermission();
  if (!granted) {
    showStatus(nodes.connectStatus, '需要授權存取 Notion API 網域才能連線，請重試並允許權限請求。', 'error');
    return;
  }
  setButtonBusy(nodes.connectButton, true, '連線中…', '連線並列出資料來源');
  try {
    if (notionTokenTouched) {
      const saveRes = await sendMessage('SETTINGS_SAVE', {
        settings: { notionToken: nodes.notionTokenInput.value },
      });
      if (!saveRes || !saveRes.ok) {
        showStatus(nodes.connectStatus, saveRes ? saveRes.error : '儲存權杖失敗。', 'error');
        return;
      }
      notionTokenTouched = false;
      nodes.notionTokenInput.value = '';
      const fresh = await sendMessage('SETTINGS_GET');
      if (fresh?.ok) state.settings = fresh.settings;
      renderTokenPlaceholders();
    }
    const ok = await listSources({ silent: true });
    // listSources() already reported its own error status on failure; only
    // add a success message here instead of unconditionally overwriting it.
    if (ok) showStatus(nodes.connectStatus, `已找到 ${state.sources.length} 個資料來源。`, 'success');
  } catch (err) {
    showStatus(nodes.connectStatus, '無法連線至擴充功能背景程式，請重新整理設定頁面。', 'error');
  } finally {
    setButtonBusy(nodes.connectButton, false, '連線中…', '連線並列出資料來源');
  }
});

nodes.optionsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.saving) return;
  state.saving = true;
  setButtonBusy(nodes.saveSettingsButton, true, '儲存中…', '儲存設定');
  showStatus(nodes.saveStatus, '', null);
  try {
    const mapping = state.schema ? collectMapping() : state.mapping || {};
    const conflict = findDuplicateMappingConflict(mapping);
    if (conflict) {
      showStatus(
        nodes.saveStatus,
        `「${conflict.property}」不能同時對應到「${conflict.first}」與「${conflict.second}」，請為每個欄位選擇不同的 Notion 屬性。`,
        'error',
      );
      return;
    }

    const settings = {
      dataSourceId: state.dataSourceId || '',
      mapping,
      includeImages: nodes.includeImagesInput.checked,
      aiEnabled: nodes.aiEnabledInput.checked,
      aiModel: nodes.aiModelInput.value.trim() || DEFAULT_AI_MODEL,
    };
    if (notionTokenTouched) settings.notionToken = nodes.notionTokenInput.value;
    if (aiKeyTouched) settings.aiKey = nodes.aiKeyInput.value;

    const res = await sendMessage('SETTINGS_SAVE', { settings });
    if (!res || !res.ok) {
      showStatus(nodes.saveStatus, res ? res.error : '儲存設定失敗，請重試。', 'error');
      return;
    }
    notionTokenTouched = false;
    aiKeyTouched = false;
    nodes.notionTokenInput.value = '';
    nodes.aiKeyInput.value = '';
    const fresh = await sendMessage('SETTINGS_GET');
    if (fresh?.ok) state.settings = fresh.settings;
    state.mapping = mapping;
    renderTokenPlaceholders();
    showStatus(nodes.saveStatus, '設定已儲存。', 'success');
  } catch (err) {
    showStatus(nodes.saveStatus, '無法連線至擴充功能背景程式，請重試。', 'error');
  } finally {
    state.saving = false;
    setButtonBusy(nodes.saveSettingsButton, false, '儲存中…', '儲存設定');
  }
});

async function init() {
  try {
    const res = await sendMessage('SETTINGS_GET');
    if (res && res.ok) {
      state.settings = res.settings;
      renderTokenPlaceholders();
      nodes.includeImagesInput.checked = Boolean(state.settings.includeImages);
      nodes.aiEnabledInput.checked = Boolean(state.settings.aiEnabled);
      nodes.aiModelInput.value = state.settings.aiModel || DEFAULT_AI_MODEL;
      state.dataSourceId = state.settings.dataSourceId || '';
      state.mapping = state.settings.mapping || {};

      if (state.settings.hasNotionToken) {
        await listSources({ silent: true });
        if (state.dataSourceId) {
          await selectSource(state.dataSourceId, { preserveSaved: true });
        }
      }
    } else {
      renderTokenPlaceholders();
    }
  } catch (err) {
    showStatus(nodes.connectStatus, '無法讀取目前設定，請重新整理設定頁面。', 'error');
  }
}

init();
