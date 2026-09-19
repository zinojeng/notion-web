# Claude 多角色研究與實作

本專案使用四個獨立、具名且保留歷史的 Claude Code sessions，透過 `ListAgents` / `SendMessage` 真正交換研究與挑戰。Codex 整合實作、執行最後的獨立 review，並獨占 Git / GitHub 操作。

| Session | 可寫範圍與成果 | Workflow |
|---|---|---|
| `notion-web-capture` | `src/capture.js`、`src/compose.js`、capture tests、capture research memo | Facebook / 文章擷取研究 → title / summary 分離 → fixtures → 挑戰 URL 與原文保存 |
| `notion-web-notion` | `src/notion.js`、Notion tests、Notion research memo | API / schema 研究 → typed mapping → mocked API tests → 挑戰長文與欄位相容性 |
| `notion-web-interface` | popup、options、styles、interface research memo | Safari / iPhone 流程 → 可編輯預覽與設定 → 安全 UI → 挑戰模糊貼文的手動恢復 |
| `notion-web-coordinator` | 只寫 `docs/research/coordinator.md` | 將 Codex 已驗證的 schema / permissions 要求轉送三位專家 → 收取實際 ACK → 彙整 final status |

確切檔案 ownership 見根目錄 `CLAUDE.md` 及各角色 prompt；跨模組介面見 [CONTRACT.md](CONTRACT.md)。每份 `docs/research/<role>.md` 應包含來源、workflow、實作限制、實際訊息 ID、peer challenge / response 與收到的 ACK。沒有收到回覆就標記未完成，不代替其他角色說話。

## 啟動、觀看與續接

需要已登入的 Claude Code CLI、Python 3、Git；macOS / Linux 可執行。從專案目錄：

```bash
./scripts/start-claude-team.sh --dry-run
./scripts/start-claude-team.sh
./scripts/claude-sessions.sh
```

只補一個缺少的角色可執行 `./scripts/start-claude-team.sh capture`。Launcher 讀取 [prompts](prompts)，將 `{{REPO_ROOT}}` 與 `{{BASE_COMMIT}}` 換成目前 checkout 與 HEAD。任何同名 live、completed、stopped 或 failed 列都會保留；重跑不會偷偷建立第二套，也不會刪除歷史。Stopped 角色請用續接指令：

```bash
./scripts/claude-sessions.sh list
./scripts/claude-sessions.sh attach capture
./scripts/claude-sessions.sh resume notion-web-notion
./scripts/claude-sessions.sh logs interface
./scripts/claude-sessions.sh attach coordinator
```

Dashboard 選列按 `Enter` 看完整對話，空白輸入列按 `←` 返回，`Ctrl+O` 看完整訊息。Needs input 時 attach 處理權限或問題；最底部的新任務輸入列會建立另一個 session。找不到舊背景列時，使用 `claude --resume "完整名稱"`，進入後 `/bg`。詳細空白清單診斷見 [Claude sessions 指南](../docs/claude-sessions.md)。

`claude stop` 可能先回傳、稍後才完成退出；立刻 `--bg --resume` 可能建立保留歷史的 copy，新列 ID 會改變。先確認 JSON 清單的舊列已無 PID 且不再 working / blocked，再續接。Helper 會選唯一活躍列，或全部結束後 `startedAt` 最新的一列，保留舊紀錄；多個同名活躍列仍會報歧義，避免選錯。

## 一輪工作的完成條件

1. 三位專家讀同一份 contract，確認 base commit 與自己的寫入範圍。
2. 各自建立 research memo / workflow，同時完成雙向 preflight ACK。
3. 依 ownership 實作並驗證；向相關 peer 提出具體 challenge，原作者回覆與修正。
4. Coordinator 轉送 Codex 的已驗證要求、保存實際 receipts、剩餘限制與 handoff。不要 idle loop 或無止盡互傳訊息。
5. Codex review 合併結果，修正 findings、跑整合檢查，再處理 commit / PR / merge；Claude 角色不得自行提交或發布。

Launcher 只為這些 sessions 設定 `crossSessionInbound: accept`、`acceptEdits` 與 `worktree.bgIsolation: none`，不改全域設定。工具 allowance 包含限定的測試命令和 `npm run build`，其餘操作仍適用原權限。共用 checkout 是因為已有明確互斥檔案 ownership；跨同一檔案的工作必須交由 Codex 排程。命令使用 `--` 分隔 prompt，並把 stdin 設為 `/dev/null`，避免多值參數或呼叫端腳本污染對話。歷史 short ID、tokens 與原始私人 transcripts 不寫入 repository。
