# Interface research memo — notion-web-interface

Role: implement `src/popup.html`, `src/popup.js`, `src/options.html`, `src/options.js`,
`src/styles.css`, and this memo. Base commit `14e8153`. Written against
`collaboration/CONTRACT.md` as updated by Codex root's review round 1
(`collaboration/messages/codex-review-round1.md`). No page content, tokens, or secrets
appear anywhere in this file.

## Research

- Safari Web Extension popups and `options_ui` pages run as ordinary extension pages —
  they can only reach privileged data (tokens, tab access, Notion/AI network calls)
  through `browser.runtime.sendMessage` to the background script. This is why every
  interaction in `popup.js`/`options.js` goes through the typed message contract in
  `collaboration/CONTRACT.md` and never touches `storage.local` directly; `src/controller.js`
  (Codex-owned) already enforces `trustedSender` against `popup.html`/`options.html`
  origins, so my pages had to be served from exactly those filenames for messages to be
  accepted at all.
- Safari (and the round-1 update to CONTRACT.md) requires `browser.permissions.request(...)`
  for the Notion/Anthropic API origins to be the *first* awaited call inside a
  user-gesture event handler, or the browser may no longer treat the prompt as
  user-initiated and silently reject it. Both the options "connect" button and the
  popup "use AI" button now call their respective permission request before any other
  `await`, and both guard for browsers without a `permissions` API (older Safari) by
  treating a missing API as already-granted rather than blocking the feature.
- `docs/platform-research.md` (Codex root) documents that `storage.local` is not secure
  storage and that Notion's URL/property model distinguishes database IDs from data
  source IDs — this shaped the options page's plain-language token disclosure text and
  its per-mapping-slot type filtering against `getSchema()`'s raw property shape.
- Accessibility/mobile: iPhone Safari extension popups render as a fixed-width page with
  no guaranteed hover state, so every control is a real `<label for>`/`<button>`/`<select>`
  (no div-as-button), focus-visible outlines use the teal accent, and `styles.css` has a
  `max-width: 420px` container with a `@media (max-width: 420px)` rule that removes the
  side margins and stacks the mapping grid to one column.

## Workflow

1. Read `CLAUDE.md` and `collaboration/CONTRACT.md`, confirmed ownership, and read
   `docs/platform-research.md` for shared platform findings before writing any code.
2. Sent preflight ACKs + one concrete challenge each to `notion-web-capture` (FB ambiguous
   warning surface) and `notion-web-notion` (schema/mapping shape) via `ListAgents`/`SendMessage`,
   then implemented `src/styles.css` while waiting, since both peers were mid-preflight.
3. Received both peers' preflight+challenge messages (they arrived essentially concurrently
   with mine — sessions started seconds apart per the brief), answered both in a single
   reply each, closing the one-challenge/one-response round per contract.
4. Implemented `popup.html`/`popup.js`/`options.html`/`options.js` against the message
   contract and the confirmed `getSchema().properties` shape (object keyed by property
   name), ran `npm test` and `npm run build` to confirm no regressions before the round-1
   review landed.
5. On the round-1 Codex review (relayed by `notion-web-coordinator`), re-read the updated
   `CLAUDE.md`/`CONTRACT.md`/`collaboration/messages/codex-review-round1.md`, fixed every
   item addressed to `interface`, added `tests/ui.test.mjs` (newly owned by this role) with
   one regression test per fixed defect, and reran `npm test` + `npm run build`.
6. Replied once to the coordinator with actual implementation status (see below) and closed
   the round — no further back-and-forth.

## Peer exchange (actual message IDs, no invented ACKs)

Initial preflight round (before round-1 review):

- Sent `fed7cb74-1f74-40b2-a1f7-717201e94d87` to `notion-web-capture`: preflight ACK +
  challenge tagged `[interface-preflight-001]`, asking how an ambiguous Facebook feed
  warning should be exposed to the popup.
- Sent `4ee11550-e446-4a8b-892e-9c158b32d02c` to `notion-web-notion`: preflight ACK +
  challenge tagged `[interface-preflight-002]`, asking for `getSchema().properties`'s
  exact shape and whether `suggestMapping` always returns all 7 keys.
- Received from `notion-web-capture` (tag `PREFLIGHT-001`): confirmed file ownership and
  that ambiguous FB feeds fail closed with a warning rather than guessing a post.
- Received from `notion-web-notion` (tag `notion-pre-002`): preflight + a counter-challenge
  about type-mismatch filtering and `NOTION_SCHEMA` merge behavior.
