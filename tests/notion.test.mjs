import test from 'node:test';
import assert from 'node:assert/strict';
import { NotionClient, NotionError, suggestMapping } from '../src/notion.js';

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headers[key] ?? null },
    json: async () => body,
  };
}

function makeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return handler(url, init, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const SCHEMA_PROPERTIES = {
  'New Project': { id: 't1', type: 'title' },
  摘要: { id: 's1', type: 'rich_text' },
  AI摘要: { id: 'a1', type: 'rich_text' },
  '~URL': { id: 'u1', type: 'url' },
  分類: { id: 'c1', type: 'select' },
  圖檔: { id: 'i1', type: 'files' },
  標籤: { id: 'k1', type: 'multi_select' },
};

// Root-verified live schema (fixture only — no real workspace/page IDs), per
// collaboration/CONTRACT.md "Codex verified update (review round 1)".
const VERIFIED_SCHEMA_PROPERTIES = {
  標題: { id: 'vt1', type: 'title' },
  摘要: { id: 'vs1', type: 'rich_text' },
  'AI 摘要': { id: 'va1', type: 'rich_text' },
  'AI 關鍵字': { id: 'vk1', type: 'rich_text' },
  URL: { id: 'vu1', type: 'url' },
  分類: { id: 'vc1', type: 'select' },
  圖檔: { id: 'vi1', type: 'files' },
  標籤: { id: 'vk2', type: 'multi_select' },
};

function baseClip(overrides = {}) {
  return {
    title: '測試標題',
    summary: '摘要內容',
    aiSummary: '',
    keywords: ['a', 'b'],
    url: 'https://example.com/post/123',
    text: 'line one\nline two',
    author: 'Alice',
    capturedAt: '2026-09-20T00:00:00.000Z',
    source: 'article',
    images: [],
    ...overrides,
  };
}

test('constructor requires a token', () => {
  assert.throws(() => new NotionClient({}), NotionError);
});

test('listDataSources paginates the search endpoint', async () => {
  const fetchImpl = makeFetch((url, init, callIndex) => {
    if (callIndex === 1) {
      return jsonResponse(200, {
        results: [{ id: 'ds1', title: [{ plain_text: 'First' }] }],
        has_more: true,
        next_cursor: 'cursor-2',
      });
    }
    return jsonResponse(200, { results: [{ id: 'ds2', title: [] }], has_more: false, next_cursor: null });
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const sources = await client.listDataSources();
  assert.deepEqual(sources, [
    { id: 'ds1', name: 'First' },
    { id: 'ds2', name: '(未命名)' },
  ]);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].body.start_cursor, 'cursor-2');
});

test('getSchema returns raw property shape keyed by name', async () => {
  const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'ds1', title: [{ plain_text: 'DB' }], properties: SCHEMA_PROPERTIES }));
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const schema = await client.getSchema('ds1');
  assert.equal(schema.title, 'DB');
  assert.equal(schema.properties['New Project'].type, 'title');
});

