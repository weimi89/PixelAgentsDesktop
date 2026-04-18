//! # Pixel Agents Desktop — Rust 後端
//!
//! Tauri 2.x 應用主體。本 crate 負責：
//!
//! 1. 初始化 tracing 日誌與內部診斷計數器（`init_tracing` / `diagnostics::init`）
//! 2. 註冊 Tauri 外掛：`shell`、`autostart`、`window_state`、`updater`、`process`
//! 3. 建立並管理 Node.js sidecar 子程序生命週期（見 [`sidecar`]）
//! 4. 暴露 Tauri 命令給前端（見 [`commands`]）
//! 5. 安裝系統匣（見 [`tray`]）與 macOS 原生選單列（見 [`menu`]）
//! 6. 從 `~/.pixel-agents/node-config.json` 載入伺服器 URL，並從 OS keychain
//!    讀取 token 自動連線（見 [`secret_store`]）
//!
//! ## 關鍵設計
//!
//! - `AppState.sidecar` 為 [`Arc<SidecarManager>`](sidecar::SidecarManager)，
//!   不包外層 `Mutex` — `SidecarManager` 內部全為 `Arc<Mutex/Atomic>`。
//!   這避免了舊版 `Mutex<SidecarManager>` 在 shutdown 路徑與 reader task
//!   restart 路徑之間造成的鎖定順序死鎖。
//! - 關閉視窗時僅 `hide()` 不 `close()`，應用維持背景運作直到從系統匣
//!   選單「結束」或 macOS Cmd+Q。
//! - macOS 視窗策略為 `ActivationPolicy::Accessory`，不佔用 Dock icon。

mod commands;
mod diagnostics;
mod ipc;
mod menu;
mod secret_store;
mod sidecar;
mod state;
mod tray;

use tracing_subscriber::EnvFilter;

/// 初始化 tracing subscriber。
///
/// - `tracing_log::LogTracer` 將 `log` crate 的訊息橋接到 tracing；
///   Tauri / tokio 等依賴仍以 `log!` 輸出，必須橋接才能統一落地。
/// - 預設 filter 為 `info`；`RUST_LOG=debug` 可覆寫（例如 debug sidecar IPC）。
/// - 使用 `try_init` 避免測試環境中重複初始化 panic。
fn init_tracing() {
    let _ = tracing_log::LogTracer::init();

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .try_init();
}

use state::AppState;
use tauri::{Manager, RunEvent, WindowEvent};

/// 應用程式入口。由 `main.rs` 呼叫；標記 `#[tauri::mobile_entry_point]`
/// 讓未來行動端共用同一個入口。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    diagnostics::init();
    tracing::info!("Pixel Agents Desktop starting...");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::connect_server,
            commands::disconnect_server,
            commands::login_server,
            commands::login_with_key,
            commands::load_config,
            commands::save_config,
            commands::terminal_attach,
            commands::terminal_input,
            commands::terminal_resize,
            commands::terminal_detach,
            commands::load_settings,
            commands::save_settings,
            commands::update_scan_interval,
            commands::update_excluded_projects,
            commands::logout,
            commands::get_diagnostics,
            commands::report_crash,
            commands::list_crashes,
            commands::clear_crashes,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide the window instead of closing — minimize to tray
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            // Set up system tray
            if let Err(e) = tray::setup_tray(app) {
                tracing::error!("Failed to set up system tray: {e}");
            }

            // Install native menu bar (macOS only)
            if let Err(e) = menu::install(app) {
                tracing::error!("Failed to install menu bar: {e}");
            }

            // macOS: hide dock icon, behave as a tray-only app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_handle = app.handle().clone();

            // Resolve sidecar paths
            let node_path = which_node().unwrap_or_else(|| "node".to_string());
            let sidecar_path = resolve_sidecar_path(app);

            tracing::info!("Node path: {node_path}");
            tracing::info!("Sidecar path: {sidecar_path}");

            // Spawn sidecar in background, then auto-connect if config exists.
            // No outer lock is held — SidecarManager uses internal synchronization.
            tauri::async_runtime::spawn(async move {
                let sidecar = {
                    let state: tauri::State<'_, AppState> = app_handle.state();
                    state.sidecar.clone()
                };

                if let Err(e) = sidecar
                    .clone()
                    .spawn(&node_path, &sidecar_path, app_handle.clone())
                    .await
                {
                    tracing::error!("Failed to spawn sidecar: {e}");
                    return;
                }

                // Try auto-connect from saved config
                if let Some(home) = dirs::home_dir() {
                    let config_path = home.join(".pixel-agents").join("node-config.json");
                    if config_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&config_path) {
                            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let (Some(server), Some(token)) = (
                                    config["server"].as_str(),
                                    config["token"].as_str(),
                                ) {
                                    tracing::info!("Auto-connecting to {server}...");
                                    match sidecar
                                        .request(
                                            "connect",
                                            Some(serde_json::json!({
                                                "serverUrl": server,
                                                "token": token,
                                            })),
                                        )
                                        .await
                                    {
                                        Ok(_) => tracing::info!("Auto-connect succeeded"),
                                        Err(e) => tracing::warn!("Auto-connect failed: {e}"),
                                    }
                                }
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run with event handler for graceful shutdown
    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = &event {
            tracing::info!("Exit requested, shutting down sidecar...");
            let handle = app_handle.clone();
            tauri::async_runtime::block_on(async move {
                let sidecar = {
                    let state: tauri::State<'_, AppState> = handle.state();
                    state.sidecar.clone()
                };
                if sidecar.is_running().await {
                    if let Err(e) = sidecar.shutdown().await {
                        tracing::error!("Error during sidecar shutdown: {e}");
                    }
                }
            });
        }
    });
}

/// Find the `node` binary on PATH.
fn which_node() -> Option<String> {
    std::process::Command::new("which")
        .arg("node")
        .output()
        .ok()
        .and_then(|out| {
            if out.status.success() {
                String::from_utf8(out.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

/// Resolve the path to sidecar.mjs.
///
/// In dev mode, look relative to the project root.
/// In production, look in the app's resource directory.
fn resolve_sidecar_path(app: &tauri::App) -> String {
    // Dev mode: sidecar is built at sidecar/dist/sidecar.mjs relative to project
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("sidecar/dist/sidecar.mjs");

    if dev_path.exists() {
        return dev_path.to_string_lossy().to_string();
    }

    // Production: look in resource dir
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("sidecar.mjs");
        if prod_path.exists() {
            return prod_path.to_string_lossy().to_string();
        }
    }

    // Fallback
    "sidecar.mjs".to_string()
}
