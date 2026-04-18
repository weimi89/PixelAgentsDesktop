//! # Tauri 命令（invoke handlers）
//!
//! 本模組是**前端與 Rust 後端的所有接觸面**。每個 `#[tauri::command]` 函式
//! 都暴露給前端經由 `@tauri-apps/api` 的 `invoke()` 呼叫。
//!
//! ## 命令對照表
//!
//! | 命令                       | 前端呼叫（`src/tauri-api.ts`） | 說明                             |
//! |----------------------------|--------------------------------|----------------------------------|
//! | `get_status`               | `getStatus()`                  | 查詢 sidecar 狀態（已連線/代理數/延遲） |
//! | `connect_server`           | `connect(url, token)`          | 建立遠端伺服器連線               |
//! | `disconnect_server`        | `disconnect()`                 | 中斷連線                         |
//! | `login_server`             | `loginServer(url, user, pwd)`  | 密碼登入取得 token               |
//! | `login_with_key`           | `loginWithKey(url, apiKey)`    | API 金鑰登入取得 token           |
//! | `load_config`              | `loadConfig()`                 | 讀取 `~/.pixel-agents/node-config.json` + keychain token |
//! | `save_config`              | `saveConfig(url, token)`       | 寫入 config（token 優先入 keychain） |
//! | `logout`                   | `logout()`                     | 斷線 + 刪 config + 清 keychain   |
//! | `terminal_attach` 等       | `terminalAttach()` 等          | 終端機 PTY 轉送                  |
//! | `load_settings` / `save_`  | `loadSettings()` / `saveSettings()` | UI 偏好設定                  |
//! | `update_scan_interval`     | `updateScanInterval()`         | 動態改 sidecar 掃描間隔          |
//! | `update_excluded_projects` | `updateExcludedProjects()`     | 動態同步排除清單                 |
//! | `get_diagnostics`          | `getDiagnostics()`             | 內部計數快照                     |
//! | `report_crash`             | `reportCrash()`                | 前端錯誤持久化到 crashes/        |
//! | `list_crashes` / `clear_`  | `listCrashes()` / `clearCrashes()` | 管理 crash 紀錄              |
//!
//! ## 錯誤回傳
//!
//! Tauri 會把 `Err(String)` 的訊息以 JS Error 型式丟回前端的 `invoke()` caller。
//! 所有錯誤訊息都應是人類可讀字串（而非 opaque 狀態碼）。

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::State;

use crate::diagnostics;
use crate::secret_store;
use crate::state::AppState;

/// 返回內部診斷指標快照（IPC 計數、sidecar 事件、上線時間等）。
#[tauri::command]
pub async fn get_diagnostics() -> Result<Value, String> {
    Ok(diagnostics::snapshot())
}

/// 將 crash / 錯誤事件寫入 ~/.pixel-agents/crashes/<timestamp>.json，
/// 最多保留 20 份，舊的自動搬移至同目錄的 .archive 子資料夾，
/// 而不直接刪除（符合專案檔案整理規則）。
#[tauri::command]
pub async fn report_crash(kind: String, message: String, details: Option<Value>) -> Result<Value, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let crash_dir = home.join(".pixel-agents").join("crashes");
    fs::create_dir_all(&crash_dir)
        .map_err(|e| format!("Failed to create crash dir: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let file_name = format!("{}-{}.json", now, sanitize(&kind));
    let path = crash_dir.join(&file_name);

    let record = json!({
        "timestamp": now,
        "kind": kind,
        "message": message,
        "details": details,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "diagnostics": diagnostics::snapshot(),
    });
    let content = serde_json::to_string_pretty(&record)
        .map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write crash log: {e}"))?;

    // 保留最多 20 筆；更舊的搬到 archive/
    rotate_crash_logs(&crash_dir).ok();

    tracing::warn!(kind, path = %path.display(), "crash reported");
    Ok(json!({ "ok": true, "path": path.to_string_lossy() }))
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// 列出 ~/.pixel-agents/crashes/ 中的 crash log（不含 archive/）。
#[tauri::command]
pub async fn list_crashes() -> Result<Value, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let crash_dir = home.join(".pixel-agents").join("crashes");
    if !crash_dir.exists() {
        return Ok(json!({ "count": 0, "path": crash_dir.to_string_lossy(), "entries": [] }));
    }

    let mut entries: Vec<Value> = Vec::new();
    if let Ok(iter) = fs::read_dir(&crash_dir) {
        for e in iter.flatten() {
            let ft = match e.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if !ft.is_file() {
                continue;
            }
            if e.path().extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let meta = e.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            entries.push(json!({
                "name": e.file_name().to_string_lossy(),
                "size": size,
                "modifiedAt": modified,
            }));
        }
    }
    entries.sort_by(|a, b| {
        let am = a["modifiedAt"].as_u64().unwrap_or(0);
        let bm = b["modifiedAt"].as_u64().unwrap_or(0);
        bm.cmp(&am)
    });

    Ok(json!({
        "count": entries.len(),
        "path": crash_dir.to_string_lossy(),
        "entries": entries,
    }))
}

/// 將 crash log 搬移至 archive/ 而非刪除（符合專案檔案整理規則）。
#[tauri::command]
pub async fn clear_crashes() -> Result<Value, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let crash_dir = home.join(".pixel-agents").join("crashes");
    if !crash_dir.exists() {
        return Ok(json!({ "moved": 0 }));
    }
    let archive = crash_dir.join("archive");
    fs::create_dir_all(&archive)
        .map_err(|e| format!("Failed to create archive dir: {e}"))?;

    let mut moved = 0u32;
    if let Ok(iter) = fs::read_dir(&crash_dir) {
        for e in iter.flatten() {
            if e.file_type().ok().map(|t| t.is_file()).unwrap_or(false)
                && e.path().extension().and_then(|x| x.to_str()) == Some("json")
            {
                let target = archive.join(e.file_name());
                if fs::rename(e.path(), target).is_ok() {
                    moved += 1;
                }
            }
        }
    }
    Ok(json!({ "moved": moved }))
}

