# Claude Code 多角色對話與回看

查核日期：2026-09-20。本機版本：Claude Code 2.1.278。本文依本機 `claude --help`、`claude agents --help`、官方文件，以及既有 Cross-Session Playbook 建立；沒有修改全域 Claude 設定。

## 為什麼 `claude agents --cwd "$PWD"` 是空白？

初次檢查本專案時，`claude agents --json --all --cwd "$PWD"` 回傳 `[]`。這只證明當時沒有此路徑的活躍 session 或保留的背景列，不代表舊 transcript 遺失。

`claude agents` 畫面顯示背景對話；一般終端機裡的前景對話、已結束的 `claude -p` 呼叫、子 agent，不會自動變成畫面中的背景列。`--cwd` 又會依啟動路徑篩選，因此在另一個專案啟動的對話不會出現。JSON 清單與畫面不同：JSON 也包含目前活躍的前景 session；`--all` 才加上已完成的背景列。[官方 Agent view](https://code.claude.com/docs/en/agent-view)

請使用完整、左右一致的 ASCII 引號：

```bash
cd /path/to/notion-web
claude agents --cwd "$PWD"
```

原訊息裡的 `$PWD”` 是彎引號。若 Terminal 顯示 `dquote>`，按 `Ctrl+C` 取消未完成的命令，再貼上上面版本。

## 不記 UUID，直接回到角色

本專案提供名稱查詢小工具，執行位置不必固定：

```bash
/path/to/notion-web/scripts/claude-sessions.sh
/path/to/notion-web/scripts/claude-sessions.sh list
/path/to/notion-web/scripts/claude-sessions.sh attach notion-web-capture
/path/to/notion-web/scripts/claude-sessions.sh logs notion-web-capture
```

`attach` 與 `logs` 會從公開 CLI JSON 以名稱找 short ID，使用者不必抄 UUID；`capture`、`notion`、`interface`、`coordinator` 也可用作縮寫。有同名舊列時優先選仍在執行的唯一列；全部已結束且沒有 PID 時，選 `startedAt` 最新的 done / stopped / failed 列，保留所有較舊歷史。若同時有兩個仍在執行的同名 session，或最新時間相同無法區分，helper 會停止並請使用者在 dashboard 重新命名。`resume NAME` 有背景列時會 attach，沒有時交給 Claude 的歷史對話搜尋；歷史搜尋建議使用完整名稱。

原生 CLI 也能直接用名稱續接；若不記名稱，省略參數就會顯示選擇器：

```bash
cd /path/to/notion-web
claude --resume "notion-web-capture"
claude --resume
```

建立新對話時使用 `--name`；舊對話可在裡面輸入 `/rename notion-web-capture`。`--agent` 是選擇自訂 agent 定義，與對話命名不同。已經在執行中的對話應直接 attach，避免兩個程序同時續寫同一份 transcript。[官方 CLI reference](https://code.claude.com/docs/en/cli-reference)

在舊對話裡輸入 `/bg`，即可將它加入背景清單。Dashboard 裡選列按 `Enter` 進入完整對話；空白輸入列按 `←` 返回清單，`Space` 查看摘要及回覆，`Ctrl+O` 查看完整內容。不要在 dashboard 最底下的「新任務」輸入列回覆舊角色，那會另外建立 session。

若要從 dashboard 找被移除的歷史對話，可從專案目錄執行**沒有 `--cwd` 的** `claude agents`，再輸入單獨的 `/resume`。目前 scoped view 不支援這個歷史 picker；使用上面的 `claude --resume` 即可。[官方 Agent view](https://code.claude.com/docs/en/agent-view)

## 多角色工作流程

本專案採用獨立 Claude sessions；Codex 負責整合、驗證及最終 review。角色分工與具體 prompt 以專案的 cross-session brief 為準。以下是可重用的 lane 設計：

| 角色 | 研究問題 | Workflow | 給其他角色的交付 |
|---|---|---|---|
| notion-web-interface | Safari / iPhone popup、設定流程、WebExtension 平台差異 | 研究 → UI / configuration → 安裝流程 → cross-review | 可實作介面與平台限制 |
| notion-web-notion | database / data source、欄位型別、token、分頁 blocks | 查 Notion API → 欄位映射 → payload / error cases | API 契約與可測試案例 |
| notion-web-capture | 單篇貼文辨識、Title 與摘要分離、URL 還原 | DOM fixtures → extractor → peer challenge → regression cases | 擷取規則與失敗降級 |
| Codex integrator / reviewer | 跨模組相容性、權限、秘密、錯誤恢復 | 審 memos → 整合 → 測試 → 修 findings → GitHub PR / merge | review 紀錄與發布結果 |

每個 Claude 角色先完成自己的 research memo 和 workflow，再對另一份 memo 提出一項具體 challenge。原作者回覆並修訂；只有收到具名 ACK 才能把議題標成 CLOSED。每次訊息包含 `run_id`、`message_id`、`in_reply_to`、sender、recipient、finding、artifact path、status。

所有角色啟動時都需讀同一份 brief，確認 commit / 工作目錄、可寫路徑、peer 名稱與交付檔案。各角色只修改自己負責的路徑；reviewer 寫 review 檔，Codex 統一整合及 Git 操作。

## 啟動與互相對話

由 orchestrator 開始新一輪時，使用固定且唯一的名稱和自足 prompt。以下只示範一個角色，**已存在時先 attach，不要重複 launch**：

```bash
cd /path/to/notion-web
claude --bg --name "notion-web-interface" \
  --permission-mode acceptEdits \
  --settings '{"crossSessionInbound":"accept"}' \
  -- "Read the project brief. Research Safari and iPhone support within your assigned paths. Use ListAgents to locate the named peers, exchange a preflight ACK and a concrete challenge with SendMessage, then update your research memo and workflow. Do not commit or push; Codex owns integration." </dev/null
```

`--settings` 只作用於這次啟動的 sessions，避免為整台電腦更改接收設定。`acceptEdits` 仍保留其他操作的權限檢查；出現 Needs input 時 attach 處理。跨 session 由 Claude 的 `ListAgents` 與 `SendMessage` 完成；CLI 沒有一般 `claude send` 子命令。可以直接在對話裡說：「請把這個 extraction challenge 傳給 notion-web-notion，取得 ACK 後更新 memo。」[官方 cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)

程式啟動時保留 `--` 分隔符，避免 `--allowedTools` 這類接受多個值的參數吞掉 prompt。從 Python / shell 腳本啟動背景 session 時，stdin 使用 `/dev/null`（Python 則用 `stdin=subprocess.DEVNULL`），避免把呼叫端腳本內容當成使用者輸入。初次啟動若出錯，先停止該次 session，再以清楚的名稱重新啟動；helper 會優先選仍在執行的列。

原生背景 session 編輯前預設進入 git worktree；可寫同一 checkout 的分工必須先明確約定互斥路徑，再由 orchestrator 針對本次啟動使用 `"worktree":{"bgIsolation":"none"}`。這是協作模式的選擇，不是修復空白清單所必需的設定。[官方 Agent view](https://code.claude.com/docs/en/agent-view)

訊息只傳文字，不自動附上檔案。大型 memo 傳路徑、hash 與 locator，接收端自行讀取。第一次溝通先 A → B test，再 B → A ACK；只有 transport success 不算內容已讀。對方 idle 可以被訊息喚起，但不能用 peer 訊息替使用者批准權限。不要用 `--bare` 啟動需要互通的角色。[官方 cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)

## 空白或沒有回覆時的檢查順序

1. 確認 `pwd` 是本專案目錄，用 `claude agents` 暫時移除路徑 filter。
2. 執行 `./scripts/claude-sessions.sh list`，區分背景列、前景對話與無紀錄。
3. 歷史對話使用 `claude --resume`；進入後 `/rename`、`/bg`。
4. 執行 `claude --version`、`claude daemon status` 確認 binary 與背景服務狀態；不要為找對話刪除 `~/.claude` 或 jobs。
5. 對話內 `/list-agents`、`/status` 檢查互通能力；查看是否有 held message / Needs input。送訊息後要求精確 `in_reply_to` 的 ACK。
6. `claude logs <short-id>` 只有近期終端輸出；完整歷史請 attach 並按 `Ctrl+O`。

### Stop 與立即 background resume 的競態

本次實測 `claude stop` 回傳時，舊程序可能仍在退出。立即執行 `claude --bg --resume <session-id>` 時，Claude 可能判定原對話仍在執行，建立保留對話內容的 copy；新的 background row ID 因而改變。這不是歷史被清空。應先用 `claude agents --json --all --cwd "$PWD"` 確認原列已沒有 `pid` 且不再是 working / blocked，再續接；平常直接使用 helper 的 `resume NAME`／`attach NAME` 可省去 stop → relaunch 步驟。已有 copy 時保留原列，透過名稱選目前活躍或最新結束的列，不要刪除 transcripts 來解決重名。

本機實測只讀檢查與 helper 驗證不等於真實角色已完成討論。實際研究、交叉挑戰、ACK 和 Codex review 應保存在該輪 brief / ledger / research artifacts，不能用本文件代替執行紀錄。
