const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const RICH_TEXT_MAX = 2000;
const BLOCK_CHUNK_MAX = 100;
const MULTI_SELECT_MAX = 100;
const FILES_MAX = 100;
const DEFAULT_TIMEOUT_MS = 20000;
const READ_MAX_ATTEMPTS = 3;
const MAX_QUERY_PAGES = 5;

const NAME_CANDIDATES = {
  title: ['標題', 'New Project'],
  summary: ['摘要', '摘要*'],
  aiSummary: ['AI 摘要', 'AI摘要'],
  keywords: ['AI 關鍵字', '標籤'],
  url: ['URL', '~URL'],
  category: ['分類'],
  images: ['圖檔'],
};

const TYPE_ALLOWED = {
  title: ['title'],
  summary: ['rich_text'],
  url: ['url'],
  aiSummary: ['rich_text'],
  keywords: ['multi_select', 'rich_text'],
  category: ['select', 'multi_select'],
  images: ['files'],
};

const SLOT_LABELS = {
  title: '標題',
  summary: '摘要',
  url: 'URL',
  aiSummary: 'AI 摘要',
  keywords: '關鍵字',
  category: '分類',
  images: '圖檔',
};

export class NotionError extends Error {
  constructor(message, { status, code, partialUrl, partialPageId, blocksWritten, blocksTotal } = {}) {
    super(message);
    this.name = 'NotionError';
    this.status = status;
    this.code = code;
    this.partialUrl = partialUrl;
    this.partialPageId = partialPageId;
    this.blocksWritten = blocksWritten;
    this.blocksTotal = blocksTotal;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  return Math.min(4000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
}

function mapErrorMessage(status, json) {
  if (status === 401) return 'Notion token 無效或已失效，請至設定重新輸入。';
  if (status === 403) return '此整合沒有存取該 Notion 資料來源的權限，請確認已將資料庫分享給整合。';
  if (status === 404) return '找不到指定的 Notion 資料來源或頁面，請確認設定中的來源是否仍存在。';
  if (status === 429) return 'Notion API 請求過於頻繁，請稍後再試。';
  if (typeof status === 'number' && status >= 500) return 'Notion 服務暫時發生錯誤，請稍後再試。';
  const detail = typeof json?.message === 'string' ? json.message : '未知錯誤';
  return `Notion API 發生錯誤（${status ?? 'network'}）：${detail}`;
}

function plainTextFromRichArray(richTextArray) {
  if (!Array.isArray(richTextArray)) return '';
  return richTextArray.map((part) => part?.plain_text ?? part?.text?.content ?? '').join('');
}

function richTextChunks(text) {
  const value = typeof text === 'string' ? text : '';
  if (!value) return [];
  const chunks = [];
  for (let i = 0; i < value.length; i += RICH_TEXT_MAX) {
    chunks.push({ type: 'text', text: { content: value.slice(i, i + RICH_TEXT_MAX) } });
  }
  return chunks;
}

function splitIntoTextBlockChunks(text) {
  const value = typeof text === 'string' ? text : '';
  if (!value) return [];
  const lines = value.split('\n');
  const chunks = [];
  let current = '';
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };
  for (const line of lines) {
    let remainingLine = line;
    while (remainingLine.length > RICH_TEXT_MAX) {
      flush();
      chunks.push(remainingLine.slice(0, RICH_TEXT_MAX));
      remainingLine = remainingLine.slice(RICH_TEXT_MAX);
    }
    const candidate = current.length > 0 ? `${current}\n${remainingLine}` : remainingLine;
    if (candidate.length > RICH_TEXT_MAX) {
      flush();
      current = remainingLine;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

function paragraphBlock(text) {
  return { type: 'paragraph', paragraph: { rich_text: richTextChunks(text) } };
}

function headingBlock(text) {
  return { type: 'heading_2', heading_2: { rich_text: richTextChunks(text) } };
}

function linkParagraphBlock(label, url) {
  return {
    type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: `${label}: ` } },
        { type: 'text', text: { content: url, link: { url } } },
      ],
    },
  };
}

function buildPageBlocks(clip) {
  const blocks = [];
  blocks.push(headingBlock('About this project'));
  if (clip.summary) blocks.push(paragraphBlock(clip.summary));
  if (clip.url) blocks.push(linkParagraphBlock('來源', clip.url));
  const metaParts = [];
  if (clip.author) metaParts.push(`作者: ${clip.author}`);
  if (clip.capturedAt) metaParts.push(`擷取時間: ${clip.capturedAt}`);
  if (metaParts.length > 0) blocks.push(paragraphBlock(metaParts.join(' · ')));
  blocks.push({ type: 'divider', divider: {} });
  blocks.push(headingBlock('原始內容全文'));
  for (const chunk of splitIntoTextBlockChunks(clip.text)) {
    blocks.push(paragraphBlock(chunk));
  }
  return blocks;
}

