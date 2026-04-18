# 貢獻指南

感謝您有興趣貢獻 Pixel Agents Desktop！本文說明開發環境設定、
工作流程與送交 PR 前的檢查清單。

## 開發環境

- Node.js **≥ 20**
- Rust 穩定版（透過 [rustup](https://rustup.rs/) 安裝）
- macOS 12+、Ubuntu 22.04+ 或 Windows 10+
- Linux 額外需要：`libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev
  librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev`

## 初次設定

```bash
npm install
node scripts/build-sidecar.mjs   # Sidecar 需先建置才能跑 tauri dev
npm run dev                       # 啟動 Vite + Rust 後端
```

## 常用指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 啟動完整應用（Tauri + Vite） |
| `npm run vite:build` | 僅前端 Vite 建置 |
| `npm run build` | 完整打包 |
| `npm test` | Vitest 單元/元件測試 |
| `npm run test:watch` | 測試監聽模式 |
| `npx tsc --noEmit` | TypeScript 型別檢查 |
| `cd src-tauri && cargo check` | Rust 型別檢查 |
| `cd src-tauri && cargo test --lib` | Rust 單元測試 |
| `node scripts/build-sidecar.mjs` | 單次建置 sidecar |
| `node scripts/build-sidecar.mjs --watch` | 監聽模式 |

## 程式碼風格

- **TypeScript**：`strict` + `noUncheckedIndexedAccess`；避免 `any`
- **Rust**：`cargo fmt` 預設設定、`clippy` warnings as errors
- **介面語言**：新字串請加入 `src/i18n/locales/zh-TW.ts` 與 `en.ts` 兩處
- **NDJSON 協定**：sidecar stdout 的每行必須是合法 JSON，debug 訊息只能寫 stderr

## 送出 PR 前的檢查

請確認以下指令都通過：

```bash
npx tsc --noEmit       # TypeScript 型別檢查
npm test               # 前端測試（~86 tests）
cd src-tauri && cargo check   # Rust 型別檢查
cd src-tauri && cargo test --lib    # Rust 測試（~16 tests）
node scripts/build-sidecar.mjs   # sidecar 可建置
```

若 PR 包含 UI 變更：
- 確認繁中與英文兩份字典都已更新
- 使用鍵盤 tab 檢查焦點順序與 ARIA
- 跑 `npm run vite:build` 確認 bundle 不會意外膨脹

## Commit 訊息

- 使用繁體中文撰寫 commit 訊息
- 第一行精簡描述變更（< 60 字），之後空行 + 條列說明
- **禁止** 包含 `Co-Authored-By` 行（專案規範）
- 示範：
  ```
  修正 LoginView 密碼模式無法送出的 bug

  - 修正 invoke 命令名為 connect_server（原 connect 不存在）
  - 修正 loginServer 返回型別為 object
  ```

## 檔案整理規則

- **不刪除檔案** — 僅允許搬移至 `backups/{YYYYMMDDHHMMSS}/...`
- **不在根目錄放測試檔** — 測試一律放 `tests/`
- **Tauri 自動生成的 `src-tauri/gen/schemas/`** 已被 `.gitignore` 排除

## 回報 Bug / Feature request

請透過 GitHub Issues 使用對應模板：
- 🐛 Bug report
- ✨ Feature request

## 授權

貢獻即代表您同意以專案授權（見 [`LICENSE`](LICENSE) — 待補）散佈您的貢獻。
