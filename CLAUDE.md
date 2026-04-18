# CLAUDE.md

此檔案為 Claude Code (claude.ai/code) 在本專案中工作時的指引文件。

## 專案概述

Pixel Agents Desktop 是一個 Tauri 2.x 桌面應用，監控本機的 Claude Code agent 工作階段並連線至遠端 Pixel Agents 伺服器。以**系統匣常駐程式**運行（macOS 不顯示 Dock 圖示），關閉視窗時隱藏而非退出。

## 建置與開發指令

```bash
# 完整應用（Tauri + Vite + Rust）— 主要開發指令
npm run dev          # 執行 `tauri dev`，啟動 Vite 開發伺服器 :1420 + Rust 後端

# 建置正式版
npm run build        # 執行 `tauri build`

# 僅建置 Sidecar（Node.js 程序）
node scripts/build-sidecar.mjs           # 單次建置 → sidecar/dist/sidecar.mjs
node scripts/build-sidecar.mjs --watch   # 監聽模式

# 手動測試 Sidecar IPC
echo '{"id":1,"method":"getStatus"}' | node sidecar/dist/sidecar.mjs

# 僅前端（不含 Rust 後端）
npm run vite:dev     # 獨立 Vite 開發伺服器
npm run vite:build   # Vite 正式建置 → dist/
```

**注意：** 執行 `tauri dev` 或 `tauri build` 前必須先建置 sidecar。Rust 後端啟動時會解析 `sidecar/dist/sidecar.mjs`，若檔案不存在則應用無法正常運作。

## 架構

應用分為三層，透過不同協定溝通：

### 1. Rust 後端（`src-tauri/src/`）
- **lib.rs** — 應用初始化：插件（shell、autostart）、系統匣建立、sidecar 啟動、從儲存的設定（`~/.pixel-agents/node-config.json`）自動連線。macOS 上設定 `ActivationPolicy::Accessory`（僅系統匣）。
- **sidecar.rs** — `SidecarManager`：啟動/管理 Node.js sidecar 子程序。透過 stdin/stdout 處理 NDJSON IPC，使用遞增 ID 進行請求/回應配對，具備崩潰偵測與指數退避自動重啟（5 分鐘內最多 3 次）。
- **ipc.rs** — NDJSON 協定型別（`IpcRequest`、`IpcResponse`、`IpcEvent`）。含 `id` 欄位的訊息為回應，不含則為事件。
- **commands.rs** — Tauri invoke 處理器（暴露給前端的 `#[tauri::command]` 函式）。
- **state.rs** — `AppState`，持有 `Mutex<SidecarManager>`。
- **tray.rs** — 系統匣建立與動態狀態更新（連線狀態、代理數量）。

### 2. Node.js Sidecar（`sidecar/src/`）
獨立的 Node.js 程序，使用 esbuild 打包。透過 stdin/stdout 的 NDJSON 與 Rust 通訊。所有人類可讀的日誌輸出至 stderr。

- **main.ts** — IPC 迴圈：讀取 stdin 行，分派至 Bridge 方法，透過 stdout 發送回應/事件。
- **bridge.ts** — 協調器：管理 socket.io 連線至遠端伺服器，協調掃描器與終端轉發。
- **connection.ts** — 連接 Pixel Agents 伺服器的 Socket.io 客戶端。
- **scanner.ts** — 監控本機檔案系統中活躍的 Claude Code agent 工作階段。
- **agentTracker.ts** — 追蹤代理生命週期事件。
- **parser.ts** — 解析 Claude Code 工作階段資料。
- **terminalRelay.ts** — PTY 轉發，提供遠端終端存取代理工作階段。
- **ipcProtocol.ts** — TypeScript IPC 型別定義（對映 `ipc.rs`）。

### 3. React 前端（`src/`）
使用行內樣式的 React 應用（無 CSS 框架），等寬/像素風格美學。狀態以 Zustand store 管理。

- **App.tsx** — 根元件 + 中央事件分派器。將 `sidecar-event` Tauri 事件路由至對應的 store。
- **tauri-api.ts** — `@tauri-apps/api` invoke/listen 呼叫的型別化封裝。這是 React 與 Rust 之間的唯一橋樑。
- **stores/** — Zustand stores：`connectionStore`（伺服器狀態）、`agentStore`（代理工作階段 + 工具）、`logStore`（事件日誌）、`settingsStore`（應用偏好設定）。
- **components/** — `LoginView`（連線前）、`MainView`（連線後）、`AgentList`/`AgentCard`、`LogViewer`、`TerminalPanel`（xterm.js）、`StatusBar`、`SettingsView`。

### 共用（`shared/`）
- **protocol.ts** — Agent Node ↔ 伺服器協定的 TypeScript 型別（獨立副本，與 web 專案的共用型別結構相同）。

### 資料流向

```
React UI ←→ Tauri invoke/events ←→ Rust 後端 ←→ NDJSON stdin/stdout ←→ Node.js Sidecar ←→ Socket.io ←→ 遠端伺服器
```

事件向上游流動：Sidecar 發出 IpcEvent → Rust 發出 Tauri 事件（`sidecar-event`）→ React `App.tsx` 分派至 Zustand stores。指令向下游流動：Tauri invoke → Rust → sidecar stdin。

## 重要慣例

- **介面語言為繁體中文** — 所有使用者可見的字串（系統匣選單、前端元件、日誌訊息）必須使用繁體中文。
- **設定檔位置：** `~/.pixel-agents/node-config.json` 儲存伺服器 URL 與認證 token，用於自動連線。
- **關閉視窗 = 隱藏至系統匣**，並非退出。僅能透過系統匣選單「結束」退出。
- **Sidecar 協定：** stdout 的每一行必須是合法 JSON。除錯日誌使用 stderr。以 `id` 欄位的有無區分回應與事件。
