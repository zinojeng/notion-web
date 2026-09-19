# Notion Web · 清晰收藏

A Safari-first, open-source Notion web clipper for macOS and iPhone Safari. Turn a webpage or a focused Facebook post into a readable title, summary, original text, and source URL. Traditional Chinese interface; original implementation under the MIT license. Unofficial and not affiliated with Notion, Meta, Apple, or Anthropic.

**目前狀態：可自行建置的第一版。** 提供 Safari WebExtension 與 Chromium 測試用版本；iPhone 需包裝成 App 並簽署安裝。尚未提供 App Store / TestFlight 發行版。裝置驗證與已知限制見 [驗證紀錄](docs/VALIDATION.md)。

## 解決什麼問題

- 把「標題、摘要、原文、URL」分開，不把整篇貼文或網址塞進標題。
- 優先使用選取內容、Facebook 單篇貼文或文章本文；動態牆有多篇候選時提示選取，避免誤收整頁。
- 從 Notion 真實欄位型別提供映射，支援 `標題`、`摘要`、`AI 摘要`、`AI 關鍵字`、`URL`、`圖檔` 等中文欄位。
- 設定一次後，在預覽按「儲存到 Notion」即可收藏；會依 URL 檢查是否已存在。
- 預設使用本機文字整理；可另外啟用 Claude API 改寫標題、摘要與關鍵字，只有按下 AI 按鈕才傳送內容。
- 保留來源本文與時間，方便回頭查證。圖片是選用的外部連結，不是永久截圖備份。

## 建置與安裝

需要 Node.js 22+ 與 npm。

```bash
git clone https://github.com/zinojeng/notion-web.git
cd notion-web
npm ci
npm run check
```

輸出：

- `dist/safari/`：Safari 擴充套件資源。
- `dist/chromium/`：供 Chromium 載入未封裝擴充套件、檢查與開發。

完整 [Mac 與 iPhone 安裝步驟](docs/INSTALL.md)。在支援的 Safari，可透過開發者設定加入暫時性擴充套件；正式分發需要 Apple 的封裝與簽署流程。

```bash
bash scripts/package-safari.sh
```

這個選用腳本在已安装完整 Xcode 時產生原生專案。若尚未安裝，會列出下一步；不會自動下載 Xcode、建立憑證或發布 App。

## 連接你的 Notion

1. 在 [Notion integrations](https://www.notion.so/profile/integrations) 建立自己的 internal connection，允許讀取、插入內容。長文續寫需要更新內容權限。
2. 在目標資料庫的連線設定把該資料庫授權給這個 connection。只建立 token 不會自動得到資料庫存取權。
3. 打開擴充套件設定頁，在密碼欄位貼上 token，按連線並列出資料來源。
4. 選擇資料來源，確認標題／摘要／URL／AI 欄位對應後儲存。
5. 在 Safari 開啟要收藏的網頁，按擴充套件，檢查預覽並儲存。

此專案不提供共用 token，也不需要把 token 傳給作者。你的 Claude Code / Claude 訂閱不等於 Claude API 額度；AI 功能可完全關閉。

| 內容 | 建議 Notion 欄位 | 型別 |
| --- | --- | --- |
| 清楚主題 | 標題 / Name | title |
| 收藏摘要 | 摘要 | rich_text |
| 來源連結 | URL / ~URL | url |
| AI 摘要 | AI 摘要 / AI摘要 | rich_text |
| 關鍵字 | AI 關鍵字 / 標籤 | rich_text / multi_select |
| 圖片連結 | 圖檔 | files |

`Status`、`Owner`、`Dates` 與系統建立時間由資料庫原有行為處理。頁面本文自行建立 `About this project`、摘要、來源與擷取原文；不會套用或改寫你既有的 database template。

## Facebook 使用方式

**Mac 或 iPhone Safari：** 打開貼文的獨立連結，展開「顯示更多」，再開擴充套件。也可以先反白目標文字。若提示內容不完整，檢查預覽，或貼入可見的原文後再儲存。

**iPhone Facebook App：** 分享提供的往往只有網址。先把連結在 Safari 開啟，登入並顯示貼文後，再使用本擴充套件。此版本沒有原生 Facebook App 分享選單 target，也不能讀取其他 App 的私人畫面或未載入文字。

內容擷取最多 80,000 字並明示截斷；AI 最多處理前 24,000 字，完整已擷取原文仍會保存。Facebook DOM 可能改變，fixture 測試不能保證每個帳號與頁面版型都相容。

## 資料與隱私

按下收藏才把預覽資料傳到 `api.notion.com`。AI 預設關閉，按 AI 改寫才把來源文字傳到 `api.anthropic.com`。沒有分析追蹤、第三方後端、登入 cookie 擷取或全站常駐 content script。

Token 存在這台裝置的 extension `storage.local`，不是加密 Keychain，也不會跨裝置同步。請使用只分享必要資料庫的 connection。設定頁不回填 token，支援清除。敏感來源內容應自行斟酌是否傳至 Notion 或 AI。詳見 [隱私說明](docs/PRIVACY.md)。

此版尚未持久保存未送出的草稿；儲存失敗時會保留當次視窗的編輯，但關閉 popup 後會重新擷取。請在關閉前完成儲存或自行複製內容。

## Claude 多 session 協作與 Codex 審查

本專案使用具名 Claude Code 背景角色協作：capture、notion、interface，以及 coordinator；每個角色有自己的研究 memo、workflow 與可寫入範圍，透過 `ListAgents` / `SendMessage` 互相提問，再由 Codex 整合與獨立審查。

```bash
./scripts/claude-sessions.sh                 # 看這個目錄的背景 sessions
./scripts/claude-sessions.sh attach capture # 用角色名稱進入，不必輸入 UUID
./scripts/claude-sessions.sh attach notion
./scripts/claude-sessions.sh attach interface
```

`claude agents --cwd "$PWD"` 是背景工作清單，不是全部歷史對話。歷史對話可用 `claude --resume "名稱"` 續開，再輸入 `/bg`。請使用半形雙引號，避免 `"$PWD”` 導致 shell 等待結束引號。

[完整操作說明](docs/claude-sessions.md) · [協作 workflow](collaboration/README.md) · [平台研究](docs/platform-research.md) · [Codex review](docs/codex-review.md)

## 開發

```bash
npm test       # DOM fixtures、Notion API mocks、權限／AI／整合測試
npm run build  # Safari / Chromium bundles
npm run preview # 本機示範介面（範例資料，沒有真正寫入）
```

主流程：`capture.js → compose.js → popup → controller.js → notion.js`。`ai.js` 只在使用者要求改寫時執行。不要把私人的 API key、資料庫 ID、貼文正文或 Claude session transcript 放進 Git。協作 prompts 是可重用模板，不包含憑證。

## 參考

產品行為研究参考 [Notion Web Clipper](https://www.notion.com/zh-tw/web-clipper)、[webclipper/web-clipper](https://github.com/webclipper/web-clipper)、[SyncNos](https://github.com/chiimagnus/SyncNos) 與 [goxofy/web_clipper](https://github.com/goxofy/web_clipper)。沒有複製上述專案程式碼。各平台限制與官方 API 來源記錄於研究文件。