function assertNoDuplicateMappings(mapping) {
  const slotsByName = new Map();
  for (const [slot, name] of Object.entries(mapping || {})) {
    if (!name) continue;
    if (!slotsByName.has(name)) slotsByName.set(name, []);
    slotsByName.get(name).push(slot);
  }
  for (const [name, slots] of slotsByName) {
    if (slots.length > 1) {
      const labels = slots.map((slot) => SLOT_LABELS[slot] || slot).join('、');
      throw new NotionError(
        `設定中「${labels}」對應到同一個 Notion 屬性「${name}」，請至設定頁分別指定不同屬性，避免其中一個欄位覆寫另一個的內容。`,
        { code: 'duplicate_mapping' },
      );
    }
  }
}

function validateMappedProperty(properties, mapping, slot) {
  const name = mapping?.[slot];
  if (!name) return null;
  const label = SLOT_LABELS[slot] || slot;
  const prop = properties[name];
  if (!prop) {
    throw new NotionError(
      `設定中「${label}」對應的 Notion 屬性「${name}」已不存在，請至設定頁重新選擇對應的欄位。`,
      { code: 'mapped_property_missing' },
    );
  }
  if (!TYPE_ALLOWED[slot].includes(prop.type)) {
    throw new NotionError(
      `設定中「${label}」對應的 Notion 屬性「${name}」型別（${prop.type}）不相容，請至設定頁重新選擇對應的欄位。`,
      { code: 'mapped_property_type_mismatch' },
    );
  }
  return prop;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function request({ fetchImpl, token, path, method = 'GET', body, retryable = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const maxAttempts = retryable ? READ_MAX_ATTEMPTS : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let controller;
    let timer;
    if (typeof AbortController === 'function') {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    let response;
    try {
      response = await fetchImpl(`${NOTION_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastError = new NotionError('連線 Notion 逾時或網路錯誤，請確認網路連線後再試一次。', { code: 'network_error' });
      if (retryable && attempt < maxAttempts) {
        await delay(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }
    if (timer) clearTimeout(timer);

    if (response.status === 429 && retryable && attempt < maxAttempts) {
      const retryAfterHeader = typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null;
      const retryAfterSeconds = Number(retryAfterHeader);
      const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : backoffMs(attempt);
      await delay(waitMs);
      continue;
    }
    if (typeof response.status === 'number' && response.status >= 500 && retryable && attempt < maxAttempts) {
      await delay(backoffMs(attempt));
      continue;
    }

    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) {
      throw new NotionError(mapErrorMessage(response.status, json), { status: response.status, code: json?.code });
    }
    return json;
  }
  throw lastError;
}

export class NotionClient {
  constructor({ token, fetchImpl = fetch } = {}) {
    if (!token || typeof token !== 'string') {
      throw new NotionError('缺少 Notion token，請至設定頁輸入。', { code: 'missing_token' });
    }
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  #request(options) {
    return request({ fetchImpl: this.fetchImpl, token: this.token, ...options });
  }

  async listDataSources() {
    const sources = [];
    let cursor;
    for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
      const json = await this.#request({
        path: '/search',
        method: 'POST',
        retryable: true,
        body: {
          filter: { property: 'object', value: 'data_source' },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        },
      });
      for (const result of json?.results ?? []) {
        sources.push({ id: result.id, name: plainTextFromRichArray(result.title) || '(未命名)' });
      }
      if (!json?.has_more || !json?.next_cursor) break;
      cursor = json.next_cursor;
    }
    return sources;
  }

  async getSchema(dataSourceId) {
    const json = await this.#request({ path: `/data_sources/${dataSourceId}`, method: 'GET', retryable: true });
    return { id: json.id, title: plainTextFromRichArray(json.title), properties: json.properties ?? {} };
  }

  async findByUrl(dataSourceId, urlProperty, url) {
    if (!urlProperty || !url) return null;
    let cursor;
    for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
      const json = await this.#request({
        path: `/data_sources/${dataSourceId}/query`,
        method: 'POST',
        retryable: true,
        body: {
          filter: { property: urlProperty, url: { equals: url } },
          page_size: 10,
          ...(cursor ? { start_cursor: cursor } : {}),
        },
      });
      const match = (json?.results ?? []).find((page) => !page.in_trash && !page.archived);
      if (match) return { id: match.id, url: match.url };
      if (!json?.has_more || !json?.next_cursor) break;
      cursor = json.next_cursor;
    }
    return null;
  }

  async createClip({ dataSourceId, schema, mapping, clip, includeImages = false }) {
    assertNoDuplicateMappings(mapping);
    const properties = schema?.properties ?? {};

    const titleProp = mapping?.title;
    if (!titleProp || properties[titleProp]?.type !== 'title') {
      throw new NotionError('缺少標題欄位對應，請至設定頁重新選擇 Notion 屬性。', { code: 'missing_title_mapping' });
    }
    const notionProperties = {
      [titleProp]: { title: richTextChunks(clip.title || clip.url || '未命名剪輯') },
    };

    if (validateMappedProperty(properties, mapping, 'summary')) {
      notionProperties[mapping.summary] = { rich_text: richTextChunks(clip.summary || '') };
    }
    if (validateMappedProperty(properties, mapping, 'url')) {
      notionProperties[mapping.url] = { url: clip.url || null };
    }
    if (validateMappedProperty(properties, mapping, 'aiSummary')) {
      notionProperties[mapping.aiSummary] = { rich_text: richTextChunks(clip.aiSummary || '') };
    }
    const keywordsProp = validateMappedProperty(properties, mapping, 'keywords');
    if (keywordsProp) {
      const localKeywords = Array.isArray(clip.keywords) ? clip.keywords.filter(Boolean) : [];
      const aiKeywords = clip.aiUsed && Array.isArray(clip.aiKeywords) ? clip.aiKeywords.filter(Boolean) : [];
      const combined = [...new Set([...localKeywords, ...aiKeywords])];
      if (keywordsProp.type === 'multi_select') {
        notionProperties[mapping.keywords] = { multi_select: combined.slice(0, MULTI_SELECT_MAX).map((name) => ({ name })) };
      } else {
        notionProperties[mapping.keywords] = { rich_text: richTextChunks(combined.join('、')) };
      }
    }
    const categoryProp = validateMappedProperty(properties, mapping, 'category');
    if (categoryProp && clip.category) {
      const options = categoryProp[categoryProp.type]?.options || [];
      if (!options.some(option => option.name === clip.category)) {
        throw new NotionError('選擇的分類不存在於資料庫，請使用既有分類，避免修改資料庫的分類選項。', { code: 'invalid_category' });
      }
      notionProperties[mapping.category] = categoryProp.type === 'multi_select'
        ? { multi_select: [{ name: clip.category }] }
        : { select: { name: clip.category } };
    }
    if (includeImages) {
      const imagesProp = validateMappedProperty(properties, mapping, 'images');
      if (imagesProp) {
        const images = Array.isArray(clip.images) ? clip.images.filter((src) => /^https?:\/\//.test(src)) : [];
        notionProperties[mapping.images] = {
          files: images.slice(0, FILES_MAX).map((src, index) => ({
            type: 'external',
            name: `image-${index + 1}`,
            external: { url: src },
          })),
        };
      }
    }

    const allBlocks = buildPageBlocks(clip);
    const blockChunks = chunkArray(allBlocks, BLOCK_CHUNK_MAX);
    const [firstChunk = [], ...remainingChunks] = blockChunks;

    let page;
    try {
      page = await this.#request({
        path: '/pages',
        method: 'POST',
        retryable: false,
        body: {
          parent: { data_source_id: dataSourceId },
          properties: notionProperties,
          children: firstChunk,
        },
      });
    } catch (err) {
      const isAmbiguous = err instanceof NotionError && (err.code === 'network_error' || (typeof err.status === 'number' && err.status >= 500));
      if (isAmbiguous) {
        throw new NotionError(
          `建立 Notion 頁面時發生無法確認結果的錯誤（${err.message}）。請先至 Notion 資料來源檢查是否已產生重複頁面，確認狀況後再決定是否重新儲存，避免重複建立。`,
          { status: err.status, code: 'create_outcome_unknown' },
        );
      }
      throw err;
    }

    let blocksWritten = firstChunk.length;
    for (const chunk of remainingChunks) {
      try {
        await this.#request({
          path: `/blocks/${page.id}/children`,
          method: 'PATCH',
          retryable: false,
          body: { children: chunk, position: { type: 'end' } },
        });
        blocksWritten += chunk.length;
      } catch (err) {
        throw new NotionError(
          `頁面已建立，但完整內容過長，寫入中斷於第 ${blocksWritten} / ${allBlocks.length} 個區塊。請至 Notion 頁面查看，剩餘內容未自動補寫以避免重複：${page.url}`,
          {
            status: err?.status,
            code: 'partial_content',
            partialUrl: page.url,
            partialPageId: page.id,
            blocksWritten,
            blocksTotal: allBlocks.length,
          },
        );
      }
    }

    return { id: page.id, url: page.url };
  }
}

export function suggestMapping(properties = {}) {
  const mapping = { title: '', summary: '', url: '', aiSummary: '', keywords: '', category: '', images: '' };
  const entries = Object.entries(properties || {});
  const byName = new Map(entries);

  for (const slot of Object.keys(mapping)) {
    const candidates = NAME_CANDIDATES[slot] || [];
    for (const candidateName of candidates) {
      const prop = byName.get(candidateName);
      if (prop && TYPE_ALLOWED[slot].includes(prop.type)) {
        mapping[slot] = candidateName;
        break;
      }
    }
  }

  if (!mapping.title) {
    const titleEntry = entries.find(([, prop]) => prop?.type === 'title');
    if (titleEntry) mapping.title = titleEntry[0];
  }

  return mapping;
}
