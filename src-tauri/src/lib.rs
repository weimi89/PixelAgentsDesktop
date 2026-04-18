mod commands;
mod diagnostics;
mod ipc;
mod secret_store;
mod sidecar;
mod state;
mod tray;

use tracing_subscriber::EnvFilter;

fn init_tracing() {
    // 把 log crate 的訊息橋接到 tracing（Tauri 與 tokio 等依賴仍使用 log!）
    let _ = tracing_log::LogTracer::init();

    // RUST_LOG=debug 可覆寫；預設 info
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .try_init();
}

use state::AppState;
use tauri::{Manager, RunEvent, WindowEvent};

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