fn rotate_crash_logs(dir: &std::path::Path) -> std::io::Result<()> {
    const MAX_ACTIVE: usize = 20;
    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().ok().map(|t| t.is_file()).unwrap_or(false)
                && e.path().extension().and_then(|x| x.to_str()) == Some("json")
        })
        .collect();
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());

    if entries.len() <= MAX_ACTIVE {
        return Ok(());
    }
    let archive = dir.join("archive");
    fs::create_dir_all(&archive)?;
    let overflow = entries.len() - MAX_ACTIVE;
    for e in entries.into_iter().take(overflow) {
        let target = archive.join(e.file_name());
        fs::rename(e.path(), target)?;
    }
    Ok(())
}

/// Build the shared HTTP client used for login & other REST calls.
fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// POST JSON with exponential backoff on connection / 5xx errors.
/// Does NOT retry on 4xx — those are caller errors that retrying won't fix.
async fn post_json_with_retry(
    client: &reqwest::Client,
    url: &str,
    body: &Value,
) -> Result<reqwest::Response, String> {
    const MAX_ATTEMPTS: u32 = 3;
    let mut delay_ms: u64 = 500;
    let mut last_err: String = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        match client.post(url).json(body).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.is_client_error() {
                    // 4xx caller error：不重試
                    return Ok(resp);
                }
                // 5xx / 其他：值得重試
                last_err = format!("HTTP {}", status);
            }
            Err(e) => {
                last_err = if e.is_timeout() {
                    "request timed out".to_string()
                } else if e.is_connect() {
                    "connection failed".to_string()
                } else {
                    format!("network error: {e}")
                };
            }
        }

        if attempt < MAX_ATTEMPTS {
            diagnostics::incr_http_retry();
            tracing::warn!(
                url = %url,
                attempt,
                max_attempts = MAX_ATTEMPTS,
                error = %last_err,
                delay_ms,
                "HTTP request failed, retrying",
            );
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            delay_ms = delay_ms.saturating_mul(2);
        }
    }

    Err(format!(
        "HTTP request to {} failed after {} attempts: {}",
        url, MAX_ATTEMPTS, last_err
    ))
}

/// Get the config file path: ~/.pixel-agents/node-config.json
fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".pixel-agents").join("node-config.json"))
}

/// Get the desktop settings file path: ~/.pixel-agents/desktop-settings.json
fn settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".pixel-agents").join("desktop-settings.json"))
}

/// Return the current application status by querying the sidecar.
#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Ok(json!({
            "sidecarStatus": "stopped",
            "connected": false,
            "agentCount": 0,
            "latency": 0,
        }));
    }
    sidecar.request("getStatus", None).await
}

/// Login to a pixel-agents server with username/password.
#[tauri::command]
pub async fn login_server(
    server_url: String,
    username: String,
    password: String,
) -> Result<Value, String> {
    let client = build_http_client()?;
    let url = format!("{}/api/auth/login", server_url.trim_end_matches('/'));

    let resp = post_json_with_retry(
        &client,
        &url,
        &json!({ "username": username, "password": password }),
    )
    .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Login failed ({}): {}", status, body));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let token = body["token"]
        .as_str()
        .ok_or_else(|| "Response missing token".to_string())?;
    let resp_username = body["username"]
        .as_str()
        .unwrap_or(&username);

    // Save config
    save_config_to_file(&server_url, token)?;

    Ok(json!({
        "ok": true,
        "token": token,
        "username": resp_username,
    }))
}

/// Login to a pixel-agents server with an API key.
#[tauri::command]
pub async fn login_with_key(
    server_url: String,
    api_key: String,
) -> Result<Value, String> {
    let client = build_http_client()?;
    let url = format!("{}/api/auth/login-key", server_url.trim_end_matches('/'));

    let resp = post_json_with_retry(
        &client,
        &url,
        &json!({ "apiKey": api_key }),
    )
    .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Login failed ({}): {}", status, body));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let token = body["token"]
        .as_str()
        .ok_or_else(|| "Response missing token".to_string())?;
    let resp_username = body["username"]
        .as_str()
        .unwrap_or("unknown");

    // Save config
    save_config_to_file(&server_url, token)?;

    Ok(json!({
        "ok": true,
        "token": token,
        "username": resp_username,
    }))
}

