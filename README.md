# Pixel Agents Desktop

Tauri 2.x 桌面應用，監控本機的 Claude Code agent 工作階段並連線至遠端
Pixel Agents 伺服器。以系統匣常駐程式運行（macOS 不顯示 Dock 圖示），
關閉視窗時隱藏而非退出。

## 架構

三層設計，透過不同協定溝通：

```
React UI ←→ Tauri invoke/events ←→ Rust 後端 ←→ NDJSON stdin/stdout ←→ Node.js Sidecar ←→ Socket.io ←→ 遠端伺服器
```

- **Rust 後端** (`src-tauri/src/`)：應用主體、系統匣、Sidecar 程序管理、
  NDJSON IPC
- **Node.js Sidecar** (`sidecar/src/`)：掃描本地 Claude session、解析
  JSONL、轉發到遠端、PTY 終端轉送
- **React 前端** (`src/`)：登入、代理列表、終端機、日誌、設定等 UI

## 開發環境需求

- Node.js ≥ 20
- Rust 穩定版（[rustup](https://rustup.rs/)）
- 作業系統特定依賴（見 [Tauri 前置](https://tauri.app/start/prerequisites/)）

## 開發指令

```bash
# 完整應用（主要開發指令）
npm run dev          # tauri dev — 啟動 Vite dev server + Rust 後端

# 建置正式版
npm run build        # tauri build

# 僅建置 Sidecar
node scripts/build-sidecar.mjs           # 單次建置
node scripts/build-sidecar.mjs --watch   # 監聽模式

# 手動測試 Sidecar IPC
echo '{"id":1,"method":"getStatus"}' | node sidecar/dist/sidecar.mjs

# 前端單元測試
npm test             # 執行一次
npm run test:watch   # 監聽模式

# 型別檢查
npx tsc --noEmit
```

> **注意**：執行 `tauri dev` / `tauri build` 前必須先建置 sidecar；
> Rust 後端啟動時會解析 `sidecar/dist/sidecar.mjs`。

## 設定檔位置

- `~/.pixel-agents/node-config.json`：伺服器 URL 與認證 token
  （Unix 上檔案權限 0600）
- `~/.pixel-agents/desktop-settings.json`：應用偏好設定

## 測試

單元測試以 [vitest](https://vitest.dev/) 執行，全部放在 `tests/`：

- `parser.test.ts` — JSONL 解析
- `validators.test.ts` — IPC payload 型別守衛
- `scanner-projectname.test.ts` — 專案名稱解析回歸測試

## 發布 / 簽章

見 [`docs/SIGNING.md`](docs/SIGNING.md) 了解 macOS/Windows 代碼簽章與公證設定。

## 安全注意事項

- 認證 token 優先儲存於 OS keychain（macOS Keychain / Windows Credential
  Manager / Linux Secret Service）。若 keychain 不可用，回退至
  `~/.pixel-agents/node-config.json`（Unix 檔案權限 0600）。
- 前端 Tauri capabilities 收斂至僅必要權限；`shell:allow-spawn/execute/
  kill` 等僅在 Rust 後端內部使用，不暴露給 WebView。
- Content Security Policy 已啟用，限制 `default-src 'self'`。

## 授權

尚未授權發佈。
