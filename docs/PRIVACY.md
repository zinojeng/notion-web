# 隱私與資料流

本擴充套件不營運任何伺服器、遙測或分析服務。原始碼公開，使用者自行設定個人的 Notion connection。

## 讀取與傳送

- 只有啟動擴充套件時，以 `activeTab` 讀取目前授權網頁；不讀取瀏覽紀錄、其他分頁、密碼、cookie 或原生 App 畫面。
- 擷取標题、所選文字／文章本文、作者、來源 URL、圖片 URL 與擷取時間，供使用者預覽編輯。
- 按「儲存到 Notion」將預覽資料傳到 Notion API。儲存前會按來源 URL 查詢重複頁面。
- AI 預設關閉。使用者自行提供 Claude API key 並按 AI 按鈕，才將來源標題、作者與最多 24,000 字本文傳到 Anthropic。Notion token 不會傳給 AI。
- 圖片預設關閉；啟用圖片時，預覽會向圖片主機載入圖片，Notion 可能抓取所提供的外部 URL。圖片可能過期或需要登入，本程式不承諾永久備份。

## 本機儲存

設定與 token 存於擴充套件 `storage.local`，不是加密保管庫。其他能控制你的瀏覽器設定檔或装置的軟體可能存取它；請依自己的裝置管理規則使用。設定頁不回填 token，空白且未改動時保留舊值；按清除後儲存可刪除。

設定不使用 `storage.sync`，Mac 與 iPhone 各自設定。移除擴充套件後可在 Notion / Anthropic 撤銷 token；已建立的 Notion 頁面需在 Notion 管理。

未送出的預覽只留在當次 popup 記憶體，關閉後不保留；沒有背景存檔或上傳這些草稿。

## 權限

`activeTab` 和 `scripting` 用來讀取使用者目前選擇的網頁；`storage` 保存本機設定。網路 API 僅限 `https://api.notion.com/*` 與 `https://api.anthropic.com/*`。Safari 可能另行要求允許 API 網站權限。所有有憑證的請求都在 extension 自身執行，不傳給網頁。

## 公開發布

公開 repository 與安裝包不包含使用者的 token、Notion 資料庫 ID、實際收藏内容或私人 session transcript。問題回報請使用去識別化範例，避免貼上完整 API 回應或私人貼文。
