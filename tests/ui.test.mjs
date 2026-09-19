// notion-web-interface owns this file. See collaboration/CONTRACT.md and docs/research/interface.md.
// Regression tests for Codex round-1 review corrections to popup.js/options.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let importCounter = 0;

function readSrc(name) {
  return readFileSync(path.join(root, 'src', name), 'utf8');
}

function flush(times = 10) {
  return (async () => {
    for (let i = 0; i < times; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  })();
}

function fireEvent(window, node, type) {
  node.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
}

function createRouter(handlers) {
  const calls = [];
  const sendMessage = async (message) => {
    calls.push(message);
    const handler = handlers[message.type];
    if (!handler) return { ok: false, error: `no handler for ${message.type}` };
    return handler(message);
  };
  return {
    calls,
    runtime: { sendMessage, id: 'test-ext', getURL: (p) => `safari-web-extension://test/${p}` },
    permissions: { request: async () => true },
  };
}

async function loadPage({ html, jsFile, api, useChromeAlias = false }) {
  const dom = new JSDOM(html, { url: `https://notion-web-extension.invalid/${jsFile.replace('.js', '.html')}` });
  const { window } = dom;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Event: globalThis.Event,
    browser: globalThis.browser,
    chrome: globalThis.chrome,
  };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Event = window.Event;
  if (useChromeAlias) {
    delete globalThis.browser;
    globalThis.chrome = api;
  } else {
    globalThis.browser = api;
    delete globalThis.chrome;
  }
  importCounter += 1;
  const modUrl = new URL(`../src/${jsFile}?case=${importCounter}`, import.meta.url);
  await import(modUrl);
  await flush();
  return {
    window,
    document: window.document,
    cleanup() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.Event = previous.Event;
      if (previous.browser === undefined) delete globalThis.browser;
      else globalThis.browser = previous.browser;
      if (previous.chrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previous.chrome;
    },
  };
}

const baseClip = {
  title: '標題',
  summary: '摘要',
  url: 'https://example.com/a',
  text: '內文',
  warnings: [],
  images: [],
  keywords: [],
  source: 'article',
};

function baseSettings(overrides) {
  return {
    hasNotionToken: true,
    hasAiKey: false,
    dataSourceId: 'configured-source',
    mapping: {},
    includeImages: false,
    aiEnabled: false,
    aiModel: 'claude-haiku-4-5',
    ...overrides,
  };
}

test('popup falls back to chrome.* APIs when window.browser is undefined (alias regression)', async () => {
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings() }),
    CAPTURE: async () => ({ ok: true, clip: baseClip }),
  });
  const page = await loadPage({ html: readSrc('popup.html'), jsFile: 'popup.js', api, useChromeAlias: true });
  try {
    assert.equal(page.document.getElementById('titleInput').value, '標題');
    assert.equal(page.document.getElementById('clipForm').hidden, false);
    assert.equal(api.calls.some((c) => c.type === 'CAPTURE'), true);
  } finally {
    page.cleanup();
  }
});

test('a SAVE failure retry resubmits SAVE with current edits instead of re-running CAPTURE', async () => {
  let saveAttempt = 0;
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ dataSourceId: 'src' }) }),
    CAPTURE: async () => ({ ok: true, clip: baseClip }),
    SAVE: async (msg) => {
      saveAttempt += 1;
      if (saveAttempt === 1) return { ok: false, error: '暫時無法連線到 Notion。' };
      return { ok: true, page: { id: 'p1', url: 'https://notion.so/p1' }, __clipTitle: msg.clip.title };
    },
  });
  const page = await loadPage({ html: readSrc('popup.html'), jsFile: 'popup.js', api });
  try {
    const { document, window } = page;
    const titleInput = document.getElementById('titleInput');
    titleInput.value = '使用者編輯過的標題';
    fireEvent(window, titleInput, 'input');
    fireEvent(window, document.getElementById('clipForm'), 'submit');
    await flush();
    assert.equal(document.getElementById('errorBanner').hidden, false);
    assert.equal(api.calls.filter((c) => c.type === 'CAPTURE').length, 1);

    fireEvent(window, document.getElementById('retryButton'), 'click');
    await flush();

    assert.equal(
      api.calls.filter((c) => c.type === 'CAPTURE').length,
      1,
      'retry after a SAVE failure must not re-run CAPTURE',
    );
    const saveCalls = api.calls.filter((c) => c.type === 'SAVE');
    assert.equal(saveCalls.length, 2);
    assert.equal(saveCalls[1].clip.title, '使用者編輯過的標題', 'the edited title must survive the retry');
    assert.equal(document.getElementById('successBanner').hidden, false);
  } finally {
    page.cleanup();
  }
});