test('findByUrl returns null when no url property is mapped', async () => {
  const fetchImpl = makeFetch(() => {
    throw new Error('should not be called');
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const result = await client.findByUrl('ds1', '', 'https://example.com');
  assert.equal(result, null);
});

test('findByUrl skips trashed matches and paginates to find a live duplicate', async () => {
  const fetchImpl = makeFetch((url, init, callIndex) => {
    if (callIndex === 1) {
      return jsonResponse(200, {
        results: [{ id: 'trashed', url: 'https://notion.so/trashed', in_trash: true }],
        has_more: true,
        next_cursor: 'next',
      });
    }
    return jsonResponse(200, {
      results: [{ id: 'live', url: 'https://notion.so/live', in_trash: false }],
      has_more: false,
      next_cursor: null,
    });
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const result = await client.findByUrl('ds1', '~URL', 'https://example.com/post/123');
  assert.deepEqual(result, { id: 'live', url: 'https://notion.so/live' });
  assert.equal(fetchImpl.calls[0].body.filter.property, '~URL');
  assert.equal(fetchImpl.calls[0].body.filter.url.equals, 'https://example.com/post/123');
});

test('findByUrl retries a 429 with Retry-After before succeeding', async () => {
  const fetchImpl = makeFetch((url, init, callIndex) => {
    if (callIndex === 1) return jsonResponse(429, {}, { 'Retry-After': '0' });
    return jsonResponse(200, { results: [], has_more: false, next_cursor: null });
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const result = await client.findByUrl('ds1', '~URL', 'https://example.com');
  assert.equal(result, null);
  assert.equal(fetchImpl.calls.length, 2);
});

test('suggestMapping resolves known Chinese property names by type', () => {
  const mapping = suggestMapping(SCHEMA_PROPERTIES);
  assert.deepEqual(mapping, {
    title: 'New Project',
    summary: '摘要',
    url: '~URL',
    aiSummary: 'AI摘要',
    keywords: '標籤',
    category: '分類',
    images: '圖檔',
  });
});

test('suggestMapping falls back to any title-typed property and empty strings otherwise', () => {
  const mapping = suggestMapping({ Name: { type: 'title' }, Notes: { type: 'rich_text' } });
  assert.equal(mapping.title, 'Name');
  assert.equal(mapping.summary, '');
  assert.equal(mapping.images, '');
});

test('suggestMapping prefers the root-verified schema aliases (標題/AI 摘要/URL) and prefers AI 關鍵字 over 標籤 for keywords', () => {
  const mapping = suggestMapping(VERIFIED_SCHEMA_PROPERTIES);
  assert.deepEqual(mapping, {
    title: '標題',
    summary: '摘要',
    url: 'URL',
    aiSummary: 'AI 摘要',
    keywords: 'AI 關鍵字',
    category: '分類',
    images: '圖檔',
  });
});

test('createClip throws when title mapping is missing or mistyped', async () => {
  const fetchImpl = makeFetch(() => {
    throw new Error('should not be called');
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  await assert.rejects(
    () =>
      client.createClip({
        dataSourceId: 'ds1',
        schema: { properties: SCHEMA_PROPERTIES },
        mapping: { title: '' },
        clip: baseClip(),
      }),
    NotionError,
  );
});

test('createClip builds typed properties from a full mapping and respects the images opt-in gate', async () => {
  const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'page1', url: 'https://notion.so/page1' }));
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const mapping = { title: 'New Project', summary: '摘要', url: '~URL', aiSummary: 'AI摘要', keywords: '標籤', category: '分類', images: '圖檔' };
  const result = await client.createClip({
    dataSourceId: 'ds1',
    schema: { properties: SCHEMA_PROPERTIES },
    mapping,
    clip: baseClip(),
    includeImages: false,
  });
  assert.deepEqual(result, { id: 'page1', url: 'https://notion.so/page1' });
  const createBody = fetchImpl.calls[0].body;
  assert.equal(createBody.parent.data_source_id, 'ds1');
  assert.deepEqual(createBody.properties['New Project'].title[0].text.content, '測試標題');
  assert.deepEqual(createBody.properties['標籤'].multi_select, [{ name: 'a' }, { name: 'b' }]);
  assert.equal(createBody.properties['分類'], undefined, 'capture format must not mutate topical categories');
  assert.equal(createBody.properties['圖檔'], undefined, 'images must stay excluded when includeImages is false, even though it is mapped');
});

test('createClip rejects a configured-but-missing mapped property instead of silently omitting it (regression: review round 1 P1/P2)', async () => {
  const fetchImpl = makeFetch(() => {
    throw new Error('should not be called — validation must fail before any write');
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const mapping = { title: 'New Project', summary: '已刪除的欄位' };
  await assert.rejects(
    () => client.createClip({ dataSourceId: 'ds1', schema: { properties: SCHEMA_PROPERTIES }, mapping, clip: baseClip() }),
    (err) => {
      assert.ok(err instanceof NotionError);
      assert.equal(err.code, 'mapped_property_missing');
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('createClip rejects a configured-but-mistyped mapped property instead of silently omitting it (regression: review round 1 P1/P2)', async () => {
  const fetchImpl = makeFetch(() => {
    throw new Error('should not be called — validation must fail before any write');
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const badSchema = { properties: { ...SCHEMA_PROPERTIES, 摘要: { id: 's1', type: 'number' } } };
  const mapping = { title: 'New Project', summary: '摘要' };
  await assert.rejects(
    () => client.createClip({ dataSourceId: 'ds1', schema: badSchema, mapping, clip: baseClip() }),
    (err) => {
      assert.ok(err instanceof NotionError);
      assert.equal(err.code, 'mapped_property_type_mismatch');
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('createClip rejects mapping summary and aiSummary to the same property (regression: review round 1 P1)', async () => {
  const fetchImpl = makeFetch(() => {
    throw new Error('should not be called — duplicate mapping must be rejected before any write');
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const mapping = { title: 'New Project', summary: '摘要', aiSummary: '摘要' };
  await assert.rejects(
    () => client.createClip({ dataSourceId: 'ds1', schema: { properties: SCHEMA_PROPERTIES }, mapping, clip: baseClip() }),
    (err) => {
      assert.ok(err instanceof NotionError);
      assert.equal(err.code, 'duplicate_mapping');
      assert.ok(err.message.includes('摘要'));
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 0, 'an empty aiSummary must never be allowed to overwrite the real summary');
});

test('createClip writes local keywords honestly and only adds AI keywords when aiUsed is true', async () => {
  const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'page1', url: 'https://notion.so/page1' }));
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const mapping = { title: 'New Project', keywords: '標籤' };

  await client.createClip({
    dataSourceId: 'ds1',
    schema: { properties: SCHEMA_PROPERTIES },
    mapping,
    clip: baseClip({ keywords: ['local-a'], aiUsed: false, aiKeywords: ['ai-b'] }),
  });
  const notAiUsedBody = fetchImpl.calls[0].body;
  assert.deepEqual(notAiUsedBody.properties['標籤'].multi_select, [{ name: 'local-a' }]);

  await client.createClip({
    dataSourceId: 'ds1',
    schema: { properties: SCHEMA_PROPERTIES },
    mapping,
    clip: baseClip({ keywords: ['local-a'], aiUsed: true, aiKeywords: ['ai-b', 'local-a'] }),
  });
  const aiUsedBody = fetchImpl.calls[1].body;
  assert.deepEqual(aiUsedBody.properties['標籤'].multi_select, [{ name: 'local-a' }, { name: 'ai-b' }]);
});

test('createClip never sends images unless includeImages is explicitly true', async () => {
  const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'page1', url: 'https://notion.so/page1' }));
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const mapping = { title: 'New Project', images: '圖檔' };
  await client.createClip({
    dataSourceId: 'ds1',
    schema: { properties: SCHEMA_PROPERTIES },
    mapping,
    clip: baseClip({ images: ['https://example.com/a.png', 'javascript:alert(1)'] }),
    includeImages: true,
  });
  const createBody = fetchImpl.calls[0].body;
  assert.equal(createBody.properties['圖檔'].files.length, 1);
  assert.equal(createBody.properties['圖檔'].files[0].external.url, 'https://example.com/a.png');
});

test('createClip chunks long text into <=2000-char paragraph blocks and <=100-block requests, appending remainder', async () => {
  const longText = Array.from({ length: 250 }, (_, i) => `paragraph number ${i} `.repeat(80)).join('\n');
  const appendCalls = [];
  const fetchImpl = makeFetch((url, init) => {
    if (url.endsWith('/pages')) return jsonResponse(200, { id: 'page1', url: 'https://notion.so/page1' });
    if (url.includes('/blocks/page1/children')) {
      appendCalls.push(JSON.parse(init.body));
      return jsonResponse(200, { results: [] });
    }
    throw new Error(`unexpected url ${url}`);
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  const mapping = { title: 'New Project' };
  await client.createClip({
    dataSourceId: 'ds1',
    schema: { properties: SCHEMA_PROPERTIES },
    mapping,
    clip: baseClip({ text: longText, summary: '', url: '', author: '', capturedAt: '' }),
  });

  const createCall = fetchImpl.calls.find((c) => c.url.endsWith('/pages'));
  const allBlocks = [...createCall.body.children, ...appendCalls.flatMap((c) => c.children)];
  assert.ok(createCall.body.children.length <= 100);
  for (const call of appendCalls) assert.ok(call.children.length <= 100);
  for (const block of allBlocks) {
    for (const part of block.paragraph?.rich_text ?? block.heading_2?.rich_text ?? []) {
      assert.ok(part.text.content.length <= 2000, 'each rich text part must respect the 2000 char limit');
    }
  }
  assert.ok(appendCalls.length >= 1, 'long content must trigger at least one children-append call');
});

test('createClip reports a partial write with the page URL and does not retry the failed append', async () => {
  const longText = Array.from({ length: 250 }, (_, i) => `paragraph number ${i} `.repeat(80)).join('\n');
  let appendAttempts = 0;
  const fetchImpl = makeFetch((url) => {
    if (url.endsWith('/pages')) return jsonResponse(200, { id: 'page1', url: 'https://notion.so/page1' });
    if (url.includes('/blocks/page1/children')) {
      appendAttempts += 1;
      return jsonResponse(500, { message: 'boom' });
    }
    throw new Error(`unexpected url ${url}`);
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  await assert.rejects(
    () =>
      client.createClip({
        dataSourceId: 'ds1',
        schema: { properties: SCHEMA_PROPERTIES },
        mapping: { title: 'New Project' },
        clip: baseClip({ text: longText, summary: '', url: '', author: '', capturedAt: '' }),
      }),
    (err) => {
      assert.ok(err instanceof NotionError);
      assert.equal(err.partialUrl, 'https://notion.so/page1');
      assert.equal(err.partialPageId, 'page1');
      assert.ok(err.message.includes('https://notion.so/page1'));
      return true;
    },
  );
  assert.equal(appendAttempts, 1, 'a failed append must not be blindly retried');
});

test('createClip never blindly retries the initial page-create POST on failure', async () => {
  let createAttempts = 0;
  const fetchImpl = makeFetch((url) => {
    createAttempts += 1;
    return jsonResponse(500, { message: 'boom' });
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  await assert.rejects(() =>
    client.createClip({
      dataSourceId: 'ds1',
      schema: { properties: SCHEMA_PROPERTIES },
      mapping: { title: 'New Project' },
      clip: baseClip(),
    }),
  );
  assert.equal(createAttempts, 1);
});

test('createClip surfaces a network-error create failure as "check Notion before retrying", not "nothing saved" (regression: review round 1)', async () => {
  let createAttempts = 0;
  const fetchImpl = makeFetch(() => {
    createAttempts += 1;
    throw new Error('socket hang up');
  });
  const client = new NotionClient({ token: 'secret', fetchImpl });
  await assert.rejects(
    () =>
      client.createClip({
        dataSourceId: 'ds1',
        schema: { properties: SCHEMA_PROPERTIES },
        mapping: { title: 'New Project' },
        clip: baseClip(),
      }),
    (err) => {
      assert.ok(err instanceof NotionError);
      assert.equal(err.code, 'create_outcome_unknown');
      assert.ok(err.message.includes('Notion'), 'must tell the user to check Notion');
      assert.ok(!/沒有(儲存|建立)|尚未(儲存|建立)/.test(err.message), 'must not assert that nothing was saved when the outcome is unknown');
      return true;
    },
  );
  assert.equal(createAttempts, 1, 'an ambiguous create failure must not be blindly retried');
});

test('createClip surfaces a 5xx create failure as an unknown/ambiguous outcome too', async () => {
  const fetchImpl = makeFetch(() => jsonResponse(503, { message: 'temporarily unavailable' }));
  const client = new NotionClient({ token: 'secret', fetchImpl });
  await assert.rejects(
    () =>
      client.createClip({
        dataSourceId: 'ds1',
        schema: { properties: SCHEMA_PROPERTIES },
        mapping: { title: 'New Project' },
        clip: baseClip(),
      }),
    (err) => {
      assert.ok(err instanceof NotionError);
      assert.equal(err.code, 'create_outcome_unknown');
      assert.ok(err.message.includes('Notion'));
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 1, 'a 5xx create failure must not be blindly retried either');
});

test('error messages never leak the token', async () => {
  const fetchImpl = makeFetch(() => jsonResponse(401, { message: 'unauthorized' }));
  const client = new NotionClient({ token: 'super-secret-token', fetchImpl });
  await assert.rejects(() => client.getSchema('ds1'), (err) => {
    assert.ok(!err.message.includes('super-secret-token'));
    return true;
  });
});