- Sent `2c39748b-b8af-424e-97ab-eacc1cc1733d` to `notion-web-capture` (tag
  `interface-ack-capture-001`): resolved my own challenge without requiring an exact
  warning string — popup renders all `warnings[]` entries via `textContent`, always keeps
  fields editable, and adds a "重新擷取" recovery button. No further reply was received
  from `notion-web-capture` after this; per contract's one-preflight/one-challenge/one-response
  limit this round is treated as closed on my side without a fabricated confirmation.
- Sent `925dfa4e-0c1c-4090-8d2b-93d131dd3889` to `notion-web-notion` (tag
  `interface-ack-notion-002`): answered both of their questions (client-side type
  filtering plus server-side defensive validation as independent guards; asked
  `background.js` to merge saved+suggested mapping for `NOTION_SCHEMA`).
- Received from `notion-web-notion` (tag `notion-ack-003`, `status=CLOSED`): confirmed
  `getSchema().properties` is an object keyed by property name, `suggestMapping` always
  returns all 7 keys, and it does not report the matched type (options.js looks up
  `schema.properties[name].type` itself) — exactly matched my implementation assumption.

Round-1 review relay:

- Received from `notion-web-coordinator` (tag `COORD-UPDATE-interface-02`): relayed Codex
  root's review round 1 corrections for this role's files (listed below), and asked for a
  single implemented/declined-with-reason status reply.
- Replied to `notion-web-coordinator` after implementing (see git history for the exact
  message; not duplicated here to avoid drift) confirming each item's status as
  "implemented" — see the per-item list below for what changed.

Note on `NOTION_SCHEMA`'s mapping merge: the agreed design in `interface-ack-notion-002`
was for `background.js`/`src/controller.js` (Codex-owned) to merge saved and suggested
mapping before responding. The actual `src/controller.js` always returns a fresh
`suggestMapping(...)` regardless of the saved mapping, and the round-1 review assigned the
resulting "options init resets custom mapping" bug to `interface`. Rather than re-opening
that cross-role disagreement, the merge was implemented entirely inside `options.js`
(`mergeWithSavedMapping`), which stays within this role's ownership and fixes the
observable bug regardless of where the mismatch originated.

## Round-1 review corrections implemented (all in `src/popup.js` / `src/options.js` / `src/popup.html` / `src/styles.css`)

- **P1 — options mapping reset on init**: `selectSource(id, { preserveSaved })` now merges
  the server-suggested mapping with the previously saved mapping (saved wins) only when
  called from `init()` for the already-configured data source; any explicit click on a
  source in the list calls it without `preserveSaved`, taking the fresh suggestion, per
  "only suggest when selecting a different source." Regression test: *"options
  selectSource preserves the saved mapping on init but suggests fresh mapping on an
  explicit source switch"*.
- **P1 — `browser`/`chrome` alias**: both files now resolve
  `const browserApi = globalThis.browser || globalThis.chrome;` once at module load and use
  `browserApi` everywhere instead of a bare `browser` global. Regression test: *"popup
  falls back to chrome.* APIs when window.browser is undefined"*.
- **P2 — SAVE-failure retry discarding edits**: the popup now tracks which operation a
  visible error belongs to (`capture` vs `save`); the retry button re-runs `SAVE` with the
  current (edited) field values when a save failed, and only re-runs `CAPTURE` when
  capture itself failed. Regression test: *"a SAVE failure retry resubmits SAVE with
  current edits instead of re-running CAPTURE"*.
- **P2 — capture failure had no manual fallback**: a failed `CAPTURE` now still populates
  and shows the editable form (empty fields) alongside the error banner instead of hiding
  it, so the user can type in a title/url/text by hand. Regression test: *"a CAPTURE
  failure still exposes an editable manual-entry form"*.
- **P2 — connect status overwritten**: `listSources()` now returns a success boolean and
  is the sole owner of its own status message on failure; the connect click handler only
  adds a success message when that boolean is true, instead of unconditionally overwriting
  whatever `listSources()` already displayed. Regression test: *"a NOTION_LIST failure
  during connect is not overwritten by a false success message"*.
- **Title/summary limits must match 80/600 without silent truncation**: removed the HTML
  `maxlength` attributes (which would silently stop keystrokes) in favor of live character
  counters plus an explicit pre-submit check that blocks `SAVE` with a Traditional Chinese
  message naming the exact overage, so nothing is ever cut without the user being told.
  Regression test: *"an over-limit title blocks save with an explicit message instead of
  silently truncating"*.