test('a CAPTURE failure still exposes an editable manual-entry form', async () => {
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings() }),
    CAPTURE: async () => ({ ok: false, error: '此頁面沒有可讀取的內容，請選取或貼上原文。' }),
  });
  const page = await loadPage({ html: readSrc('popup.html'), jsFile: 'popup.js', api });
  try {
    const { document, window } = page;
    assert.equal(document.getElementById('errorBanner').hidden, false);
    assert.equal(
      document.getElementById('clipForm').hidden,
      false,
      'manual entry form must stay visible after a capture failure',
    );
    const titleInput = document.getElementById('titleInput');
    assert.equal(titleInput.disabled, false);
    titleInput.value = '手動輸入的標題';
    fireEvent(window, titleInput, 'input');
    assert.equal(titleInput.value, '手動輸入的標題');
  } finally {
    page.cleanup();
  }
});

test('an over-limit title blocks save with an explicit message instead of silently truncating', async () => {
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ dataSourceId: 'src' }) }),
    CAPTURE: async () => ({ ok: true, clip: baseClip }),
    SAVE: async () => ({ ok: true, page: { id: 'p', url: 'https://notion.so/p' } }),
  });
  const page = await loadPage({ html: readSrc('popup.html'), jsFile: 'popup.js', api });
  try {
    const { document, window } = page;
    const longTitle = 'A'.repeat(81);
    const titleInput = document.getElementById('titleInput');
    titleInput.value = longTitle;
    fireEvent(window, titleInput, 'input');
    fireEvent(window, document.getElementById('clipForm'), 'submit');
    await flush();

    assert.equal(api.calls.some((c) => c.type === 'SAVE'), false, 'SAVE must not be called while over the limit');
    assert.equal(document.getElementById('errorBanner').hidden, false);
    assert.match(document.getElementById('errorMessage').textContent, /80/);
    assert.equal(titleInput.value.length, 81, 'the UI must not silently cut the value itself');
  } finally {
    page.cleanup();
  }
});

test('an in-flight AI request disables editing, recapture, and save until it resolves', async () => {
  let resolveRewrite;
  const rewritePromise = new Promise((resolve) => {
    resolveRewrite = resolve;
  });
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ dataSourceId: 'src', hasAiKey: true, aiEnabled: true }) }),
    CAPTURE: async () => ({ ok: true, clip: baseClip }),
    REWRITE: async () => rewritePromise,
  });
  const page = await loadPage({ html: readSrc('popup.html'), jsFile: 'popup.js', api });
  try {
    const { document, window } = page;
    assert.equal(document.getElementById('aiButton').hidden, false);
    fireEvent(window, document.getElementById('aiButton'), 'click');
    await flush(3);

    assert.equal(document.getElementById('titleInput').disabled, true);
    assert.equal(document.getElementById('recaptureButton').disabled, true);
    assert.equal(document.getElementById('saveButton').disabled, true);

    resolveRewrite({ ok: true, clip: { ...baseClip, title: 'AI 標題', aiUsed: true } });
    await flush();

    assert.equal(document.getElementById('titleInput').disabled, false);
    assert.equal(document.getElementById('titleInput').value, 'AI 標題');
  } finally {
    page.cleanup();
  }
});

test('options selectSource preserves the saved mapping on init but suggests fresh mapping on an explicit source switch', async () => {
  const savedMapping = { title: '自訂標題欄', summary: '', url: '', aiSummary: '', keywords: '', category: '', images: '' };
  const schemaSrc1 = { id: 'src-1', title: 'A', properties: { 自訂標題欄: { type: 'title' }, 建議標題: { type: 'title' } } };
  const schemaSrc2 = { id: 'src-2', title: 'B', properties: { 標題2: { type: 'title' } } };
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ dataSourceId: 'src-1', mapping: savedMapping }) }),
    NOTION_LIST: async () => ({ ok: true, sources: [{ id: 'src-1', name: '資料庫 A' }, { id: 'src-2', name: '資料庫 B' }] }),
    NOTION_SCHEMA: async (msg) => {
      if (msg.dataSourceId === 'src-1') {
        return { ok: true, schema: schemaSrc1, mapping: { title: '建議標題', summary: '', url: '', aiSummary: '', keywords: '', category: '', images: '' } };
      }
      return { ok: true, schema: schemaSrc2, mapping: { title: '標題2', summary: '', url: '', aiSummary: '', keywords: '', category: '', images: '' } };
    },
  });
  const page = await loadPage({ html: readSrc('options.html'), jsFile: 'options.js', api });
  try {
    const { document, window } = page;
    assert.equal(
      document.getElementById('mapping-title').value,
      '自訂標題欄',
      'init must keep the saved mapping, not the fresh suggestion',
    );

    const src2Button = document.querySelector('[data-id="src-2"]');
    assert.ok(src2Button, 'source list must render the second source');
    fireEvent(window, src2Button, 'click');
    await flush();

    assert.equal(
      document.getElementById('mapping-title').value,
      '標題2',
      'an explicit source switch must take the fresh suggestion',
    );
  } finally {
    page.cleanup();
  }
});

