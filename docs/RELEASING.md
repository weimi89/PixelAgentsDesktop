# 發佈流程

Pixel Agents Desktop 的正式版以 Git tag 觸發；GitHub Actions 會跨平台
建置、簽章（若有設定 Secrets）並自動建立 GitHub Release。

## 發佈步驟

1. **更新版本號**
   - `package.json` → `version`
   - `src-tauri/Cargo.toml` → `[package] version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/src/sidecar.rs` → `EXPECTED_SIDECAR_VERSION`（僅當
     sidecar 協定有破壞性變更時）
   - `sidecar/src/main.ts` → `VERSION`

2. **更新 CHANGELOG.md**
   - 將 `[Unreleased]` 區塊改為 `[x.y.z] — YYYY-MM-DD`
   - 新開一個空的 `[Unreleased]` 區塊
   - 更新底部對照連結

3. **提交並打 tag**
   ```bash
   git add .
   git commit -m "release: vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

4. **等待 CI**
   - `.github/workflows/release.yml` 會觸發
   - 跨平台 build：macOS (arm64/x64)、Windows (x64)、Linux (x64)
   - 建置完成後 Release 會從 draft 發佈為正式版

## 必要 Secrets

以下 Secrets 設定於 GitHub repo 的 Settings → Secrets and variables → Actions：

### 自動更新簽章
- `TAURI_SIGNING_PRIVATE_KEY` — `tauri signer generate` 產出的私鑰內容
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — 私鑰密碼（可空）

### macOS 代碼簽章 + 公證
- `APPLE_CERTIFICATE` — base64 編碼的 `.p12` 檔
- `APPLE_CERTIFICATE_PASSWORD` — .p12 密碼
- `APPLE_SIGNING_IDENTITY` — 例如 `Developer ID Application: Your Name (TEAMID)`
- `APPLE_ID` — Apple ID email
- `APPLE_PASSWORD` — App-specific password
- `APPLE_TEAM_ID` — Apple Developer 團隊 ID

### Windows Authenticode
- `WINDOWS_CERTIFICATE` — base64 編碼的 `.pfx` 檔
- `WINDOWS_CERTIFICATE_PASSWORD` — .pfx 密碼

**若未設定**：Release 仍會成功，但產物為未簽章版本，使用者首次開啟會收到
系統警告（macOS Gatekeeper / Windows SmartScreen）。

## 發佈更新 Manifest（僅自動更新啟用時）

若已啟用自動更新且 `tauri.conf.json` 的 `plugins.updater.endpoints` 指向
你自架的 JSON 端點，需要更新對應 manifest 讓舊版客戶端能偵測新版：

```json
{
  "version": "0.2.0",
  "notes": "修復若干 bug",
  "pub_date": "2026-04-19T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<tauri build 產出於 .sig 檔的內容>",
      "url": "https://releases.example.com/Pixel_Agents_Desktop_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { "signature": "...", "url": "..." },
    "windows-x86_64": { "signature": "...", "url": "..." },
    "linux-x86_64": { "signature": "...", "url": "..." }
  }
}
```

## 手動建置本地版本

若僅需本地驗證不經 CI：

```bash
npm ci
node scripts/build-sidecar.mjs
npm run build
# 產物位於 src-tauri/target/release/bundle/
```

## 版本回滾

若發現重大問題，依序：
1. 在 GitHub Release 頁面將該版標為 pre-release 或 draft
2. 若已發佈自動更新 manifest，更新 manifest 指向前一穩定版
3. 在 CHANGELOG.md 新增 `### 已撤回` 子區塊說明原因
4. 發佈 patch 版修復
