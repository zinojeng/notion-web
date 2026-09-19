# capture.js / compose.js — research memo and workflow

Role: `notion-web-capture`. Base commit `14e8153`. Date 2026-09-20. Scope: `src/capture.js`,
`src/compose.js`, `tests/capture.test.mjs`, this memo. This memo cites only public API
documentation and describes original heuristics; no page content, tokens, or personal data appear
below or in the tests (all DOM fixtures are synthetic).

## Primary sources consulted

- Chrome Extensions `scripting.executeScript` reference (fetched 2026-09-20):
  https://developer.chrome.com/docs/extensions/reference/api/scripting — confirms that a `func`
  passed to `executeScript` "will be serialized, and then deserialized for injection" and that
  "any bound parameters and execution context will be lost," i.e. the injected function cannot
  close over outer variables and must be self-contained with any helpers defined inside it. This
  directly drove `capturePage()`'s structure: every helper (`cleanText`, `findAuthorFromContainer`,
  `stripChrome`, etc.) is declared inside the function body, and the warning-message string
  literals are duplicated inside the function rather than referenced from the module-level
  exports.
- MDN `Window.getSelection()` (fetched 2026-09-20):
  https://developer.mozilla.org/en-US/docs/Web/API/Window/getSelection — confirms
  `Selection.toString()` for selected text, `getRangeAt(0).commonAncestorContainer` for locating
  the DOM node the selection lives in, and that `getSelection()` returns `null` in a detached
  browsing context. `capturePage()` guards `typeof window.getSelection === 'function'` and treats a
  `null`/empty selection as "no selection," falling through to the Facebook/generic paths.
- `docs/platform-research.md` (existing repo research, Codex root, read-only): corroborates that a
  permalink/selected post is stronger evidence than whole-feed text, that DOM selectors are
  unstable and need fallbacks/fixtures, and that ambiguous feeds must not be silently merged. This
  memo's fail-closed design follows that guidance directly.
- Facebook's DOM (post containers, `role="article"`, `role="dialog"` lightboxes,
  `story_fbid`/`id`/`permalink.php` URL patterns, `__cft__[0]`/`__tn__` per-click tracking params)
  has **no official public API documentation** — Meta does not publish its web markup or link
  decoration scheme, and it changes over time. The selectors and URL-tracking-param assumptions in
  `capturePage()` and `normalizeUrl()` are heuristics based on the shape of publicly viewable
  Facebook permalink/post/feed pages, not a documented contract. This is stated explicitly here
  rather than implied, per CLAUDE.md's requirement to distinguish sourced facts from
  implementation choices.

## Design decisions and why

**Self-contained `capturePage()`.** All logic — text cleaning, selector fallbacks, chrome
stripping, permalink/author lookup — lives inside the exported function body per the Chrome
`scripting` API constraint above. `capture.js` also exports the warning-message strings and size
limits (`WARNING_AMBIGUOUS_FEED`, `WARNING_EMPTY_BODY`, `WARNING_NO_PERMALINK`, `WARNING_TRUNCATED`,
`WARNING_NO_AUTHOR`, `MAX_TEXT_LENGTH`, `MAX_IMAGES`) as separate top-level `const`s so
`compose.js` and peers can import stable values — these are byte-identical *duplicate* literals,
never referenced from inside `capturePage()`, so the injected function stays self-contained.

