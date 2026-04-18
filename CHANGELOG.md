# Changelog

本檔遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
並採用 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### 新增
- i18n 完整支援（繁體中文 / English），可於設定頁切換
- 自動更新整合（`tauri-plugin-updater`）— 需要部署時設定簽章金鑰與端點
- 頂部系統通知橫幅（`NoticeBanner`）
- 設定頁「診斷」區塊：uptime、IPC 請求/錯誤、sidecar spawn/restart/crash 計數
- 鍵盤操作與 ARIA 無障礙強化：LoginView form semantics、MainView tab roles
- `@testing-library/react` 元件整合測試；共 86 個前端測試 + 16 個 Rust 測試
- GitHub Actions CI（frontend / sidecar / rust × 3 平台 / 安全稽核）
- Dependabot 配置
- OS keychain 儲存認證 token（macOS Keychain / Windows Credential Manager /
  Linux Secret Service）

### 改進
- `SidecarManager` 全內部同步化，解除 shutdown 死鎖與 UI 啟動期阻塞
- Sidecar stdout 背壓處理 + `terminalData` 16ms coalescing
- Scanner 改為 `fs/promises` 並行 I/O；JSONL 追蹤首次回放最近 256KB
- logStore 改為 circular buffer（消除 O(n) slice）
- TerminalPanel 改為 `React.lazy` 動態載入，首屏 bundle −49%
- tracing 結構化日誌取代 log/env_logger
- HTTP login 3 次指數退避重試；4xx 不重試
- Tauri capabilities 收斂至最小集合；加入 CSP

### 修復
- IPC 協定死鎖、pending request 洩漏、sidecar 崩潰不自動重連
- 前後端 invoke 命令名不一致（`connect` → `connect_server` 等）
- `event.kind` 與 Rust 實際發出的 `event.event` 欄位不一致導致事件 handler 失效
- loginServer 返回型別與前端期待不符造成密碼登入完全失敗
- TerminalPanel 首次 mount 時 xterm 未綁 DOM 容器的 race
- tray 連線狀態 payload 欄位不一致導致永遠顯示「未連線」
- AgentCard + ToolBadge 各自 `setInterval` 的 timer 洩漏
- Scanner `lastActivity` map 無上限累積
- `extractProjectName` 截斷含 dash 的專案名

## [0.1.0] — 2026-03-16

### 新增
- 初始版本：Tauri 2.x 桌面應用骨架
- React + Zustand 前端
- Node.js sidecar（JSONL 掃描、Socket.IO 連線、PTY 轉送）
- 系統匣常駐（macOS Accessory 模式）

[Unreleased]: https://github.com/nicepkg/pixel-agents-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nicepkg/pixel-agents-desktop/releases/tag/v0.1.0
