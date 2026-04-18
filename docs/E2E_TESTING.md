# 端對端測試

專案目前已涵蓋下列層級的自動化測試：

| 層級 | 數量 | 工具 |
|------|------|------|
| Rust 單元 | 16 | `cargo test --lib` |
| TypeScript 純函式 / store | 44 | vitest (node env) |
| React 元件 | 25 | vitest + happy-dom + @testing-library/react |
| Sidecar 子程序 E2E | 4 | vitest 實際 spawn `sidecar.mjs` |

**尚未**自動化的情境是整個 Tauri 應用（Rust 後端 + WebView）的 GUI 端對端。
本文說明如何以 `tauri-driver` 補足此層。

## 使用 tauri-driver

### 前置

1. 安裝 tauri-driver：
   ```bash
   cargo install tauri-driver --locked
   ```

2. Linux 需要 `webkit2gtk-driver`；macOS 需要 Safari WebDriver（需啟用
   「允許遠端自動化」於 Safari → 開發選單）；Windows 需要 Edge WebDriver。

3. 在 `src-tauri/tauri.conf.json` 加入 `bundle.resources` 讓測試 harness
   可以啟動 debug binary：
   ```json
   {
     "bundle": { "active": true }
   }
   ```

### 撰寫測試

以 WebDriver 客戶端（例如 [webdriverio](https://webdriver.io/) 或
[selenium](https://www.selenium.dev/documentation/webdriver/)）連線至
`http://localhost:4444`：

```typescript
import { remote } from "webdriverio";

const browser = await remote({
  hostname: "127.0.0.1",
  port: 4444,
  capabilities: {
    "tauri:options": {
      application: "./src-tauri/target/debug/pixel-agents-desktop",
    },
  },
});

// 實例：開啟應用、檢查登入畫面
const title = await browser.$(`h1`).getText();
expect(title).toBe("Pixel Agents");

await browser.deleteSession();
```

### 為何尚未整合到 CI

- macOS GitHub Actions runner 不預裝 Safari WebDriver
- Linux runner 需要虛擬 X server（xvfb），增加 CI 時間
- 實際價值相對有限：大部分互動問題可以透過元件測試 + sidecar E2E 捕捉
- 整合成本 > 邊際效益；暫列為後續 roadmap

若團隊決定加入，建議：
1. 另建 `.github/workflows/e2e.yml`，**手動觸發**或**nightly**
2. 只跑少量關鍵流程（登入 / 切 tab / 連線斷線）
3. 失敗時輸出 screenshot artifact 便於除錯

## 手動測試檢查清單

發佈前建議以人工執行以下情境：

### 登入
- [ ] API 金鑰模式連線成功
- [ ] 密碼模式連線成功
- [ ] 伺服器不存在時顯示錯誤訊息
- [ ] 錯誤金鑰時顯示 4xx 錯誤（不重試）

### 代理
- [ ] 啟動 Claude Code 後代理出現在列表中（30 秒內）
- [ ] 工具執行時顯示 badge
- [ ] 代理關閉後列表移除

### 終端機
- [ ] 首次打開終端機 tab 能輸入指令
- [ ] 切換不同 agent 正確 attach
- [ ] 視窗改變大小 terminal cols/rows 更新

### 設定
- [ ] 語言切換（繁中 / English / 日本語）即時生效
- [ ] 主題切換（深色 / 淺色 / 跟隨系統）即時生效
- [ ] 掃描間隔滑桿拖動流暢不卡頓
- [ ] 排除專案新增/刪除正確
- [ ] 登出後回到登入畫面

### 快捷鍵
- [ ] Cmd/Ctrl + 1~4 切換分頁
- [ ] Cmd/Ctrl + D 中斷連線
- [ ] 輸入欄位中按 1~4 不觸發 tab 切換

### 視窗 / 系統匣
- [ ] 關閉視窗隱藏至系統匣（不退出）
- [ ] 系統匣選單「顯示/隱藏」正常運作
- [ ] 重新開啟視窗位置/大小恢復
- [ ] 系統匣狀態正確反映連線與代理數

### 錯誤恢復
- [ ] 強制 kill sidecar 程序後應用自動重啟並重連
- [ ] 強制 throw 在元件中觸發 ErrorBoundary 顯示
- [ ] 崩潰後 `~/.pixel-agents/crashes/` 有記錄
