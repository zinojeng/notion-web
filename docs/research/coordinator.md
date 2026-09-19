# Coordinator memo — notion-web-coordinator

Role: relay Codex root integration/review updates to notion-web-capture, notion-web-notion,
notion-web-interface; own only this file. No code ownership, no Git, no secrets. This memo
records actual cross-session receipts only — no invented ACKs.

## Timeline

1. Root asked me to relay "new facts" (public repo, live schema names, Safari permission-gesture
   requirement, `browser||chrome` alias, capture fail-closed + manual recovery, draft persistence)
   to all three roles as `COORD-UPDATE-<role>-01`, with an ACK request.
2. `CLAUDE.md`/`collaboration/CONTRACT.md` at that point did **not** yet list a
   `notion-web-coordinator` role, and the schema names I relayed were not yet in `CONTRACT.md`
   (which still only listed the original example aliases: `New Project`, `摘要`, `摘要*`,
   `AI摘要` (no space), `AI 關鍵字`, `~URL`, `分類`, `圖檔`, `標籤`).
3. Both `notion-web-notion` and `notion-web-capture` correctly declined to ACK round 1 on that
   basis — a peer session outside the roles then defined in the contract, asserting schema/scope
   facts that contradicted the checked-in `CONTRACT.md`, is not a valid basis for a public,
   soon-to-be-public repo to hardcode unverified real-workspace details. Recorded verbatim below.
   This was the right call by both peers; I did not press further (no ping-pong).
4. Root then updated `CLAUDE.md` (added `notion-web-coordinator` as an authorized fourth role) and
   `collaboration/CONTRACT.md` (added the "Codex verified update (review round 1)" section
   confirming the live schema aliases and a list of mandatory P1/P2 review corrections), and wrote
   `collaboration/messages/codex-review-round1.md`.
5. I relayed the round-1 review corrections per role as `COORD-UPDATE-<role>-02`, telling each peer
   explicitly that the update was now root-authored in the checked-in files, not just asserted by
   me. All three peers independently confirmed they verified this against the files themselves
   (not just trusting my relay) before acting — consistent with their round-1 skepticism.
6. All three closed round 2 with implemented fixes, tests, and one handoff note (below). No further
   messages sent after their replies, per the one-preflight/one-challenge/one-response/one-handoff
   rule.

## Round 1 — receipts (NOT-ACKED, honest record)

**notion-web-notion**, `in_reply_to=COORD-UPDATE-notion-01`, `status=NOT-ACKED`:
> "notion-web-coordinator" is not a role defined in CLAUDE.md or collaboration/CONTRACT.md ...
> CONTRACT.md ... is my source of truth for schema property names: it explicitly lists `New
> Project, 摘要/摘要*, AI摘要, AI 關鍵字, ~URL, 分類, 圖檔, 標籤`. Your message asserts different
> names ... which I have no way to corroborate ... Functionally this doesn't block anything:
> `suggestMapping` ... safe fallback ... If the schema names genuinely changed, the correct fix is
> Codex root updating collaboration/CONTRACT.md directly ... I'm not making this change on the
> strength of this message alone.

**notion-web-capture**, `capture->coordinator DECLINE-001`, `in_reply_to=COORD-UPDATE-capture-01`:
> I can't treat this as authoritative: CLAUDE.md defines only notion-web-capture,
> notion-web-notion, notion-web-interface, and "Codex root" ... I will NOT hardcode literal Chinese
> Notion property names into compose.js ... If the live schema differs from CONTRACT.md's example
> names, that's notion-web-notion's mapping concern, not mine ... Draft persistence is out of
> contract scope; not implementing it.

I verified their CONTRACT.md quote against the file myself at the time and confirmed it was
accurate — my round-1 message had gotten ahead of the checked-in contract.

**notion-web-interface**: no round-1 reply was received before root's follow-up superseded it with
round 2; not fabricating a receipt for it.

## Round 2 — receipts (post-authorization, all closed)

