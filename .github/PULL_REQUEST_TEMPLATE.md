# Pull Request

## 變更內容

<!-- 請簡述本次變更做了什麼、為什麼要這樣做 -->

## 變更類型

- [ ] 🐛 Bug 修復
- [ ] ✨ 新功能
- [ ] 🔨 重構（不影響外部行為）
- [ ] 📝 文件
- [ ] ⚡ 效能優化
- [ ] 🔒 安全
- [ ] 🧪 測試
- [ ] 🔧 工程 / CI

## 驗證清單

在送出 PR 前請確認：

- [ ] `npx tsc --noEmit` 通過
- [ ] `npm test` 通過
- [ ] `cd src-tauri && cargo check` 通過
- [ ] `cd src-tauri && cargo test --lib` 通過
- [ ] `node scripts/build-sidecar.mjs` 成功
- [ ] 有 UI 變更時：兩種語言字典都已更新（`src/i18n/locales/zh-TW.ts` / `en.ts`）
- [ ] 新增互動元件：考慮 ARIA 屬性與鍵盤操作
- [ ] 新增 store / 純函式：有對應單元測試
- [ ] Commit 訊息不含 `Co-Authored-By`

## 截圖 / 錄影

<!-- 如有 UI 變更請附上 -->

## 其他資訊

<!-- 相關 issue、參考資料、需要特別注意的事項 -->
