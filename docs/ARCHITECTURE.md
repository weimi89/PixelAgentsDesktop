# 架構總覽

Pixel Agents Desktop 採三層架構：React 前端、Rust Tauri 後端、Node.js Sidecar。
三者透過不同協定串接，各自負責互不重疊的職責。

```
┌─────────────────────────────────────────────────────────────────┐
│  React (Vite / Zustand / xterm.js)                              │
│  - LoginView / MainView (tabs) / SettingsView / TerminalPanel   │
│  - stores: connection / agent / log / settings / system         │
│  - i18n: zh-TW / en；ErrorBoundary；NoticeBanner                │
└────────────────────────┬────────────────────────────────────────┘
                         │ Tauri invoke / event
┌────────────────────────┴────────────────────────────────────────┐
│  Rust Tauri 後端 (src-tauri/src/)                                │
│  - lib.rs       事件迴圈 / tray / autostart / window-state       │
│  - commands.rs  Tauri 命令（login / connect / settings / ...）   │
│  - sidecar.rs   SidecarManager（stdin/stdout NDJSON IPC）        │
│  - ipc.rs       IpcRequest/Response/Event 型別                   │
│  - secret_store.rs  OS keychain 抽象                             │
│  - diagnostics.rs   原子計數器與快照                             │
│  - tray.rs / state.rs                                            │
└────────────────────────┬────────────────────────────────────────┘
                         │ NDJSON stdin/stdout
┌────────────────────────┴────────────────────────────────────────┐
│  Node.js Sidecar (sidecar/src/)                                  │
│  - main.ts           IPC 迴圈、console 重寫至 stderr、背壓佇列   │
│  - bridge.ts         Scanner + AgentTracker + Connection 協調    │
│  - connection.ts     Socket.IO 連線至遠端伺服器                  │
│  - scanner.ts        掃描 ~/.claude/projects 找活躍 session      │
│  - agentTracker.ts   監視 JSONL 檔並增量解析                     │
│  - parser.ts         Claude Code JSONL → AgentNodeEvent          │
│  - terminalRelay.ts  PTY 轉送（spawn shell / tmux）              │
└────────────────────────┬────────────────────────────────────────┘
                         │ Socket.IO (wss)
                  ┌──────┴──────┐
                  │ 遠端伺服器  │
                  └─────────────┘
```

## 為什麼是三層？

| 層 | 選擇理由 |
|----|---------|
| **React/Vite** | 前端需要豐富 UI（xterm、列表、對話框）；React 生態熟悉 |
| **Tauri Rust** | WebView 環境無法直接讀檔、管子程序、keychain；Rust 提供原生能力、效能、記憶體安全 |
| **Node sidecar** | Claude Code JSONL / Socket.IO / chokidar 等生態在 Node 成熟；用 Rust 重寫 ROI 太低 |

## 資料流向

### 1. 使用者登入

```
LoginView
  └ invoke("login_server") → Rust commands.rs::login_server
        └ reqwest POST → 遠端伺服器
              ← { token }
        └ 儲存至 OS keychain (secret_store)
  ← returns { ok, token, username }
  └ invoke("connect_server") → Rust commands.rs::connect_server
        └ sidecar.request("connect", { serverUrl, token })
              └ Sidecar 建立 Socket.IO 連線、開始 JSONL scan
```

### 2. Agent 事件上行

```
Claude Code 寫入 ~/.claude/projects/<hash>/session.jsonl
  └ Scanner 每秒偵測到 mtime 更新
        └ AgentTracker.startTracking
              └ parser.parseJsonlLine
                    └ Bridge.handleAgentEvent
                          ├ Connection.sendEvent (Socket.IO → 伺服器)
                          └ IPC sendEvent (→ Rust stdout reader)
                                └ Rust emit Tauri event "sidecar-event"
                                      └ React App.tsx handleSidecarEvent
                                            └ stores.addAgent / addTool
                                                  └ UI render
```

### 3. 終端機操作

```
使用者在 TerminalPanel 輸入
  └ xterm.onData
        └ invoke("terminal_input", { sessionId, data })
              └ Rust sidecar.request("terminalInput", ...)
                    └ Sidecar terminalRelay.input
                          └ child.process.stdin.write
                                ... shell 處理 ...
                          └ child.stdout 'data' 事件
                                └ callbacks.onData (Bridge)
                                      └ IPC sendEvent("terminalData")
                                            ... 16ms coalesce ...
                                            └ Rust stdout reader
                                                  └ Tauri event
                                                        └ TerminalPanel.write → xterm
```

## IPC 協定（Rust ↔ Sidecar）

NDJSON over stdin/stdout，每行一個 JSON 物件。

### Request（Rust → Sidecar）
```json
{ "id": 42, "method": "connect", "params": { "serverUrl": "...", "token": "..." } }
```

### Response（Sidecar → Rust，有 `id`）
```json
{ "id": 42, "result": { "connected": true } }
// 或
{ "id": 42, "error": "Missing required params" }
```

### Event（Sidecar → Rust，無 `id`）
```json
{ "event": "agentStarted", "data": { "sessionId": "...", "projectName": "..." } }
{ "event": "terminalData", "data": { "sessionId": "...", "data": "..." } }
{ "event": "ready", "data": { "version": "0.1.0" } }
```

## 關鍵設計決策

### SidecarManager 全內部可變
早期版本以 `Mutex<SidecarManager>` 包外層，導致 `shutdown()` 內呼叫
`request()` 時，reader task 的 restart path 反向取鎖會死鎖。重構後：
- `SidecarManager` 所有欄位都是 `Arc<Mutex/Atomic>`
- 方法全用 `&self`
- `AppState.sidecar: Arc<SidecarManager>`（無外層 Mutex）
- `install_child` 改為 `BoxFuture` 打破遞迴 async Send 推導

### stdout 背壓與 coalescing
`terminalData` 事件量大（高頻 stream）；sidecar `main.ts` 實作：
- 背壓佇列 — `process.stdout.write` 回傳 false 時等 `drain` 事件
- 16ms coalescing — 同 sessionId 的 data 合併一次送出，降 10× IPC 量

### Token 優先 keychain
`save_config_to_file` 優先寫入 OS keychain（macOS Keychain / Windows Credential
Manager / Linux Secret Service）；失敗時回退至 0600 權限的本地檔案。

### Scanner 非同步並行
舊版 `fs.readdirSync` + `fs.statSync` 每秒執行上百次同步 I/O 阻塞 event loop；
改為 `fs.promises.readdir` 並行，`stat` 以 16 並行度分批執行。

## 測試策略

- **純函式** — Rust ipc 編解碼、sidecar parser、i18n 字典、scanner 專案名
- **Store 行為** — logStore circular buffer、agentStore 增刪工具
- **Type guards** — validators.ts 覆蓋所有 sidecar event 形狀
- **元件互動** — LoginView / StatusBar / NoticeBanner / AgentCard
  （happy-dom + testing-library）
- **Rust 邏輯** — tray 事件計數、shutdown 流程、diagnostics snapshot
- **子程序 E2E** — sidecar-ipc.test.ts 啟動真 node 程序驗證 NDJSON

## 參考

- Tauri 2: <https://tauri.app/>
- Zustand: <https://github.com/pmndrs/zustand>
- xterm.js: <https://xtermjs.org/>
- tracing: <https://docs.rs/tracing>
