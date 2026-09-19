# 安裝 Notion Web：Mac Safari 與 iPhone Safari

本專案是 Safari Web Extension。程式建置會產生 `dist/safari`；這個資料夾適合 Mac 開發測試，iPhone 則需要包含擴充功能的 iOS App。以下是安裝流程，不代表已經完成 Apple 簽署、上架或你的裝置測試。資料查核日期：2026-09-20。

## 1. 建置擴充功能

先安裝 Node.js 22 或更新版本，在 Terminal 執行：

```sh
cd /path/to/notion-web
npm ci
npm run build
```

產物為專案內的 `dist/safari`。請選這個資料夾，不要選專案根目錄、`src` 或 `dist/chromium`。

## 2. Mac：直接安裝供測試

**此方式需要 macOS 上的 Safari 18.4 或更新版本。** Apple 的 WebKit 發行說明確認，從 Safari 18.4 才新增從磁碟暫時安裝擴充功能；Safari 18.4 可用於 macOS Ventura、Sonoma、Sequoia 15.4。這不是「任何 macOS Safari 都能直接載入資料夾」。先在「Safari → 關於 Safari」確認版本。[WebKit 官方說明](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)

1. 開啟「Safari → 設定 → 進階」，勾選「顯示網頁開發者功能」（Show features for web developers）。
2. 在設定的「開發者」（Developer）頁籤，按 **Add Temporary Extension…**，依畫面指示允許未簽署的開發擴充功能；macOS 若要求密碼，請由本人輸入。
3. 選取專案內的 `dist/safari`。
4. 到「延伸功能」確認 **Notion Web · 清晰收藏** 已啟用；若使用 Safari 個人檔案，也確認目前個人檔案已啟用它。
5. 開啟一個一般網頁，按工具列上的擴充功能圖示，依提示允許存取目前網站。

暫時安裝會在 **24 小時後或結束 Safari 時移除**。這是 Apple 的測試機制。更新程式後重新執行 `npm run build`，再到 Safari 設定重新載入擴充功能。若找不到上述控制項，確認版本，或使用下一節的 Xcode 方式。[Apple 安裝文件](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)

## 3. Mac／iPhone：產生 Xcode 專案

需要完整 Xcode，只有 Command Line Tools 不夠。先開啟 Xcode 完成首次設定，並在「Xcode → Settings → Locations」選好 Command Line Tools。執行：

```sh
cd /path/to/notion-web
npm run build
bash scripts/package-safari.sh
```

腳本會優先尋找新版 `safari-web-extension-packager`，再尋找舊版 `safari-web-extension-converter`。產生位置預設是 `artifacts/safari-xcode`。它只產生原生容器專案，不會簽署、安裝、上傳或覆寫既有資料夾。[Apple 打包文件](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)

如要自訂輸出位置及 Bundle ID：

```sh
bash scripts/package-safari.sh artifacts/safari-xcode-personal com.yourname.notionweb
```

請把 `com.yourname.notionweb` 換成自己的唯一識別碼。打開產生的 `.xcodeproj`，檢查 Apple 工具輸出的 manifest 警告。專案參照 `dist/safari`，所以不要移走該資料夾；修改 JavaScript 後先重新建置，再於 Xcode Build／Run。

### Mac App

在 Xcode 選 macOS App scheme 與 My Mac，執行 Run。容器 App 啟動後，到 Safari 設定啟用延伸功能。開發時若沒有簽章，可依 Apple 文件在 Safari 開發者設定允許未簽署的延伸功能；此選項在 Safari 結束後會重設。正式配送需要適當的簽署／公證或 App Store 流程。[Apple 執行文件](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)

### iPhone 實機

1. 在 Xcode 加入 Apple 開發者帳號。依 Apple Safari Extension 文件，實機測試需要 Apple Developer Program；尚未加入時可先測 iOS Simulator。
2. 對 iOS 容器 App 和 Safari Extension target，在「Signing & Capabilities」選同一個 Team，設定唯一且前綴一致的 Bundle ID，處理 Xcode 顯示的 provisioning 錯誤。
3. 連接 iPhone、信任這部 Mac，依 Xcode／iPhone 提示啟用 Developer Mode。選 iOS App scheme 和這台 iPhone，再執行 Run。需要能支援該 iOS 版本的 Xcode。
4. 安裝後到 iPhone「設定 → App → Safari → 延伸功能」，開啟 Notion Web 的允許開關。較舊 iOS 的 Safari 設定位於設定首頁；也可從 Safari 頁面選單的延伸功能入口啟用。
5. 在 Safari 開啟網頁，從網址列旁的頁面選單選 Notion Web，依提示授予目前網站權限，並完成下一節的 Notion 設定。

Apple 的平台起點是 iOS 15，但本專案使用 Manifest V3 與較新的 JavaScript 建置目標，**沒有宣告所有 iOS 15 裝置皆相容**；請使用仍受支援的近期 iOS，並以實機檢查結果為準。Safari 及 Xcode 的版本需求，也不等於本專案已通過那些版本的測試。[Apple 開發安裝文件](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)、[iPhone 啟用方式](https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios)

