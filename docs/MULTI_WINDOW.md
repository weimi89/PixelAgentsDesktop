# 多視窗支援設計說明

本專案目前只使用單一 `main` 視窗；本文記錄未來擴充多視窗（例如每個
agent 單獨詳細視窗、log 視窗獨立浮動等）需要的改動點，以便後續工作
銜接。

## 當前架構的限制

1. **`tauri.conf.json`** 只定義 `main` 一個 window 設定
2. **`tauri-plugin-window-state`** 以 label 為 key 記憶；新視窗會自動
   取得獨立的狀態，但第一次建立時沒有預設位置
3. **`App.tsx`** 整個 React tree 以為自己是「那個主畫面」；開新視窗
   載入相同 index.html 時會共享 Zustand store，但 LoginView vs MainView
   切換可能造成新視窗也看到登入表單
4. **事件分派**：`sidecar-event` 在每個視窗都會收到（Tauri 廣播），
   目前靠 `handleSidecarEvent` 是 idempotent 不會重複處理

## 建議實作步驟

### 1. 新視窗類型

在 `tauri.conf.json` 加 `windows` 配置：

```json
{
  "app": {
    "windows": [
      { "label": "main", ... },
      {
        "label": "agent-detail",
        "title": "Agent Detail",
        "width": 500, "height": 600,
        "url": "/agent.html",
        "visible": false
      }
    ]
  }
}
```

或動態建立：

```rust
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn open_agent_window(app: &AppHandle, session_id: &str) {
    let label = format!("agent-{}", session_id);
    if app.get_webview_window(&label).is_some() {
        // 已存在，聚焦即可
        app.get_webview_window(&label).unwrap().set_focus().ok();
        return;
    }
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("agent.html?session={}", session_id).into()),
    )
    .title("Agent Detail")
    .inner_size(500.0, 600.0)
    .build()
    .ok();
}
```

### 2. 前端路由

目前 `src/main.tsx` 只 render 一個 App。未來應：

```tsx
// src/main.tsx
const route = new URLSearchParams(window.location.search).get("route") ?? "main";

createRoot(rootEl).render(
  route === "agent"
    ? <AgentDetailWindow sessionId={new URLSearchParams(window.location.search).get("session")!} />
    : <App />
);
```

或使用正規路由器（`react-router-dom`）。

### 3. 視窗間通訊

Tauri event `app.emit` 預設廣播到所有 webview；要定向到特定視窗：

```rust
app.emit_to("agent-1234", "focus-tool", toolId)?;
```

前端 listen 取相同 label 即可。

### 4. Store 共享策略

目前各 webview 載入同一 bundle，**Zustand store 不會自動跨視窗同步**
（每個 webview 是獨立 JS context）。若要共享：

- 選項 A：每個視窗獨立 state，靠 Tauri event 同步關鍵狀態
- 選項 B：把 state 移到 Rust，前端透過 invoke 查詢 + listen 事件更新
- 選項 C：使用 BroadcastChannel（同源視窗可用）

推薦 A — 視窗職責單一，同步範圍明確。

## 何時該做

目前 [[AgentDetailsDrawer]] 在主視窗內以 side panel 呈現，使用者體驗
已足夠。以下情境觸發時再考慮：

- 使用者同時看多個 agent 詳細資訊
- 終端機想浮動脫離主視窗
- 使用者要求像 iTerm2 那樣獨立 log viewer 視窗

## 相關檔案

- `src-tauri/tauri.conf.json` — 視窗配置
- `src-tauri/src/lib.rs` — builder setup
- `src/main.tsx` — 路由
- `src/App.tsx` — 單視窗 entry
