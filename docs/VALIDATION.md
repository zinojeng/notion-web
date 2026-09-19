# Verification record — v0.1.0 preview

Date: 2026-09-20. This records what was tested, not a guarantee for every Facebook layout or Apple device.

## Passed

- `npm run check`: **75 tests passed**, then esbuild produced both `dist/safari` and `dist/chromium`.
- DOM fixtures: articles, selected content, Facebook feed ambiguity, correct permalink post identity, external-link lookalikes, URL preservation, hidden/script content, paragraph boundaries, images and responsive/relative URLs, explicit long-content warnings.
- Notion API mocks: current version/data-source parent, pagination, typed properties, real-world Chinese aliases, duplicate/missing/incompatible mapping rejection, original text chunking, partial-write reporting, bounded read retry, no blind create/append retry, optional images, preservation of topical categories.
- Controller/AI: privileged sender rejection, credential redaction and clearing, serialized settings mutations, duplicate saves, invalid and oversized input rejection, explicit AI invocation, malformed output, immutable source body/URL.
- UI with JSDOM: Chrome namespace fallback, incomplete setup recovery, saved custom and intentionally empty mappings, API permission denial, failed-save retry retaining edits, manual capture fallback, AI editing protection, mapping conflict and connect-error handling.
- Shell helpers: syntax, launcher dry-run/repeated-start safety, named role selection, live/completed/stopped behavior. Native packaging script fails with actionable guidance when Xcode is unavailable.
- Safari **26.6.2 on macOS 26.6.2**: local HTTP synthetic UI demo rendered; edited Traditional Chinese title remained after simulated save failure and retry. This used mocked extension messages, not Safari extension APIs or live Notion writes.

## Not performed / required for device acceptance

- Native Safari extension load: reached Safari's Add Temporary Extension control, but macOS required the user's password for unsigned development extension authorization. Prompt was cancelled; system authorization must be performed by the user. No security setting was changed.
- Signed macOS/iPhone build or installation: this machine has Command Line Tools, not full Xcode. No signed app, TestFlight build, or App Store submission was produced.
- Live Notion create/read or live Claude rewrite from the extension: no user's API tokens were provided. The target database schema was checked read-only through the user's connected Notion tool; those private IDs/content are excluded from the public repository.
- Actual Facebook desktop/mobile account DOM extraction and iPhone permission/lifecycle behavior require installed-extension device testing. Fixture coverage is not a substitute.

## Known boundaries

- A Safari extension reads Safari pages. This version has no native iOS Share Extension for the Facebook App; URL-only shares must be opened in Safari or supplemented with pasted text.
- Source text cap: 80,000 characters, with a warning. AI input cap: 24,000 characters, with a warning; saved source text is preserved. Over-limit manual edits are rejected instead of silently cropped.
- Local titles/summaries/keywords are deterministic heuristics. AI is optional, fallible, and billed separately by the user's API account.
- External images may expire or need authentication; this is not screenshot/archive storage.
- Unsaved edits survive retries in the same popup but **not popup closure**. No persisted draft queue.
- URL deduplication needs a correctly mapped URL property. It is a best-effort per-source check, not a distributed uniqueness guarantee across devices. After an ambiguous write failure, check Notion before retrying.
- Tokens use extension local storage, not Keychain. There is no managed OAuth service or cross-device credential sync.

## Device acceptance checklist

1. Install on Mac and iPhone using [INSTALL.md](INSTALL.md); grant current-page/API permissions.
2. Connect a dedicated test Notion source and verify title, summary, URL, original body, images opt-in and AI off/on behavior.
3. Test one Facebook permalink, a selected post on a feed, a login-gated page, expanded/collapsed text, and a link-only share.
4. Deny permissions, remove database access, simulate network loss and close/reopen popup; verify actionable errors and no misleading success.
5. Review duplicate handling and long-content partial-write recovery before wider use.

Independent review and corrective implementation provenance: [codex-review.md](codex-review.md). Actual Claude role research/workflows and peer exchange receipts: [research/](research/).