test('an intentionally unmapped saved field (empty string) is not overwritten by the schema suggestion on init', async () => {
  const savedMapping = { title: '自訂標題欄', summary: '', url: '', aiSummary: '', keywords: '', category: '', images: '' };
  const schema = { id: 'src-1', title: 'A', properties: { 自訂標題欄: { type: 'title' }, 摘要建議: { type: 'rich_text' } } };
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ dataSourceId: 'src-1', mapping: savedMapping }) }),
    NOTION_LIST: async () => ({ ok: true, sources: [{ id: 'src-1', name: 'A' }] }),
    NOTION_SCHEMA: async () => ({
      ok: true,
      schema,
      mapping: { title: '自訂標題欄', summary: '摘要建議', url: '', aiSummary: '', keywords: '', category: '', images: '' },
    }),
  });
  const page = await loadPage({ html: readSrc('options.html'), jsFile: 'options.js', api });
  try {
    const { document } = page;
    assert.equal(
      document.getElementById('mapping-summary').value,
      '',
      'an explicit saved empty mapping ("intentionally unmapped") must not be replaced by the schema suggestion',
    );
  } finally {
    page.cleanup();
  }
});

test('a NOTION_LIST failure during connect is not overwritten by a false success message', async () => {
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ hasNotionToken: false }) }),
    SETTINGS_SAVE: async () => ({ ok: true }),
    NOTION_LIST: async () => ({ ok: false, error: '權杖無效，請重新輸入。' }),
  });
  const page = await loadPage({ html: readSrc('options.html'), jsFile: 'options.js', api });
  try {
    const { document, window } = page;
    const tokenInput = document.getElementById('notionTokenInput');
    tokenInput.value = 'ntn_bad';
    fireEvent(window, tokenInput, 'input');
    fireEvent(window, document.getElementById('connectButton'), 'click');
    await flush();

    const status = document.getElementById('connectStatus');
    assert.equal(status.textContent, '權杖無效，請重新輸入。');
    assert.equal(status.classList.contains('status-error'), true);
    assert.equal(status.classList.contains('status-success'), false);
  } finally {
    page.cleanup();
  }
});

test('mapping two fields to the same Notion property is rejected before saving', async () => {
  const schema = { id: 'src-1', title: 'A', properties: { 標題: { type: 'title' }, 共用欄位: { type: 'rich_text' } } };
  const savedMapping = { title: '標題', summary: '共用欄位', aiSummary: '共用欄位', url: '', keywords: '', category: '', images: '' };
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ dataSourceId: 'src-1', mapping: savedMapping }) }),
    NOTION_LIST: async () => ({ ok: true, sources: [{ id: 'src-1', name: 'A' }] }),
    NOTION_SCHEMA: async () => ({ ok: true, schema, mapping: { title: '標題', summary: '', url: '', aiSummary: '', keywords: '', category: '', images: '' } }),
    SETTINGS_SAVE: async () => ({ ok: true }),
  });
  const page = await loadPage({ html: readSrc('options.html'), jsFile: 'options.js', api });
  try {
    const { document, window } = page;
    assert.equal(document.getElementById('mapping-summary').value, '共用欄位');
    assert.equal(document.getElementById('mapping-aiSummary').value, '共用欄位');

    fireEvent(window, document.getElementById('optionsForm'), 'submit');
    await flush();

    assert.equal(api.calls.some((c) => c.type === 'SETTINGS_SAVE'), false, 'duplicate mapping must block SETTINGS_SAVE');
    const status = document.getElementById('saveStatus');
    assert.match(status.textContent, /共用欄位/);
    assert.equal(status.classList.contains('status-error'), true);
  } finally {
    page.cleanup();
  }
});

test('connect aborts without listing sources when the Notion permission request is denied', async () => {
  const api = createRouter({
    SETTINGS_GET: async () => ({ ok: true, settings: baseSettings({ hasNotionToken: false }) }),
    NOTION_LIST: async () => ({ ok: true, sources: [{ id: 'x', name: 'X' }] }),
  });
  api.permissions.request = async () => false;
  const page = await loadPage({ html: readSrc('options.html'), jsFile: 'options.js', api });
  try {
    const { document, window } = page;
    fireEvent(window, document.getElementById('connectButton'), 'click');
    await flush();

    assert.equal(api.calls.some((c) => c.type === 'NOTION_LIST'), false, 'NOTION_LIST must not run when permission is denied');
    assert.match(document.getElementById('connectStatus').textContent, /授權/);
  } finally {
    page.cleanup();
  }
});