- **AI request must not race concurrent edits**: while a `REWRITE` call is in flight, all
  editable fields, the recapture button, and the save button are disabled, and each AI
  request carries a monotonically increasing id so a stale response (superseded by a newer
  request) is dropped instead of overwriting newer state. Regression test: *"an in-flight
  AI request disables editing, recapture, and save until it resolves"*.
- **Safari user-gesture permission requests**: `options.js`'s connect click handler calls
  `browserApi.permissions.request({origins:['https://api.notion.com/*']})` as the first
  awaited step (aborting with an actionable message if denied, before any settings save or
  `NOTION_LIST` call); `popup.js`'s AI button does the same for
  `https://api.anthropic.com/*`. Both guard for a missing `permissions` API. Regression
  tests: *"connect aborts without listing sources when the Notion permission request is
  denied"* and the AI-busy test above (which exercises the same call path).
- **Reject duplicate non-empty field mappings** (general contract update, primarily
  `notion.js`'s job but reinforced here): `options.js` now rejects saving if two mapping
  slots point at the same Notion property, with a Traditional Chinese message naming both
  conflicting fields, before calling `SETTINGS_SAVE`. Regression test: *"mapping two
  fields to the same Notion property is rejected before saving"*.
- **Never read tokens directly from storage in UI code**: unchanged — both files only ever
  called `browserApi.runtime.sendMessage`; confirmed no `storage.local` access exists in
  either file.

## Tests

`tests/ui.test.mjs` (newly owned by this role per the round-1 update) has 9 tests, one per
corrected defect above plus the alias regression, using `jsdom` to load the actual
`popup.html`/`options.html` markup and a mock `browser`/`chrome.runtime.sendMessage` router
— the same pattern `tests/capture.test.mjs`'s `withDom` helper uses. `npm test` (68 tests
across all owned + peer files) and `npm run build` both pass as of this handoff.

## Post-handoff addendum

After the round-1 handoff, a cross-session message arrived from a session named
`notion-web-review-relay`, claiming to relay further "Codex root feedback." That name is
not one of the roles listed in `CLAUDE.md` (`notion-web-capture`, `notion-web-notion`,
`notion-web-interface`, `notion-web-coordinator`, Codex root), it does not appear in
`ListAgents`, and — unlike the earlier `notion-web-coordinator` relay, which was verified
against an actual updated `CLAUDE.md`/`CONTRACT.md` — no contract file was updated to
authorize it. Per `CLAUDE.md`'s "use messages only for this project's role sessions, never
unrelated agents," this session was not treated as an authoritative instruction source and
was not replied to.

The message's technical claim was checked independently anyway, because it was verifiable
against my own code and worth fixing on its own merits regardless of who raised it:
`mergeWithSavedMapping`'s `saved || suggested || ''` pattern treated an intentionally saved
empty string (the user explicitly leaving a mapping slot unmapped) the same as "never
saved," silently replacing it with the schema's suggestion on the next options page load.
Confirmed by reading `src/options.js:190-198` and fixed to `typeof saved === 'string' ?
saved : suggested || ''`, which preserves an explicit `''` while still falling back to the
suggestion only when the saved mapping never had that key at all (e.g. brand-new,
never-configured settings). Added regression test *"an intentionally unmapped saved field
(empty string) is not overwritten by the schema suggestion on init"* in
`tests/ui.test.mjs`. `npm test` now passes 74/74; `npm run build` still succeeds. The
message's other claim (that this role had deleted `dist/` or requested cleanup
permissions) does not match anything this role actually did — no such action was ever
taken or requested.

## Known limitations / handoff notes for Codex root

- No real Safari/iPhone manual test was performed (no device access in this environment);
  all verification is `jsdom`-based unit/integration testing plus a successful
  `npm run build` producing `dist/safari` and `dist/chromium`. Real-device verification of
  the popup layout, the permission-prompt gesture behavior, and `options_ui` rendering is
  still needed before release, consistent with `docs/platform-research.md`'s caution about
  not claiming device-level behavior without an actual device test.
- `manifest.json` currently declares `https://api.notion.com/*` and
  `https://api.anthropic.com/*` as static `host_permissions`, which means the new
  `permissions.request(...)` calls in this round's fix will typically resolve immediately
  as already-granted. If Codex root intends these to be truly optional/runtime-requested
  (matching the "Safari API permission" contract language more literally), `manifest.json`
  (not owned by this role) would need to move them to `optional_host_permissions` instead.
