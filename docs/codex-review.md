# Codex correctness and security review

Review date: 2026-09-20. This review followed the named Claude Code capture, Notion, and interface sessions. Codebase graph discovery was used first, followed by source inspection and local mocked/JSDOM reproductions. No credentials, private page contents, or live Notion writes were used by this reviewer.

The initial review was independent and read-only. After the Claude capture session handed off its files, the reviewer implemented the narrowly scoped capture corrections listed below. The root Codex integrator reviewed and accepted those edits. That later implementation work is distinguished from the independent findings.

## Findings and corrections

| Priority | Reproduced problem | Correction and evidence |
| --- | --- | --- |
| P1 | A Facebook `/posts/222` page with post 111 first in DOM captured post 111 and its URL. | Match the requested post identity; fail closed when no rendered post matches. Capture regression fixtures cover reordered and mismatched posts. |
| P1 | Selecting across posts expanded extraction to their entire common container. | Use only the explicitly selected text when its container spans multiple posts; avoid guessing an author or permalink. |
| P1 | Reopening settings replaced a saved custom field mapping with automatic suggestions. | Preserve saved mappings, including explicit empty values, on initial load; use suggestions when explicitly choosing another source. Both cases have UI regressions. |
| P1 | Mapping summary and AI summary to the same property silently replaced a real summary with an empty value. Stale optional property mappings were silently skipped. | Reject duplicate mappings and configured fields that are missing or have incompatible types before creating a page. Notion and UI regression cases cover these failures. |
| P2 | Overlapping partial settings saves could restore an old token. | Serialize settings writes and read the latest value inside the write queue. A concurrent-write regression covers credential preservation. |
| P2 | Retrying a failed save reran capture, discarding user edits. Failed capture also hid the manual-entry form. | Retry the failed operation with current edits, and expose manual entry after capture failure. UI regressions cover both paths. |
| P2 | An AI response could overwrite edits made while it was running. | Lock editable controls, recapture, and save during AI processing; ignore stale responses. Covered by a deferred-response UI test. |
| P2 | Editable field limits exceeded the background limits, and oversized text or URLs were silently truncated. | Reject excessive title, summary, original-text and URL input with actionable errors. Check the normalized URL too. UI counters and controller regressions cover this behavior. |
| P2 | The Chromium build called `browser.*` from its UI without a namespace fallback. | Use the available browser or Chrome namespace in both UI pages. A Chrome-only UI fixture verifies capture. |
| P2 | Notion connection failure was overwritten by a success message. | Return connection success explicitly and preserve errors. A failed-list UI regression verifies it. |
| P2 | Capture-source labels such as `article` were automatically inserted into the user's topical 分類 taxonomy. | Leave category unset unless an explicit value matches an existing schema option. The current UI makes no automatic topical classification. |

Additional capture corrections authored by Codex and reviewed by the integrator:

- Selected Facebook text now receives a body-derived topic title rather than `(2) Facebook`; author and timestamp chrome are excluded from the derived title/summary while the captured original remains available.
- Paragraph and line-break boundaries survive extraction. Script, style, template and explicitly hidden content are excluded.
- Permalink candidates must belong to the real Facebook domain. External `/posts/` links and lookalike domains cannot replace the source URL. Matching can find a later link belonging to the requested post.
- Relative image URLs are resolved against the page, and a loaded responsive image's `currentSrc` survives the detached clone.

The targeted capture suite passed all **27 tests**, including five new regressions for those corrections. These are synthetic DOM tests, not evidence that every current Facebook layout is supported.

## Final targeted follow-up

Both remaining UI corrections were rechecked on the frozen implementation and are resolved:

1. Deliberately unmapped fields saved as `''` remain unmapped when settings reopen. The merge distinguishes a saved string from an absent key. A dedicated regression passes.
2. Setup requires both a Notion token and a selected data source. An incomplete setup keeps the banner visible and save disabled. An always-visible settings button opens options. The setup regression passes.

The reviewer reran the final targeted UI/setup suites: **11/11 passed**. The integrator reported **75/75 tests passed** and successful Safari and Chromium JavaScript bundles on the frozen tree. No outstanding blocking finding remains in this reviewed scope; the platform and persistence limitations below still apply.

The integrator also verified a synthetic HTML popup preview in Safari, including preservation of an edited title on a mocked save retry. That checks the rendered UI with mocked browser/API responses; it is not an installed Safari extension, native packaging, iPhone, or live Notion transaction test.

## Security and failure behavior checked

Privileged messages require the extension's own ID and exact popup/options URL. Page-derived strings enter the UI as text or form values. API credentials are withheld from settings responses and page injection, and requests are sent from extension-owned code. AI transmission is a separate explicit action. Images are opt-in.

Concurrent saves of the same destination and normalized URL are coalesced within the background process. Existing pages are queried by the configured URL property. Create/append requests are not blindly repeated after an uncertain failure; partial content writes expose the existing page URL. Long body text is split into bounded Notion rich-text parts and child batches.

Safari's nonpersistent background-page choice is consistent with Apple's Manifest V3 guidance. This is a documentation check, not a runtime claim. [Apple Safari Web Extensions guidance](https://developer.apple.com/videos/play/wwdc2022/10099/). Notion payload sizes and uncertain-write handling were checked against its API limits. [Notion request limits](https://developers.notion.com/reference/request-limits).

## Remaining limitations

- Popup drafts are not persisted across closure. Save or copy manual edits before closing the popup or opening another page.
- No signed native build, iPhone device run, or real Notion/Claude API end-to-end transaction was validated by this review. Mocked API tests and JavaScript builds do not establish those outcomes. Any separate browser smoke checks must state their actual scope.
- An iPhone Safari extension reads a permitted Safari page. Receiving a Facebook native-app share payload requires a separate native Share Extension and is not implemented here.
- Facebook capture depends on visible DOM structure. Expand the post first; use the selection/manual-entry fallback when extraction is ambiguous or incomplete. Local titles and summaries are extractive; optional AI output still needs review.
- Duplicate detection depends on a mapped URL property and normalized URL equality. It cannot guarantee equivalence of every Facebook alias or a transaction across browser restarts/devices. Check Notion before retrying a write whose outcome is unknown.
- Tokens are kept in local extension storage, not an encrypted credential vault. External image links may expire or require authentication; this version does not upload screenshots or private images.
