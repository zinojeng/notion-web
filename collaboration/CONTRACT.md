# Shared API contract — 2026-09-20

ES modules, plain JavaScript, no runtime dependencies. Browser API namespace `browser` (Safari); build bundles with esbuild. UI Traditional Chinese. Inject only upon user gesture using activeTab + scripting. No content scripts by default, no broad host permissions. Untrusted DOM strings must only use textContent/value, never innerHTML.

`src/capture.js` exports self-contained `capturePage()` suitable for browser.scripting.executeScript({func: capturePage}). ALL helper logic inside function; no imported variables. Returns `{title, text, url, siteName, author, images: string[], warnings: string[], source: 'selection'|'facebook'|'article'|'metadata', capturedAt}`. Max text 80000 chars, images 8. FB: prefer selected text's containing post, then dialog/single permalink article; feed with multiple posts must NOT collect entire feed or silently choose unrelated post. Empty body => warning; select desired text guidance. Preserve actual post permalink including story_fbid/id query, no unsafe canonical to homepage. Remove nav/reaction controls, retain content; no bypassing privacy/login.

`src/compose.js` exports `composeClip(capture)` -> `{...capture, title, summary, keywords: string[], aiSummary: '', aiKeywords: [], aiUsed: false}`. Deterministic local concise meaningful title max 80, summary <= 600, actual full original text stays text. Never raw URL as title; omit app login chrome and FB reaction counts. `normalizeUrl(input)` -> safe http/https URL string or throws; remove tracking only, preserve content ids.

`src/notion.js` exports `class NotionClient` constructor `{token, fetchImpl = fetch}`. Methods:
- `listDataSources()` -> `[{id, name}]` search pagination;
- `getSchema(dataSourceId)` -> `{id, title, properties}`;
- `findByUrl(dataSourceId, urlProperty, url)` -> `{id,url}|null` (if no URL property -> null);
- `createClip({dataSourceId, schema, mapping, clip, includeImages = false})` -> `{id,url}`.
Exports `suggestMapping(properties)` -> mapping keys `title, summary, url, aiSummary, keywords, category, images` with string Notion property names, empty string for absent. mapping.title required, summary rich_text, url url, aiSummary rich_text, keywords multi_select or rich_text; images files. Map user schema names `New Project` (title type is authoritative), `摘要`, `摘要*`, `AI摘要`, `AI 關鍵字`, `~URL`, `分類`, `圖檔`, `標籤`. Do not overwrite Status/Owner/Dates/created_time. getSchema properties Notion raw property shape. createClip schema parameter is getSchema result. Validate mapped property types, missing title error; skip unconfigured fields. Notion blocks include About this project, summary, linked source, author/capture timestamp and full original text. Respect 2000 text part length, 100 child request max; support long text without silent truncation (append chunks, clearly report partial page if append fails). Do not retry create blindly. API error text in Chinese; never expose token. Timeouts + 429 handling bounded, no unsafe duplicate writes.

UI-background message contract `browser.runtime.sendMessage({type, ...})` -> `{ok:true, ...}` or `{ok:false,error,partialUrl?}`.
- SETTINGS_GET -> `{settings}` sans API tokens, includes `hasNotionToken, hasAiKey`, dataSourceId, mapping, includeImages, aiEnabled, aiModel; settings token fields supplied only on SAVE.
- SETTINGS_SAVE `{settings}` -> persists token fields notionToken, aiKey only if string supplied (empty clears); dataSourceId, mapping, includeImages, aiEnabled, aiModel. Default AI off.
- NOTION_LIST -> `{sources}`
- NOTION_SCHEMA `{dataSourceId}` -> `{schema,mapping}`
- CAPTURE -> `{clip}` captured from active tab and composed locally
- REWRITE `{clip}` -> `{clip}` explicit optional Claude API, no keys in page.
- SAVE `{clip, force?:boolean}` -> `{page, duplicate?:boolean}` default detects same URL and returns existing page; force allowed deliberate save again.
- OPEN_OPTIONS -> opens options page

Popup: auto CAPTURE on open, editable title/summary/url AND original text (manual fallback), warnings, show source type, explicit AI button (optional); Save one click after setup. Preview original in details, selected image previews only if setting enabled, actionable errors and existing page link. No AI auto-send. On initial no token still capture and show setup link.
Options: token password blank on GET with configured marker; link Notion integration settings + instructions share database to connection; connect/list sources + choose source -> load schema and show property mappings with compatible options, save; optional AI key password, model input default claude-haiku-4-5, checkbox off, clear privacy text explaining sends clip text only after click; image opt-in off. UI must render safely, disable double save; responsive width for iPhone, accessible labels.