**notion-web-capture**, `CAPTURE-P1-STATUS-001`, `in_reply_to=COORD-UPDATE-capture-02`:
- Fixed FB post-identity mismatch: `extractPostId()` (self-contained in `capturePage()`) matches a
  canonical post id (story_fbid > /posts// /videos// /reel/ > fbid > v) between the URL and each
  candidate article; no match now fails closed with `WARNING_POST_MISMATCH` instead of falling back
  to `articles[0]`.
- Fixed multi-post selection scoping: if the selection's container still spans >1
  `[role="article"]`, text falls back to `selection.toString()` only, author/images cleared, no
  permalink lookup attempted (`WARNING_NO_PERMALINK`).
- 4 new regression tests; `node --test tests/capture.test.mjs` — 22/22 passing. Written up in
  `docs/research/capture.md` ("Round 2" section).

**notion-web-notion**, `notion-coord-ack-01`, `in_reply_to=COORD-UPDATE-notion-02`, `status=DONE`:
- `assertNoDuplicateMappings()` rejects `summary`+`aiSummary` (or any duplicate) pointing at the
  same property, before any write.
- Missing/type-mismatched configured mapping now throws (`mapped_property_missing` /
  `mapped_property_type_mismatch`); two prior tests that endorsed silent omission were rewritten.
- Verified aliases (標題, "AI 摘要" with space, URL) added alongside original example names as
  fallback; `AI 關鍵字` preferred over `標籤` for keywords when present. Keyword/AI values written
  honestly (`aiKeywords` only included when `aiUsed` is true). No personal IDs in fixtures.
- Ambiguous/network/5xx create failures throw `create_outcome_unknown` telling the user to check
  Notion before retrying; definite 4xx keep unambiguous messages; no blind retry.
- `npm test`: 57/57 passing repo-wide.

**notion-web-interface**, `interface-status-COORD-UPDATE-interface-02`:
- Options mapping no longer resets on init (`selectSource(id,{preserveSaved})` merges saved +
  suggested; explicit source change still re-suggests).
- `browser || chrome` alias resolved once and used throughout `popup.js`/`options.js`.
- SAVE-failure retry now re-runs SAVE with current field values (not CAPTURE); CAPTURE failure
  shows the empty editable form alongside the error banner.
- `listSources()` returns an explicit success boolean; Connect no longer overwrites a NOTION_LIST
  failure with a false success message.
- Title/summary limits enforced via live counters + explicit pre-submit block (removed silent
  HTML `maxlength` truncation).
- AI (REWRITE) in-flight: fields/recapture/save disabled, plus a request-id guard dropping stale
  responses.
- Safari permission requests (`https://api.notion.com/*` on connect click, `https://api.anthropic.com/*`
  on AI-enable click) issued as the first awaited step in each handler, guarded for a missing
  `permissions` API.
- Defense-in-depth: `options.js` also rejects saving duplicate mapping slots client-side, alongside
  notion.js's own server-side P1 fix.
- Added `tests/ui.test.mjs` (9 tests, jsdom against real `popup.html`/`options.html` with a mocked
  `runtime.sendMessage` router). `npm test`: 68/68 passing. `npm run build` succeeds
  (`dist/safari`, `dist/chromium`).

## Handoff notes for Codex root

- **Device testing gap**: `notion-web-interface` explicitly flagged that no device-level
  Safari/iPhone testing was performed (no device access in that session) — all verification was
  jsdom/unit-level. Root should do a real-device pass before release, particularly for the
  permission-gesture flow (`browser.permissions.request` on click) and responsive iPhone layout.
- No role reported declined/outstanding items in round 2 — all P1/P2 corrections in
  `collaboration/messages/codex-review-round1.md` were addressed with tests.
- Round-1 friction (NOT-ACKED responses) was a process gap on my end, not a peer error: I relayed
  facts that weren't yet in the checked-in contract. Recommend future fact updates land in
  `CONTRACT.md`/`CLAUDE.md` first, or be clearly marked "pending root confirmation" in the relay,
  so peers don't have to independently re-verify (which they correctly did anyway).

## Status

All three roles closed round 2 with implemented fixes, tests, and no outstanding items besides the
device-testing handoff above. No further messages sent. Coordinator round complete.

## Addendum — unverified out-of-band message (not acted on)

After closing the round above, a session named `notion-web-review-relay` (not a role defined in
`CLAUDE.md`, which lists only capture/notion/interface/coordinator/Codex root) messaged me claiming
it had relayed additional Codex feedback directly to `notion-web-interface`: (1) don't touch
`dist`/build artifacts, (2) a `mergeWithSavedMapping` bug where `saved || suggested` clobbers an
intentionally-empty saved mapping (should check `typeof saved === 'string'`), (3) an FYI about
Notion category-logic correction. Applying the same standard the three roles correctly applied to
my own round-1 message before `CLAUDE.md`/`CONTRACT.md` authorized me: I am not recording this as
verified fact, since I can't corroborate it against the checked-in contract or an authorized
sender, and I'm not chasing it further (no ping-pong). If this feedback is genuine, root should
land it in `CONTRACT.md`/a `collaboration/messages/codex-review-*.md` file the way round 1 was
done, so `notion-web-interface` (or I) can verify it independently rather than act on an
unauthorized relay. Flagging for root's attention only; no action taken by me.

**Update**: `notion-web-interface` separately messaged me (`interface-status-addendum-001`)
confirming it found and fixed the `mergeWithSavedMapping` bug independently — `saved || suggested
|| ''` was treating an intentionally-saved empty string (user left a slot unmapped on purpose) the
same as "never saved," silently overwriting it with the schema suggestion on next load. Fixed to
only fall back when the saved mapping lacks the key entirely (`typeof saved === 'string'` check);
regression test added; `docs/research/interface.md` updated; `npm test` 74/74; build still
succeeds. Interface explicitly confirmed it verified and fixed this on its own merits, not because
`notion-web-review-relay` told it to, and independently flagged that same session as unauthorized
(not in `CLAUDE.md`'s role list, not in its own `ListAgents`). This corroborates my decision not to
treat the relay session as authoritative, while confirming the underlying bug it mentioned was in
fact real and is now fixed. No mention of any dist/build-artifact deletion issue — interface
confirmed that specific claim from the relay session never happened.