**不能把 `dist/safari` 資料夾或 ZIP 傳到 iPhone 就直接安裝本專案。** 要透過上述 Xcode 部署，或使用 TestFlight／App Store 中已完成打包的 App。

## 4. 沒有本機 Xcode：App Store Connect 打包

Apple 現在提供 Safari Web Extension Packager，可從 App Store Connect 上傳擴充功能資源，建立 macOS／iOS App。需要已加入 Apple Developer Program，且帳號具有建立 App 的權限。這是另一條發行流程，本專案沒有自動替你建立或提交 App。[Apple 雲端打包文件](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)

1. 建置完成後，把 **`dist/safari` 內的全部檔案** 壓成 ZIP；解壓後的根目錄應直接有 `manifest.json`。
2. 在 App Store Connect 的 Apps 建立 App 記錄，選 macOS、iOS 或兩者，填自己的 Bundle ID 等資訊。
3. 開啟該 App 的 Xcode Cloud 頁籤，在 Safari Web Extension Packager 上傳資源 ZIP。
4. 檢查 Builds 的處理結果及相容性警告，再透過 TestFlight 安裝測試版；正式上架另需完成資料與審查。

若你的 App Store Connect 帳號尚未顯示此功能，改用 Xcode 流程。雲端打包不會另外替本專案實作 Facebook 原生 App 分享擴充功能。

## 5. 連接自己的 Notion

本版本使用你自行設定的個人用途 Token，不提供多使用者 OAuth 登入服務；不需要擷取 Safari 的 Notion 登入 Cookie。

1. 在 [Notion Developer portal](https://app.notion.com/developers/connections) 建立 Internal connection，選擇工作區，開啟讀取與新增內容所需的權限；長文後續追加區塊也需要更新內容權限。
2. 在目標資料庫的「••• → Connections」加入此連線，或從開發者介面的 Content access 授權。若是連結資料庫視圖，需授權原始資料庫。
3. 打開擴充功能的設定頁，填入 Token 並連線，選擇要寫入的資料來源（data source）。一個資料庫可能包含多個資料來源，請確認選對。
4. 檢查欄位對應：標題 → title 欄；摘要 → `摘要*`／`摘要`；URL → `URL`／`~URL`；其餘依實際欄位型別設定。`New Project` 可能只是頁面名稱，標題欄以讀到的 schema 為準。
5. 儲存設定後，先擷取一篇一般文章，確認 Notion 的標題、摘要、來源 URL 與頁面原文各在正確位置。

Token 只應填進擴充功能設定。不要放進程式碼、GitHub、截圖或聊天訊息。此個人版採用擴充功能本機儲存，**不是 Keychain／加密密鑰保管庫**；不要假設會安全同步至 iPhone，請在各裝置分別設定。[Notion 內部連線](https://developers.notion.com/guides/get-started/internal-connections)、[Token 保護](https://developers.notion.com/guides/get-started/handling-api-keys)

可選的 Claude AI 改寫需要另外設定 Anthropic API key，並按下改寫按鈕才會送出擷取文字。未啟用 AI 時仍可用本機整理與手動修改。不要把 API 使用費與 Claude 訂閱混為一談；以自己的 API 帳戶設定為準。

## 6. Facebook 正確使用方式

在 Mac 或 iPhone，先於 **Safari** 登入 Facebook，開啟單篇貼文連結，展開「查看更多」後再擷取；若頁面有多篇貼文，先選取想要的文字。檢查標題與摘要後儲存，來源連結會獨立放入 URL 欄，原文放入頁面內容。

Facebook App 的「分享」不等於 Safari 擴充功能。本專案目前沒有獨立的 iOS Share Extension，也不能讀取 Facebook 原生 App 的畫面內容。從 App 複製貼文網址後，開到 Safari 再使用本擴充功能。登入限制、尚未載入或未展開的文字不會自動補齊；只有連結時可貼上原文後再整理。

## 常見問題

| 情況 | 處理 |
| --- | --- |
| Mac 沒有 Add Temporary Extension | 確認 Safari 至少 18.4、已開啟開發者功能；或使用 Xcode 容器 App |
| 找不到 packager／converter | 安裝完整 Xcode 並完成首次設定；在 Xcode Locations 選擇工具鏈 |
| 顯示無法存取頁面 | 在 Safari 授權目前網站；內建設定頁、新分頁等不是可擷取的一般網頁 |
| Notion 連線失敗／資料庫列表空白 | 檢查 Token、讀取權限，以及資料庫是否加入連線；授權原始資料庫 |
| Safari API 網路權限遭拒 | 檢查擴充功能網站權限；允許 `api.notion.com`，使用 AI 時再允許 `api.anthropic.com` |
| 改寫後沒有新內容 | 確認原文確實擷取到；AI 無法從受限 URL 推知未取得的貼文 |
| 送出後逾時 | 先檢查 Notion 是否已新增，避免不確定結果下重複建立 |
| iPhone 找不到擴充功能 | 確認安裝的是含 iOS Safari Extension 的 App，並啟用目前 Safari 個人檔案的延伸功能 |

更多平台限制與 API 依據見 [platform-research.md](platform-research.md)。
