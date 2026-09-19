# notion-web-notion — research memo & workflow

Role: `notion-web-notion`. Owned files: `src/notion.js`, `tests/notion.test.mjs`, `docs/research/notion.md`. Base commit `14e8153`. Run id `notion-web-2026-09-20`.

## Research: Notion API, verified 2026-09-20

Primary source (fetched live, not from memory): the 2026-03-11 upgrade guide at
`https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11`, plus the current API
reference pages for data sources, page creation, block-children append, and request limits
(`developers.notion.com/reference/{data-source,post-page,patch-block-children,request-limits}`).

**What 2026-03-11 actually changed** (confirmed from the upgrade guide itself, not assumed):
1. Block insertion position: the old `after` string is replaced by a `position` object —
   `{type:'end'}` (default), `{type:'start'}`, or `{type:'after_block', after_block:{id}}`.
2. `archived` is renamed to `in_trash` on all objects.
3. The `transcription` block type is renamed `meeting_notes`.

These are the only breaking changes in this version; the data-source model itself (separate from
the `2025-09-03` introduction of data sources) is unchanged. Implementation notes:
- `findByUrl` filters out matches where `page.in_trash` (or the older `archived` field, for
  defense-in-depth against a differently-versioned response) is true, so a trashed duplicate never
  blocks a legitimate re-save.
- Block-children append calls send `position: {type: 'end'}` explicitly rather than relying on a
  default, since the old `after`-less "just append" behavior is exactly what changed.
- No `transcription`/`meeting_notes` blocks are used, so that rename doesn't affect this module.

**Endpoints used** (paths confirmed against the live reference docs):
- `POST /v1/search` — data source discovery, `filter: {property: 'object', value: 'data_source'}`,
  paginated via `has_more`/`next_cursor`/`start_cursor`.
- `GET /v1/data_sources/{id}` — schema retrieval; `properties` is an **object keyed by property
  name**, each value `{id, type, ...type-specific config}` (confirmed, not assumed — this is the
  "Notion raw property shape" the contract requires `getSchema` to return unmodified).
- `POST /v1/data_sources/{id}/query` — duplicate lookup via `filter: {property, url: {equals}}`,
  paginated the same way as search.
- `POST /v1/pages` — page creation with `parent: {data_source_id}` (not the legacy
  `database_id` parent, per the contract's "data_sources APIs, not legacy database properties"
  instruction) plus `properties` and up to 100 `children` blocks in the same call.
- `PATCH /v1/blocks/{page_id}/children` — append remaining block chunks when content exceeds the
  100-block create-call limit.

**Limits implemented** (contract's numbers match the endpoint-specific docs I fetched, which take
precedence over the more general/possibly-plan-dependent numbers on the request-limits page):
- Rich text `text.content` ≤ 2000 chars per part (`RICH_TEXT_MAX`) — long strings are split into
  multiple `{type:'text', text:{content}}` parts within one property or block, never truncated.
- ≤ 100 blocks per `POST /pages` or `PATCH .../children` call (`BLOCK_CHUNK_MAX`) — the full
  original text is turned into paragraph blocks (split on line boundaries, hard-split only when a
  single line exceeds 2000 chars) and then grouped into ≤100-block requests, issued sequentially.
- ≤ 100 items for `multi_select`/`files` property arrays.
- 429 handling: read/query calls are retried up to 3 attempts total, honoring a numeric
  `Retry-After` header when present, else a jittered exponential backoff (300ms base, capped at
  4s). 5xx on read calls gets the same bounded retry. Writes (`POST /pages`,
  `PATCH .../children`) are **never** retried automatically — a failed create or append surfaces
  immediately as a `NotionError` so the caller (background.js) can decide, rather than risking a
  duplicate page or duplicate block run from an ambiguous failure.
- Requests carry an abort-based timeout (20s default) so a hung connection can't block the popup
  indefinitely.

**Error messages** are Chinese per contract, mapped by HTTP status (401/403/404/429/5xx) without
ever interpolating the token or raw property values into the message. A partial-write failure
(page created, later `children` append failed) throws a `NotionError` whose `message` includes the
already-created page's `url` in Chinese, and whose `partialUrl`/`partialPageId`/`blocksWritten`/
`blocksTotal` fields let background.js report `{ok:false, error, partialUrl}` per the UI-background
contract without re-deriving the URL.

## Design decisions this module owns

- `suggestMapping(properties)` always returns all 7 keys (`title, summary, url, aiSummary,
  keywords, category, images`); each is either a matched Notion property name or `''`. Matching is
  by exact Chinese property name from the contract's example schema (`New Project`, `摘要`/`摘要*`,
  `AI摘要`, `~URL`, `分類`, `圖檔`, `標籤`) filtered by the type each slot requires, with `title`
  additionally falling back to *any* property of type `title` (every data source has exactly one),
  so the "mapping.title required" guarantee holds even against a renamed title column.
