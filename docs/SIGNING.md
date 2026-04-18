# 代碼簽章與自動更新設定指引

## 自動更新（tauri-plugin-updater）

Tauri 2 的 updater plugin 需要：

1. **生成更新簽章金鑰對**：
   ```bash
   npx @tauri-apps/cli signer generate -w ~/.tauri/pixel-agents.key
   ```
   產生的 `.key` 為私鑰（不入版控），`.key.pub` 為公鑰。

2. **在 `src-tauri/tauri.conf.json` 填入公鑰與更新端點**：
   ```json
   {
     "bundle": {
       "createUpdaterArtifacts": true
     },
     "plugins": {
       "updater": {
         "pubkey": "<貼上 .key.pub 的完整內容>",
         "endpoints": [
           "https://releases.example.com/pixel-agents-desktop/{{target}}/{{arch}}/{{current_version}}"
         ]
       }
     }
   }
   ```

3. **Build 時以環境變數提供私鑰**：
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/pixel-agents.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""   # 若有密碼
   npm run build
   ```

4. **發佈更新 manifest**（放在 `endpoints` 對應 URL）：
   ```json
   {
     "version": "0.2.0",
     "notes": "修復若干 bug",
     "pub_date": "2026-04-19T12:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<由 Tauri 產生>",
         "url": "https://releases.example.com/Pixel_Agents_Desktop_0.2.0_aarch64.app.tar.gz"
       }
     }
   }
   ```

端點 URL 未設定時，前端「檢查更新」按鈕會顯示「此建置尚未設定更新伺服器」；
應用仍可正常運作，只是不會取得更新。

---

# 代碼簽章設定指引

未簽章的桌面應用在 macOS 與 Windows 上都會被作業系統攔阻或顯示安全警告。
本文說明簽章所需的設定與環境變數。

## macOS — Apple Developer 簽章 + 公證

### 前置需求

1. Apple Developer Program 會員資格（USD 99 / 年）
2. 在 Apple Developer Portal 建立 **Developer ID Application** 憑證，下載 `.cer`
   並匯入鑰匙圈
3. 建立 App-specific password：appleid.apple.com → 安全性 → App 專用密碼

### 在 `src-tauri/tauri.conf.json` 加入 macOS 區段

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAMID)",
      "providerShortName": "TEAMID",
      "entitlements": null
    }
  }
}
```

或以環境變數提供（推薦，不入版控）：

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your@appleid.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

### 公證（必要）

macOS 10.15+ 未公證應用無法執行。Tauri 2 的 bundler 會自動公證若設定了
`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`。

## Windows — Authenticode 簽章

### 前置需求

1. 採購代碼簽章憑證（例：SSL.com、DigiCert、Sectigo），越來越多 CA
   要求 EV 憑證並需硬體 token
2. 將 `.pfx` 憑證檔匯出

### `tauri.conf.json`

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "YOUR_CERT_THUMBPRINT",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

或環境變數：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/myapp.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "pfx-password"
```

## Linux — AppImage / deb

一般不需系統層級簽章，但 AppImage 可以用 GPG 簽名以供使用者驗證：

```bash
export SIGN=1
export SIGN_KEY="YOUR_GPG_KEY_ID"
```

## CI 整合

在 GitHub Actions 中以 **Repository Secrets** 儲存所有憑證與密碼，
在 workflow 內 export 為環境變數。**絕對不要**將憑證或 App-specific
password 提交到 repository。

詳見 <https://tauri.app/distribute/> 的最新指引。
