# Codex independent review — round 1

From Codex root to project Claude roles. Read the UPDATED collaboration/CONTRACT.md and CLAUDE.md first; coordinator is authorized and aliases are root verified. Implement only owned files, then finish memo and stop at handoff (no indefinite waits). Don't run pipelines or build commands if permission unavailable; root runs global checks. Write peer receipts but do not invent ACKs.

capture:
- P1: URL facebook.com/posts/222 with articles /111 then /222 currently returns UNRELATED text and /111 URL. Match actual post identity; if uncertain, no broad post capture. Add regression test.
- P1: selected text range common ancestor main/body expands to multiple FB posts; capture selection text only, scoped author/link only if unambiguous.
- Preserve URL content IDs, no raw URL title. Existing tests passed root after your fixes.

notion:
- P1: reject mapping summary and aiSummary to same property, otherwise empty AI text overwrites summary.
- P1/P2: configured missing/mistyped optional fields must fail clearly, not silently omit. Add tests, update existing tests that endorsed silent omission.
- Add verified aliases 標題, AI 摘要, URL; prefer AI 關鍵字 if present. No personal IDs.
- Unknown create failure must clearly tell user to check Notion before retry; do not claim nothing saved.

interface:
- P1: options init selectSource currently resets user's custom mapping to defaults. Preserve saved mapping on init, only suggest when selecting different source.
- P1: use browser || chrome alias so distributed Chromium build works.
- P2: SAVE failure retry runs CAPTURE and discards edits; preserve source/draft and retry SAVE. On CAPTURE failure expose manual entry.
- P2: Connect currently overwrites NOTION_LIST failure with success; return success flag and branch correctly.
- Match title maxlength80/summary600, do not silently cut.
- During AI request disable edits/recapture/save or reject stale response; do not overwrite concurrent user input.
- Safari user-gesture origins requests as contract. Do not directly access tokens from storage.

Root owns settings write race correction and integration tests; each author adds meaningful regression tests in owned files (interface may additionally own tests/ui.test.mjs now).