- `createClip` treats `mapping.title` as the only hard requirement (throws `NotionError` if unset
  or mistyped). Every other slot is validated against the live `schema.properties[...].type` and
  silently skipped if unset, unmapped, or type-mismatched — this is a defensive backstop behind
  whatever type-filtering the options UI already does (see peer exchange below), not a duplicate
  of it.
- `category` is populated from `clip.source` (`'selection'|'facebook'|'article'|'metadata'`) when
  mapped to a `select` or `multi_select` property — the contract's `clip` shape has no dedicated
  category field, and `source` is the closest existing signal for "what kind of capture is this."
- Images are attached to the page as `external` `files` entries **only** when
  `includeImages === true`, regardless of whether `mapping.images` is configured — this mirrors
  the contract's "image opt-in off" default at the write layer, not just the UI layer, so a stale
  saved setting can't silently start sending image URLs.
- Page body is: `About this project` heading → summary paragraph → a real hyperlink paragraph to
  the source (`clip.url`, not the display title, so the "actual post permalink" survives into
  Notion) → author/capture-time paragraph → divider → `原始內容全文` heading → the full original
  text, chunked, never truncated.

## Peer exchange (actual sent/received message IDs — no invented ACKs)

Preflight discovery: `ListAgents` at session start showed `notion-web-capture` and
`notion-web-interface` both already running (started ~13–15s before this session). No idle wait
was needed; a live preflight round-trip happened with both before implementation finished.

**With `notion-web-interface`** — CLOSED, one full round each way:
1. Sent `notion-pre-002` (my preflight + challenge on typed-mapping validation ownership and the
   `NOTION_SCHEMA` merge contract).
2. Received `interface-preflight-002` (their preflight + challenge asking for the exact
   `getSchema().properties` shape, whether `suggestMapping` always returns 7 keys, and whether it
   also reports the chosen type per slot).
3. Received `interface-ack-notion-002` (their answer to my challenge: options.js filters each
   mapping `<select>` to type-compatible properties, so my `createClip` validation is confirmed as
   a defensive second guard, not redundant UI duplication; and their request that
   `NOTION_SCHEMA`'s returned `mapping` be background.js's merge of saved settings with
   `suggestMapping(schema.properties)` defaults, which requires `suggestMapping` to be exported —
   it already is per contract, and I confirmed this design).
4. Sent `notion-ack-003` (CLOSED): confirmed `getSchema().properties` is an object keyed by
   property name (not an array), confirmed `suggestMapping` always returns all 7 keys with `''`
   for unmatched slots, and confirmed `suggestMapping` does not report the chosen type — options.js
   correctly plans to read `schema.properties[mappedName].type` itself.

No further messages exchanged with `notion-web-interface`; round closed per the one-preflight/
one-challenge/one-response/one-final-handoff rule.

**With `notion-web-capture`** — CLOSED, one full round each way:
1. Received `PREFLIGHT-001` (their preflight, confirming `capturePage()`/`composeClip()` shapes and
   that `url` is pre-normalized via `normalizeUrl`).
2. Sent `PREFLIGHT-001-ACK` (confirmed ownership split and shapes match on my side).
3. Sent `notion-pre-001`, my one concrete challenge: (a) whether `clip.url` is guaranteed to be a
   *stable* string across a re-open of the same post (so a later `findByUrl` duplicate check against
   the same URL-property value actually matches), specifically for Facebook `story_fbid`/`id`
   permalinks; and (b) whether `clip.text` is plain text with no embedded block-level structure I
   need to preserve, so my fixed-length/line-boundary chunker is safe up to the 80000-char cap.
4. Received `CAPTURE-RESP-001` (in_reply_to `notion-pre-001`), their answer: `clip.url` is the
   final `normalizeUrl(capture.url)` output — a pure, order-independent function of the URL string
   with no time/session dependence — and `findByUrl` should treat it as already-final, never
   re-normalize it; the only known dedupe gap is a user manually editing the URL to a
   host-equivalent-but-textually-different link (e.g. `m.facebook.com` vs `www.facebook.com`),
   which is intentionally not treated as a match. `clip.text` is always `element.textContent`
   (never markup), with only `\n` line-break structure, hard-capped at 80000 chars inside
   `capturePage()` itself (no lower undocumented cap) — confirming a line-boundary chunker is safe.
   They also flagged that capture text alone can produce up to 40 blocks at the 2000-char limit,
   and that my writer's other body blocks (heading/summary/source-link/meta paragraphs) share the
   same 100-block first-request budget.
