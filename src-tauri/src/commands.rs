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
