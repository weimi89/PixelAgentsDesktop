use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::State;

use crate::state::AppState;

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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    let url = format!("{}/api/auth/login", server_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .json(&json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    let url = format!("{}/api/auth/login-key", server_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .json(&json!({ "apiKey": api_key }))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

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

/// Load saved config from ~/.pixel-agents/node-config.json.
#[tauri::command]
pub async fn load_config() -> Result<Value, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {e}"))?;
    let config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {e}"))?;
    Ok(config)
}

/// Save config to ~/.pixel-agents/node-config.json.
#[tauri::command]
pub async fn save_config(server_url: String, token: String) -> Result<Value, String> {
    save_config_to_file(&server_url, &token)?;
    Ok(json!({ "ok": true }))
}

/// Internal helper to write config file.
fn save_config_to_file(server_url: &str, token: &str) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {e}"))?;
    }
    let config = json!({
        "server": server_url,
        "token": token,
    });
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {e}"))?;
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

/// Logout: disconnect sidecar and delete config file.
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<Value, String> {
    let sidecar = state.sidecar.clone();
    if sidecar.is_running().await {
        let _ = sidecar.request("disconnect", None).await;
    }

    // Delete config file
    let path = config_path()?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete config: {e}"))?;
    }

    Ok(json!({ "ok": true }))
}