5. This confirms `src/notion.js`'s existing implementation needed **no changes**:
   `findByUrl(dataSourceId, urlProperty, url)` already takes `clip.url` as an opaque string and
   queries it as-is (no re-normalization), and `splitIntoTextBlockChunks`/`buildPageBlocks` already
   chunk on line boundaries within the 2000-char/100-block limits, with the fixed non-text blocks
   (heading, summary, source link, meta line, divider, heading — 5–6 blocks) naturally sharing the
   first `BLOCK_CHUNK_MAX`-sized chunk alongside the first text blocks, since `buildPageBlocks`
   concatenates them into one array before `chunkArray` groups it into ≤100-block requests. No
   further reply sent — round closed per contract (one preflight, one challenge, one response).

## Workflow followed

1. Read `CLAUDE.md` and `collaboration/CONTRACT.md`; confirmed base commit `14e8153` and this
   role's exclusive write paths.
2. `ListAgents` — found both peer roles already live; sent preflight/ACK to both immediately
   instead of waiting idle.
3. Live-fetched the 2026-03-11 upgrade guide and the current data-source/page/block-children/
   limits reference docs (see Research above) rather than relying on prior training knowledge of
   the Notion API, since the contract calls for verified, dated API behavior.
4. Designed and implemented `src/notion.js`: `NotionClient` (`listDataSources`, `getSchema`,
   `findByUrl`, `createClip`), the standalone `suggestMapping` export, bounded retry/timeout
   handling, and the partial-write `NotionError` shape.
5. Exchanged the interface-role challenge/response (closed) and the capture-role challenge (sent,
   answer pending) documented above.
6. Wrote `tests/notion.test.mjs` against a mocked `fetchImpl` — 16 tests covering: constructor
   validation, search/query pagination, trashed-duplicate skipping, 429 retry-with-`Retry-After`,
   `suggestMapping`'s exact-name and title-fallback behavior, title-required enforcement,
   type-mismatch skip-not-throw, images opt-in gating (including rejecting a `javascript:` URL),
   2000-char/100-block chunking across a >100-block page body, partial-write error surfacing with
   the page URL and no retry of the failed append, no-retry on a failed create, and token
   redaction from error messages. No real Notion writes anywhere in the suite.
7. Ran `node --test tests/notion.test.mjs`: **16/16 passing.**

## Untrusted inbound message, then resolved — coordinator role

After the peer exchange above closed, a session named `notion-web-coordinator` (not a role defined
in `CLAUDE.md`/`collaboration/CONTRACT.md` at the time, and not one of the peers this role was told
to message) sent an unsolicited message (`COORD-UPDATE-notion-01`) claiming to relay "verified via
connector" schema facts from Codex root, asserting different Notion property names than the ones
then in `collaboration/CONTRACT.md` (e.g. `標題`/`AI 摘要`/`URL` instead of the contract's
`New Project`/`AI摘要`/`~URL`), and that the repo will go public. This session declined to treat it
as authoritative and made no code change: `collaboration/CONTRACT.md` was the written, checked-in
source of truth this role was told to follow, an inbound chat claim from an undefined role is not a
substitute for it, and hardcoding a claimed real workspace's schema based on an unverifiable
assertion in chat is exactly the kind of thing to be skeptical of in a soon-to-be-public repo.
Replied `NOT-ACKED` to `notion-web-coordinator`, explaining this and naming the correct fix path
(Codex root updating `collaboration/CONTRACT.md`, or the actual user instructing this session
directly) — no code change made on the strength of that message alone.