/// Load saved config: server URL 從檔案、token 優先讀 keychain，
/// 回退到舊格式檔案中的 token 欄位以保持向後相容。
#[tauri::command]
pub async fn load_config() -> Result<Value, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {e}"))?;
    let mut config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    // Token 優先從 keychain 讀取；若 keychain 中沒有但檔案中有（舊版資料），
    // 保留檔案中的 token 作為最後備援。
    if let Some(token) = secret_store::load_token() {
        if let Some(obj) = config.as_object_mut() {
            obj.insert("token".to_string(), Value::String(token));
        }
    }

    Ok(config)
}

/// Save config to ~/.pixel-agents/node-config.json.
#[tauri::command]
pub async fn save_config(server_url: String, token: String) -> Result<Value, String> {
    save_config_to_file(&server_url, &token)?;
    Ok(json!({ "ok": true }))
}

/// Internal helper to write config.
///
/// Token 優先寫入 OS keychain（macOS Keychain / Windows Credential Manager /
/// Linux Secret Service）。若 keychain 不可用則回退到加密度較低但仍收斂
/// 為 0600 權限的本地檔案；無論哪條路徑，server URL 都寫入檔案。
fn save_config_to_file(server_url: &str, token: &str) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {e}"))?;
    }

    let stored_in_keychain = secret_store::store_token(token).unwrap_or(false);

    // 檔案中僅在 keychain 不可用時保留 token；否則不寫 token 欄位，
    // 避免磁碟上留下明文副本。
    let config = if stored_in_keychain {
        json!({ "server": server_url })
    } else {
        json!({ "server": server_url, "token": token })
    };
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = fs::Permissions::from_mode(0o600);
        if let Err(e) = fs::set_permissions(&path, perm) {
            tracing::warn!("Failed to tighten config file permissions: {e}");
        }
    }

    Ok(())
}

/// Connect to a pixel-agents server via the sidecar.
#[tauri::command]
pub async fn connect_server(
    server_url: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar
        .request(
            "connect",
            Some(json!({ "serverUrl": server_url, "token": token })),
        )
        .await
}

/// Disconnect from the pixel-agents server.
#[tauri::command]
pub async fn disconnect_server(state: State<'_, AppState>) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar.request("disconnect", None).await
}

// ---------------------------------------------------------------------------
// Terminal commands — forwarded to sidecar
// ---------------------------------------------------------------------------

/// Attach a terminal to a specific agent session.
#[tauri::command]
pub async fn terminal_attach(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar
        .request(
            "terminalAttach",
            Some(json!({
                "sessionId": session_id,
                "cols": cols,
                "rows": rows,
            })),
        )
        .await
}

/// Send input data to a terminal.
#[tauri::command]
pub async fn terminal_input(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar
        .request(
            "terminalInput",
            Some(json!({
                "sessionId": session_id,
                "data": data,
            })),
        )
        .await
}

/// Resize a terminal.
#[tauri::command]
pub async fn terminal_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar
        .request(
            "terminalResize",
            Some(json!({
                "sessionId": session_id,
                "cols": cols,
                "rows": rows,
            })),
        )
        .await
}

/// Detach a terminal from a session.
#[tauri::command]
pub async fn terminal_detach(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar
        .request(
            "terminalDetach",
            Some(json!({
                "sessionId": session_id,
            })),
        )
        .await
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

/// Load desktop settings from ~/.pixel-agents/desktop-settings.json.
#[tauri::command]
pub async fn load_settings() -> Result<Value, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {e}"))?;
    let settings: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings: {e}"))?;
    Ok(settings)
}

/// Save desktop settings to ~/.pixel-agents/desktop-settings.json.
#[tauri::command]
pub async fn save_settings(settings: Value) -> Result<Value, String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {e}"))?;
    }
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(json!({ "ok": true }))
}

/// Update the scan interval on the running sidecar.
#[tauri::command]
pub async fn update_scan_interval(
    interval_ms: u32,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar
        .request(
            "updateScanInterval",
            Some(json!({ "intervalMs": interval_ms })),
        )
        .await
}

/// Update the excluded projects list on the running sidecar.
#[tauri::command]
pub async fn update_excluded_projects(
    projects: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if !sidecar.is_running().await {
        return Err("Sidecar not running".to_string());
    }
    sidecar
        .request(
            "updateExcludedProjects",
            Some(json!({ "projects": projects })),
        )
        .await
}

/// Logout: disconnect sidecar, clear keychain token, and delete config file.
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if sidecar.is_running().await {
        let _ = sidecar.request("disconnect", None).await;
    }

    // 清除 keychain 中的 token（若存在）
    if let Err(e) = secret_store::delete_token() {
        tracing::warn!("Failed to delete token from keychain: {e}");
    }

    // 刪除 config 檔
    let path = config_path()?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete config: {e}"))?;
    }

    Ok(json!({ "ok": true }))
}
