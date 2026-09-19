# Safari / iPhone / Notion platform research

Research date: 2026-09-20. Role: platform and integration researcher. This document distinguishes verified platform behavior from implementation recommendations; it is not a device-test result.

## Recommended architecture

Build one HTML/CSS/JavaScript WebExtension for macOS Safari and iPhone Safari. Keep extraction in an injected content script, editing in an extension-owned popup, and credentials/API requests in extension-owned code. Use `activeTab` plus `scripting` for user-initiated capture, rather than continuously reading every website. Keep a local draft until saving succeeds.

Safari Web Extensions are supported on macOS Safari 14+ and iOS 15+, but that is the platform's baseline, not proof that every manifest/API choice works at those versions. Choose the release minimum after real-device validation. iOS backgrounds may be suspended, so don't rely on an always-running process. [Apple overview](https://developer.apple.com/documentation/safariservices/safari-web-extensions), [Safari optimization](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)

Recommended workflow:

1. Read the current page only when the user opens the clipper.
2. Prefer selected text; otherwise identify one article or Facebook post.
3. Create a short topic title, summary, keywords, original URL, and source-body draft.
4. Show editable fields and an explicit incomplete-capture warning when necessary.
5. Save properties and body into a configured Notion data source; return the created page URL.

For ambiguous Facebook feed pages, require choosing/selecting one post instead of silently combining multiple posts. Keep original text distinct from generated prose. Text from the website is input data, never an instruction to the AI or extension.

## Mac installation and packaging

Current Apple documentation includes temporary installation directly from a folder or ZIP: Safari Settings → Developer → Add Temporary Extension. It does not require creating an Xcode project. Safari removes temporary extensions after 24 hours or when Safari quits. If the installed Safari lacks that control, use a packaged extension built with Xcode instead. [Apple running guide](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)

For an Xcode project, the current tool name is:

```sh
xcrun safari-web-extension-packager /absolute/path/to/extension
```

Older Xcode releases call it `safari-web-extension-converter`; a build script should probe for both names and produce actionable installation guidance when neither exists. The tool produces the native containing app and extension project and reports unsupported manifest fields. Do not claim a native build passed without actually running Xcode build tools. [Apple packaging guide](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)

Apple also offers **Safari Web Extension Packager in App Store Connect**. An enrolled Apple Developer can create a macOS/iOS app record, upload the extension resources ZIP under Xcode Cloud, then use TestFlight and App Store review. This route does not require a local Mac or Xcode for a pure WebExtension. Native capabilities or a custom Share Extension still need a native project. [Apple App Store Connect packaging guide](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)

## iPhone Safari versus Facebook app sharing

The primary iPhone flow is: **open the Facebook permalink in Safari → expand the desired post → activate the Safari extension**. A Safari extension can inspect the permitted web page; it cannot inspect the DOM of the native Facebook app.

A share-sheet entry accepting content directly from the Facebook app is a **separate iOS Share Extension target**, not something enabled by the WebExtension manifest. It receives only the items supplied by the host application; a URL alone does not include a private post's text. Apple's Share Extension model provides attachments through `NSExtensionContext` and `NSItemProvider`. Safari can optionally run a JavaScript preprocessing file for a native Share Extension, but that facility does not create webpage access inside arbitrary native apps. [Apple Share Extension guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html), [Apple webpage preprocessing guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html)

A future native share target should accept URL/text/image attachments, preserve them in a draft, and prompt users to open Safari or paste text if the source shares only a URL. Shared configuration/drafts need explicitly configured App Groups; secrets should use Keychain with the necessary access group. This native target needs signing, entitlements, and a real-device check. It must not be described as implemented merely because the Safari extension runs on iPhone.

Notion's own help distinguishes its desktop browser extension from mobile sharing. It acknowledges Safari loading issues, warns that parsing differs by site, and says the mobile clipper does not support arbitrary other apps. That supports prioritizing reliable extraction and field mapping rather than trying to reuse the failing Notion UI/login flow. [Notion Web Clipper help](https://www.notion.com/help/web-clipper), [user-provided official page](https://www.notion.com/zh-tw/web-clipper)

## Verified Notion API contract

The latest documented API version at research time is **`2026-03-11`**. Send it in `Notion-Version` with `Authorization: Bearer …` and JSON content type. Notion URLs are display links, not stable record identifiers; prefer stored UUIDs and API-returned links. [Versioning](https://developers.notion.com/reference/versioning)

| Operation | Request | Purpose |
| --- | --- | --- |
| Discover sources | `GET /v1/databases/{database_id}` | Read `data_sources`; do not silently choose the first when several exist |
| Inspect schema | `GET /v1/data_sources/{data_source_id}` | Read property IDs, names, and types |
| Create clip | `POST /v1/pages` | Use `parent: {type: "data_source_id", data_source_id: "…"}` |
| Append longer body | `PATCH /v1/blocks/{page_id}/children` | Add more blocks in bounded batches |

Database IDs and data source IDs are not interchangeable. A linked database view may require sharing the original source database with the connection. [Retrieve database](https://developers.notion.com/reference/retrieve-database), [Retrieve data source](https://developers.notion.com/reference/retrieve-a-data-source), [data source migration](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)

For this user's database, infer only defaults from field names and verify against the live schema:

| User field | Intended write |
| --- | --- |
| Title / Name / New Project | The property whose type is `title`; concise, readable topic |
| 摘要* | `rich_text` summary if that is its actual schema type |
| AI摘要 | AI rewrite only when configured; otherwise clearly label any extractive fallback |
| AI 關鍵字 / 標籤 | `multi_select` or `rich_text`, according to schema |
| ~URL | `url`, containing the original/permalink URL |
| 分類 | Optional user-selected existing `select`/`multi_select` option |
| 圖檔 | Optional supported image URL/upload, according to actual `files` type |
| Status / Owner / Dates | Preserve defaults or write only explicitly configured valid values |
| 建立時間 | Omit if `created_time`; Notion computes it |
| About this project / 項目 | Body blocks, not automatically assumed database properties |

Creating a data-source child requires properties matching that schema. A page's body is supplied via `children`; computed timestamps and rollups cannot be written. Applying a Notion template is asynchronous and cannot be combined with `children` in the initial create request, so a simple body writer should avoid silently promising to apply an existing template too. [Create page](https://developers.notion.com/reference/post-page)

Use at most 2,000 characters per rich-text item and 100 elements per block/rich-text array. Cap request size below 500 KB, and report any truncation. Handle 429 with `Retry-After`. A timed-out create may have succeeded; don't blindly retry writes and create duplicate pages. [Request limits](https://developers.notion.com/reference/request-limits)

In `2026-03-11`, `in_trash` replaces `archived`; append positioning uses a `position` object rather than the old `after` string. These changes matter if adding deduplication, rollback, or ordered follow-up appends. [2026 upgrade guide](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)

## Credentials and AI behavior

A dedicated internal connection gives a small personal clipper an official token-based route without depending on Safari's Notion login cookies. It must be granted access to the target database; creating the connection alone grants no content access. Enable only required capabilities, typically read and insert content. The current documentation also supports personal access tokens, which act with their creator's permissions; they may be broader than a dedicated database-scoped connection. [Internal connections](https://developers.notion.com/guides/get-started/internal-connections), [personal access tokens](https://developers.notion.com/guides/get-started/personal-access-tokens)

Implementation requirements:

- Never ship a shared token, commit a user's token, include it in exported drafts, pass it to content scripts, or send it to an AI provider.
- Use only extension-owned settings/API code, validate message senders, and hard-code the Notion API origin.
- `storage.local` is convenient for a personal build but is **not encrypted secret storage or Keychain**. Disclose that limitation and allow clearing credentials. A hardened native distribution should move secrets into Keychain via native messaging.
- AI rewriting is optional and explicitly configured. Send only the preview's selected source content to the chosen provider. The output must not invent missing post content; preserve the original text for traceability.

Notion recommends keeping tokens out of source/configuration files, using a secret store, limiting capabilities, and revoking exposed credentials. [Secure API tokens](https://developers.notion.com/guides/get-started/handling-api-keys)

## Facebook capture boundaries and validation

These are engineering conclusions from the permitted-page model, not claims of a stable Facebook DOM API:

- A permalink and a focused/selected post are stronger evidence than feed-wide `document.body.innerText`.
- DOM selectors can change; extraction needs fallback logic and fixtures for author, message, surrounding navigation, comments, and link-only shares.
- Hidden, unloaded, collapsed, or login-gated text is unavailable unless the user makes it visible. Don't imply a complete archival copy.
- Keep URL separate from title. An empty/link-only capture should use an honest placeholder and warning, not a fabricated summary.
- Image URLs may expire or require authentication. A captured URL does not prove a permanent copied image; a screenshot requires a separate supported capture/upload path.

Release checks should cover desktop and mobile Facebook permalinks, multiple-post feeds, selected text, long Chinese posts, login-gated pages, Notion permission/schema failures, retry uncertainty, and popup suspension. Unit/fixture tests establish logic; actual Safari/iPhone tests establish host compatibility. Both must be reported separately.

## Reference projects reviewed

| Source | Verified relevant behavior | Project takeaway |
| --- | --- | --- |
| [webclipper/web-clipper](https://github.com/webclipper/web-clipper) | Multi-destination clipper; README lists Chrome/Edge installs and Chromium/Firefox development paths | Destination adapters and structured clipping are useful patterns; no Safari installation promise in the reviewed README |
| [chiimagnus/SyncNos](https://github.com/chiimagnus/SyncNos) | Local capture before optional sync; current README explicitly lists Safari macOS/iOS source builds with Xcode; AGPL-3.0 | Strong reference for draft-first behavior; user's example already includes Safari support |
| [goxofy/web_clipper](https://github.com/goxofy/web_clipper) | Backend receives SingleFile HTML, saves to GitHub Pages, generates summaries/tags, and syncs Notion | Separating source URL, snapshot, summary, and tags is useful; public snapshot hosting should not be the default for Facebook content |

The recommendation is an original, narrowly scoped implementation, informed by these workflows rather than copying their code.