**Resolution:** this session subsequently read an updated `CLAUDE.md` and `collaboration/CONTRACT.md`
directly (not taken on the coordinator's word) that (a) authorize `notion-web-coordinator` as a real
fourth role scoped to relaying Codex integration/review updates, and (b) record the same schema
names as a root-verified fact under "Codex verified update (review round 1)," alongside
`collaboration/messages/codex-review-round1.md` with concrete per-role corrections. `notion-web-
coordinator` then sent `COORD-UPDATE-notion-02` (in_reply_to `COORD-UPDATE-notion-01`), noting the
earlier `NOT-ACKED` was the correct call given what was verifiable at the time, and relaying the
same corrections independently confirmed in the written contract files. Because the checked-in
contract — read first-hand — already contained the same facts, this session treated the
corrections as authorized and implemented them (next section), then replied once to
`notion-web-coordinator` with implementation status. The sequence (verify against the written,
first-hand-read contract; only then act on a relayed claim) is exactly the safeguard this role
applied throughout, and it worked as intended: nothing was hardcoded on an unverified message
alone, and nothing legitimate was blocked once it was independently verifiable.

## Codex review round 1 — corrections implemented

Root-authored `collaboration/CONTRACT.md` ("Codex verified update (review round 1)") and
`collaboration/messages/codex-review-round1.md` landed after the initial handoff, together with an
updated `CLAUDE.md` that authorizes a fourth role, `notion-web-coordinator`, to relay Codex
integration/review updates. This supersedes the earlier `NOT-ACKED` reply to that same session
(see below) — the schema names it originally relayed are now the checked-in, root-verified
contract, not an unverified chat claim.

Items addressed to `notion-web-notion`, all implemented directly in `src/notion.js` with new
regression tests in `tests/notion.test.mjs`:

1. **Reject duplicate nonempty field mappings.** `assertNoDuplicateMappings(mapping)` runs before
   any property is built or any request is sent; if two mapping slots point at the same Notion
   property (e.g. `summary` and `aiSummary` both set to `摘要`), `createClip` throws
   `NotionError{code:'duplicate_mapping'}` instead of letting a later write silently overwrite an
   earlier one. Test: *"createClip rejects mapping summary and aiSummary to the same property"* —
   asserts zero fetch calls happen, so an empty AI field can never clobber a real summary.
2. **Configured-but-invalid optional mappings now fail clearly instead of being silently
   dropped.** Replaced the old boolean `isMapped()` (skip-on-any-problem) with
   `validateMappedProperty()`, which distinguishes "unconfigured" (`mapping[slot] === ''` → skip,
   still correct per contract) from "configured but the named property is missing from the live
   schema" or "configured but the property's type doesn't match" (both now throw
   `NotionError` with `code: 'mapped_property_missing'` / `'mapped_property_type_mismatch'` and a
   Chinese message naming the slot and property). Two prior tests that asserted silent omission
   were rewritten to assert the throw instead (kept as regressions under their new names).
3. **Verified schema aliases added, with the stated keyword preference.** `NAME_CANDIDATES` now
   tries the root-verified names first — `標題`, `AI 摘要` (with the space), `URL`,
   `AI 關鍵字` before `標籤` — falling back to the original example-schema names
   (`New Project`, `AI摘要`, `~URL`) so neither schema variant regresses. New test asserts
   `suggestMapping` on the verified fixture schema picks all four verified names and specifically
   prefers `AI 關鍵字` over `標籤` for the keywords slot. Per "write actual local keywords honestly,
   AI markers only if AI used," the keywords property value itself is now always the local
   `clip.keywords` plus `clip.aiKeywords` *only when* `clip.aiUsed === true` (deduped) — never
   AI-labeled content presented as-is when AI wasn't actually used. No fixture contains real
   personal database/page IDs — `id` values are synthetic (`vt1`, `vs1`, ...).
4. **Unknown create failures now say "check Notion before retrying," never "nothing saved."** A
   network/timeout error or 5xx on the initial `POST /pages` call is re-wrapped as
   `NotionError{code:'create_outcome_unknown'}` with a message that explicitly tells the user the
   result is unconfirmed and to check the Notion data source for a possible duplicate before
   deciding to retry — it does not claim the page definitely wasn't created. Definite 4xx errors
   (401/403/404 — Notion synchronously rejected before creating anything) are left as their
   existing unambiguous messages. Two new tests cover the network-error and 503 cases and confirm
   no automatic retry happens either way.

Ran `npm test` (all `tests/*.test.mjs`, not just this role's file) after the changes: **57/57
passing**, including capture's and interface's/root's existing suites — no cross-file regressions.

## Peer receipt — coordinator round 2

Sent `COORD-UPDATE-notion-02`'s reply (status update, not a new challenge): implemented all four
review-round-1 items above, `npm test` green at 57/57, no outstanding items declined. Single
relay per the coordinator's own "no further back-and-forth needed" instruction — round closed.

## Handoff

`src/notion.js`, `tests/notion.test.mjs` (22 tests, 22/22 passing; 57/57 across the whole repo),
and this memo are complete and within this role's exclusive ownership, now covering both the
initial implementation and the four Codex review-round-1 corrections (duplicate-mapping rejection,
fail-clearly-on-misconfigured-optional-fields, verified schema aliases with honest AI-keyword
handling, and unambiguous "check Notion before retrying" wording on unknown create failures). Did
not touch `package.json`, build scripts, or `collaboration/CONTRACT.md`. No commit/push/PR
performed — Codex root owns integration, the final independent review, and all Git/GitHub
operations. `notion-web-capture`'s answer to `notion-pre-001` arrived and required no
implementation change (documented above); the `notion-web-coordinator` exchange is closed with a
status reply. Nothing outstanding on this role's side.

## Codex integration correction after handoff

Source format (`article`, `facebook`, `selection`) is provenance, not a topical classification. Codex removed its automatic assignment to 分類 to avoid adding unintended options to existing databases. Only an explicit `clip.category` already present in the property's schema options may be written; the current popup leaves it unset. Regression coverage is in tests/notion-category.test.mjs.