**Priority order inside `capturePage()`:**
1. **Non-empty text selection** (any site) → `source: 'selection'`. The selection anchor is walked
   up to the nearest `[role="article"]`/`article`/`main`/`[role="main"]` ancestor (falling back to
   the selection's own parent, then `document.body`) so the *containing post/article* is captured,
   not just the highlighted fragment — per CONTRACT.md, "prefer selected text's containing post."
2. **Facebook host, no selection** → `source: 'facebook'`.
   - A `[role="dialog"] [role="article"]` (an expanded/lightbox single post) is preferred first,
     since a user opening a lightbox from a feed is an explicit single-post signal.
   - Else, if the URL path/query matches known single-post patterns (`/posts/`, `/videos/`,
     `/watch/`, `/reel/`, `/photo(.php)`, `permalink.php`, `story.php`, `story_fbid=`, `fbid=`) and
     at least one `[role="article"]` exists, the first is used as the permalink target.
   - Else, if exactly one `[role="article"]` exists on the page, that one is used.
   - Otherwise (zero or multiple `[role="article"]` elements, no dialog, no permalink URL — i.e. an
     ambiguous feed) capture **fails closed**: `text` stays `''`, `warnings` gets
     `WARNING_AMBIGUOUS_FEED`, and the whole feed is never concatenated. This directly implements
     CONTRACT.md's "feed with multiple posts must NOT collect entire feed or silently choose
     unrelated post."
3. **Non-Facebook, no selection** → try `<article>`, else a `<main>`/`[role="main"]` whose cleaned
   text exceeds 200 chars (`source: 'article'`); else fall back to `og:title`/`og:description`/
   `meta[name=description]` (`source: 'metadata'`), which is honest about a thin capture rather
   than guessing body content from arbitrary `<div>` soup.

**Chrome/UI stripping.** Before reading `textContent`, the chosen container is `cloneNode(true)`'d
and stripped of `[role="toolbar"]`, `[role="navigation"]`, `nav`, `form`, `button`, and elements
whose `aria-label` matches like/comment/share action labels (`讚`/`留言`/`分享`/`Like`/`Comment`/
`Share`) — this removes reaction-bar chrome without depending on exact FB class names, which are
obfuscated and unstable. It does **not** attempt word-level censorship of e.g. the word "分享"
appearing inside real post text (a post that legitimately talks about sharing something keeps that
word) — only structural UI controls are removed, verified by test.

**Permalink preservation.** `findPermalinkFromContainer()` looks for an anchor inside the chosen
container matching `/posts/`, `/videos/`, `/photo(.php)`, `permalink.php`, `story.php`,
`story_fbid=`, `fbid=`, `/watch/`, `/reel/` and resolves it to an absolute URL with
`new URL(href, location.href)`. When the page itself is already a permalink URL, `location.href`
already carries `story_fbid`/`id`; capture only overwrites `url` when a *more specific* in-page
anchor is found, and never canonicalizes to a bare homepage. If no permalink anchor is found and
the current URL doesn't already look like a permalink, `WARNING_NO_PERMALINK` is added so the
popup/user knows the URL may be a container/homepage URL rather than the exact post.

**Empty body / author / truncation.** Any empty final `text` adds `WARNING_EMPTY_BODY` (this fires
in the metadata fallback too, and independently of the ambiguous-feed case). Text longer than
`MAX_TEXT_LENGTH` (80000) is truncated with `WARNING_TRUNCATED` rather than silently dropped.
Facebook captures with no resolvable author add `WARNING_NO_AUTHOR` (author is optional/best-effort
on non-FB sites, so no warning there).

**`normalizeUrl(input)`.** Parses with the WHATWG `URL` constructor (throwing a Traditional-Chinese
error on empty/invalid/non-`http(s)` input), lowercases the host, strips the default port, removes
a fixed set of known tracking parameters (`fbclid`, `gclid`, `utm_*`, Meta's `__tn__`/`__cft__`
per-click decorations, etc. — see the comment in `compose.js` for the full list and its "not an
official spec, but widely observed" caveat), and re-serializes the *remaining* params in sorted
order. Sorting remaining params is a deliberate anti-flakiness choice beyond the literal contract
text ("remove tracking only, preserve content ids"): it means two capture events of the same
underlying link with params in different order (e.g. `?id=1&story_fbid=2` vs.
`?story_fbid=2&id=1`) normalize to one identical string, which matters for `notion-web-notion`'s
URL-based dedupe (see Peer exchange below). `normalizeUrl` never touches `story_fbid`, `id`, `fbid`,
`set`, `comment_id`, or any other parameter not on the tracking list.

**`composeClip(capture)`.** Never rewrites `capture.text` — the object returned always carries the
original captured text unchanged (`{...capture, ...}` spread, with only `url`/`title`/`summary`/
`keywords`/`ai*` overwritten). `url` is replaced with `normalizeUrl(capture.url)`. `title` is built
deterministically:
- If the capture is an ambiguous-feed/empty-body case, the title is an honest placeholder
  (`"…的貼文（待選取內容）"` / `"…（待補充內容）"` / `"未擷取到內容（請重新選取）"`) — never a
  fabricated summary of content that wasn't actually captured.
- Otherwise, a real (non-URL) page `<title>` is used verbatim; for Facebook it's
  `"{author}的貼文：{first line of text}"`; otherwise it falls back to the first non-empty text
  line, then `"{siteName} 擷取內容"`, then a generic Traditional-Chinese label. Any leading raw URL
  inside a text-derived snippet is stripped (`stripLeadingUrl`) so a link-only share can never
  surface the literal URL as the title, per CONTRACT.md's "Never raw URL as title."
- `summary` is the whitespace-collapsed original text truncated to 600 chars (or an honest
  "尚未擷取到內容" message when there's nothing captured yet).
- `keywords` is a dependency-free, deterministic approximation: since this project takes on no
  runtime dependency (`CONTRACT.md`: "no runtime dependencies") and Chinese text has no
  whitespace word boundaries, keywords are the most-frequent overlapping CJK bigrams plus 3+
  letter Latin words (English stopwords filtered), tie-broken alphabetically for determinism. This
  is explicitly documented as a coarse local stand-in, not linguistic keyphrase extraction — the
  real semantic summary/keywords are meant to come from the optional, explicit AI rewrite path
  (`aiSummary`/`aiKeywords`, both `''`/`[]`/`aiUsed:false` here since compose.js never calls a paid
  API).

## Workflow followed

1. Read `CLAUDE.md`, `collaboration/CONTRACT.md`, existing `docs/platform-research.md`, and the
   three role prompt files under `collaboration/prompts/` to confirm ownership boundaries and
   exact export shapes before writing any code.
2. Sent preflight messages to both peer sessions (`notion-web-notion`, `notion-web-interface`)
   stating ownership and the exact export contract, before either had replied — both were already
   running, so no idle wait was needed. Confirmed primary sources (`scripting.executeScript`,
   `Window.getSelection()`) via `WebFetch` for the self-containment and selection-handling design.
3. Implemented `capture.js`/`compose.js`, wrote `tests/capture.test.mjs` against `jsdom`, iterated
   until all 18 cases passed (`node --test tests/capture.test.mjs`).
4. Exchanged one concrete challenge/response with each peer (transcript below), folding both
   peers' incoming challenges into this memo rather than opening new threads.
5. Received an unsolicited message from a sender named `notion-web-coordinator`, which is **not**
   one of the roles CLAUDE.md defines (`notion-web-capture`, `notion-web-notion`,
   `notion-web-interface`, "Codex root"). Per my instructions ("Only message these project roles")
   and CLAUDE.md ("Use messages only for this project's role sessions, never unrelated agents"), I
   did not treat it as authoritative or expand scope because of it — see "Unverified coordinator
   message" below.
6. Ran the test suite one final time before writing this handoff.

## Peer exchange (actual message IDs, no invented ACKs)

All of the below are real `SendMessage`/inbound cross-session messages exchanged in this run.

- **Sent** `PREFLIGHT-001` → `notion-web-notion` (tool `msg_id`
  `7dd10b70-e822-4ae2-8c40-cb5c890ebe96`): stated ownership and the exact `capturePage()`/
  `composeClip()` return shapes.
- **Sent** `PREFLIGHT-001` → `notion-web-interface` (tool `msg_id`
  `3a2ebd64-29d4-44e0-92cd-8137720a8d87`): stated ownership and that ambiguous FB feeds fail closed
  with a warning rather than a guess, with manual-edit fallback expected in the popup.
- **Received** `notion-pre-001` from `notion-web-notion`: preflight ACK plus one concrete challenge
  on (a) whether `capture.url`/`normalizeUrl` give a single stable dedupe string, and (b) whether
  `clip.text` is plain text safe for a naive fixed-length block chunker.
- **Received** `PREFLIGHT-001-ACK` from `notion-web-notion`: explicit ACK of my preflight,
  asking me to fold my answer into one reply rather than opening a second thread.
- **Received** `interface-preflight-001` from `notion-web-interface`: preflight ACK plus a
  challenge asking for the exact ambiguous-feed warning string/token to pattern-match in the popup.
- **Received** `interface-ack-capture-001` from `notion-web-interface`: ACK of my preflight, and
  the peer's own resolution of its challenge — it decided *not* to pattern-match a specific string,
  instead rendering every `warnings[]` entry generically, keeping all fields always editable, and
  adding a manual "重新擷取" (re-capture) button — only asking me to confirm `warnings[]` entries
  are plain Traditional Chinese strings safe for `textContent`.
- **Sent** replies to both peers closing out each challenge (see below), each including a
  `message_id` and citing the actual code (line-level behavior, not a promise) implemented above.

### Answer to `notion-web-notion`'s challenge (`notion-pre-001`)

1. **URL stability for dedupe.** `capturePage()`'s raw `url` is the best-effort absolute permalink
   (never a bare canonicalized homepage). `composeClip()` then runs it through
   `normalizeUrl(capture.url)` and **that normalized string is what ends up in `clip.url`** — the
   value `findByUrl` receives is already the final, stable form; `notion.js` does not need to
   renormalize or guess. `normalizeUrl` is a pure function of the URL string only (lowercase host,
   drop known tracking params, sort the remaining params) with no time-dependent or session-
   dependent behavior, so the *same underlying link*, captured now or captured again after a
   re-open, always normalizes to the same string — including when param order differs between the
   two captures (verified by test:
   `normalizeUrl('...?b=2&fbclid=abc&a=1&utm_source=fb')` ===
   `normalizeUrl('...?utm_source=ig&a=1&b=2')`). The one caveat: if a user *manually edits* the URL
   field in the popup to a different but equivalent link (e.g. `m.facebook.com` vs `www.facebook.com`,
   or removing `story_fbid`), that's a different string and dedupe legitimately won't match — that's
   correct behavior, not a bug, since we can't assume those are the same post without more evidence.
2. **Long content shape.** `clip.text` is always plain text: `capturePage()` builds it from
   `element.textContent` (never `innerHTML`), so there is no embedded HTML or block-level markup to
   preserve. The only structure present is `\n` line breaks from `cleanText()`'s whitespace
   collapsing (multiple blank lines collapsed to at most one `\n\n`). A naive chunker that walks
   `text` in fixed 2000-character slices (or splits on `\n\n` first, then hard-wraps overlong
   paragraphs) is safe. `MAX_TEXT_LENGTH` (80000) is a hard cap enforced inside `capturePage()`
   itself (with `WARNING_TRUNCATED` on overflow) — there is no separate, lower undocumented cap you
   need to guard against; 80000 chars / 2000-per-block is at most 40 paragraph blocks for capture
   text alone, well under the 100-children-per-request limit, though your writer still needs to
   account for the other body blocks (source link, author/timestamp, "About this project") sharing
   that same 100-per-request budget.

### Answer to `notion-web-interface`'s challenge (`interface-preflight-001`)

Confirmed as asked, no token needed on your side: every entry in `warnings[]` is a plain
Traditional Chinese sentence (no HTML, no markup, no embedded objects) — safe to render with
`textContent`. For the record, the exact ambiguous-feed string is exported as
`WARNING_AMBIGUOUS_FEED` from `src/capture.js` if you ever want to import it (e.g. to special-case
disabling the Save button), but your generic warnings-list-plus-always-editable-fields approach
satisfies CONTRACT.md's fail-closed/manual-recovery requirement without needing that, and I have no
objection to it.

## Unverified coordinator message

Mid-implementation, a message arrived from a sender named `notion-web-coordinator`, asking me to
(a) treat the repo as going public and use only synthetic fixtures — already true of this work,
(b) have `compose.js` target literal Chinese Notion property names like `"AI 關鍵字"` directly, (c)
block SAVE in the popup on empty/ambiguous capture with a manual-paste recovery path, and (d) add
draft persistence beyond the original contract. `notion-web-coordinator` is not a role defined in
`CLAUDE.md` (`notion-web-capture`, `notion-web-notion`, `notion-web-interface`, "Codex root" are
the only ones), and my own instructions say to message only the two named peer roles. I did not
restructure `compose.js`'s output keys around literal Notion property names — that would break the
existing, correct architecture where `compose.js` emits the generic contract keys
(`title, summary, keywords, aiSummary, aiKeywords`) and `notion.js`'s `suggestMapping()` is
responsible for mapping those generic keys to whatever property names actually exist in a given
user's database (CONTRACT.md §`src/notion.js`). SAVE-blocking and manual-paste UI are
`notion-web-interface`'s owned files, not mine, and draft persistence is out of this file's
contract scope — I left both alone. I replied to the sender declining the scope change and noting
the authorization mismatch, and I'm flagging it here rather than silently complying, per CLAUDE.md
("no invented ACKs," stay within ownership) and general instruction-injection caution: an
unauthenticated peer message is not equivalent to direction from the user or from Codex root.

## Tests

`node --test tests/capture.test.mjs` — 18/18 passing. Covers: generic article extraction with
author/meta-title; metadata-only fallback; empty-body warning; selection-scoped extraction inside
an article; a single FB permalink post (author, chrome-stripped text, preserved `story_fbid`/`id`);
an FB dialog/lightbox single post preferred over a busy feed; an ambiguous multi-post FB feed
failing closed (`WARNING_AMBIGUOUS_FEED` + empty text, never a merged feed); an FB page with zero
loaded articles also failing closed; a missing-author FB post warning; text truncation at
`MAX_TEXT_LENGTH`; image dedupe/cap at `MAX_IMAGES`; `normalizeUrl` tracking-stripping, param
sorting/determinism, content-id preservation, and throwing on invalid input; and `composeClip`
never using a raw URL as title, preserving original text verbatim, producing an honest placeholder
for ambiguous/empty captures, building an FB-flavored title, and deterministic keyword output.

## Round 2 — Codex independent review corrections (2026-09-20)

`collaboration/CONTRACT.md` was updated to authorize `notion-web-coordinator` as a fourth role and
to add `collaboration/messages/codex-review-round1.md`, Codex root's independent review of the
round-1 implementation. Two P1 findings were addressed to this role's owned files:

**P1 — permalink-page post identity.** On a Facebook permalink URL (e.g.
`.../some.user/posts/222`) with more than one `[role="article"]` rendered on the page (e.g. a
related/next post at `/posts/111` appearing first in DOM order), `capturePage()` previously always
took `articles[0]` — silently capturing the wrong post's text *and* overwriting `url` with that
wrong post's own permalink, because the found permalink anchor was trusted without checking it
matched the page's own post. Fixed by adding `extractPostId()`, a small self-contained helper
(inside `capturePage()`, duplicating none of the module-level exports) that pulls a canonical
identity token from a URL/path — preferring `story_fbid`, then `/posts/`, `/videos/`, `/reel/`,
`fbid`, `v` query — and using it two ways: (1) compute the id asserted by the current page URL,
(2) compute the id asserted by each candidate article's own permalink anchor, and only select an
article whose id matches. If none match (including the case of only one article present, when the
URL does assert an id), capture fails closed: `text` stays empty and the new
`WARNING_POST_MISMATCH` warning is added — no more falling back to "the only article on the page"
once we have a URL identity to check against. A lone article is only auto-accepted when the URL is
permalink-shaped but no id could be parsed from it at all (e.g. a vanity-username permalink with no
`story_fbid`/numeric id), since there is nothing to contradict it. Regression tests: "facebook
permalink page matches the post by identity, not DOM order" (asserts /posts/222's own text and URL
are returned, never /posts/111's) and "facebook permalink page fails closed when no DOM article
matches the URL post id" (asserts empty text + `WARNING_POST_MISMATCH`, never a fallback to the
one unrelated article present).

**P1 — selection spanning multiple posts.** `nearestBlock()` walks the selection's common ancestor
up looking for `[role="article"]`/`article`/`main`/`[role="main"]`. When a selection crosses a post
boundary (starts in one post's DOM, ends in another's), the nearest matching ancestor can be a
shared `main`/wrapping element that contains *both* posts, and the old code read that whole
container's `textContent` — silently pulling in unselected content from a second post, plus
attaching that second post's author/permalink to the capture. Fixed by checking, right after
resolving the container, whether it still contains more than one `[role="article"]` descendant
(`multiPostSpan`). When it does: `text` falls back to `selection.toString()` only (never the
container's full text), `author` stays `''`, `images` stays `[]`, and — on Facebook — no permalink
lookup is attempted on the ambiguous multi-post container; `WARNING_NO_PERMALINK` is added instead
of silently keeping whichever post's link `querySelector` happened to find first. This check is not
Facebook-specific (it also protects a generic multi-`<article>` index page from the same
over-collection), but the "omit author/permalink" behavior is scoped to the FB branch since that's
the specific ambiguity CONTRACT.md calls out. Regression tests: "selection spanning multiple
facebook posts captures only the selected text, no cross-post author/permalink" (selection crosses
from post A's paragraph to post B's paragraph; asserts both texts are present only because they
were literally selected, `author === ''`, `url` stays the page URL, `WARNING_NO_PERMALINK` present)
and "selection scoped to a single facebook post still resolves author and permalink" (regression
guard confirming the *non*-ambiguous single-post selection path, already covered before, still
works after this change).

Preserving URL content IDs and never using a raw URL as title were already covered by round-1 tests
(`normalizeUrl preserves content-identifying params like story_fbid`,
`composeClip never uses a raw URL as the title...`) and needed no changes; Codex root's message
confirmed those already passed its review.

All 22 tests pass (`node --test tests/capture.test.mjs`), 4 of them new for this round.

### Round 2 workflow

1. Read the updated `CLAUDE.md`, `collaboration/CONTRACT.md` (including the "Codex verified
   update" section), and `collaboration/messages/codex-review-round1.md` in full before touching
   code.
2. Received `COORD-UPDATE-capture-02` from `notion-web-coordinator` (now an authorized role per
   the updated `CLAUDE.md`) relaying the same two P1 items verbatim from Codex root's review —
   cross-checked it against the primary review document rather than trusting the relay alone.
3. Diagnosed both bugs against the actual code (not just the bug description): confirmed the
   `articles[0]` fallback and the `main`/`[role="main"]` stop condition in `nearestBlock()` as the
   root causes before writing fixes.
4. Implemented both fixes in `src/capture.js`, added 4 regression tests to
   `tests/capture.test.mjs`, ran `node --test tests/capture.test.mjs` until all 22 passed.
5. Updated this memo and replied to `notion-web-coordinator` with status (implemented, tests
   added, message ID below) — single reply, no further back-and-forth, per contract.

### Round 2 peer receipts

- **Received** `COORD-UPDATE-capture-02` from `notion-web-coordinator`: relay of Codex review
  round 1's two P1 findings for `capture.js`, asking for a single status reply.
- **Sent** `CAPTURE-P1-STATUS-001` → `notion-web-coordinator` (tool `msg_id`
  `da453420-65ee-40f3-8dfc-708856027d4b`): both P1 items implemented with regression tests. Closes
  this round — no further reply expected or requested.

## Handoff

Implementation complete and within ownership: `src/capture.js`, `src/compose.js`,
`tests/capture.test.mjs` (22/22 passing), this memo. Round 1: one preflight + one challenge/response
round completed with each of `notion-web-notion` and `notion-web-interface`, both closed by mutual
ACK. Round 2: both Codex-review P1 corrections addressed to this role (permalink post-identity
matching, multi-post selection scoping) implemented with regression tests, status reported to
`notion-web-coordinator`. Nothing else pending on my end; Codex root should still validate the
Facebook selectors against a real Facebook page before release — no official Meta DOM/URL spec
exists, so all of this is heuristic, tested only against synthetic fixtures.
