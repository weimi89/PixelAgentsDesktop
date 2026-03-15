use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex, Notify};

use crate::ipc::{decode_line, encode_request, IpcMessage, IpcRequest};
use crate::tray;

/// Pending request: maps request ID → oneshot sender for the response.
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// Maximum restarts within the reset window.
const MAX_RESTARTS: u32 = 3;
/// Window after which the restart counter resets (5 minutes).
const RESTART_WINDOW_SECS: u64 = 300;
/// Base backoff delay in seconds (exponential: 1s, 3s, 9s).
const BACKOFF_BASE_SECS: u64 = 1;
const BACKOFF_MULTIPLIER: u64 = 3;

/// Result of spawning a child process — the parts we need to wire up.
struct SpawnedChild {
    child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
}

/// Spawn the node sidecar process. This is a plain function (no &mut self)
/// so that its future is Send.
fn spawn_child_process(node_path: &str, sidecar_path: &str) -> Result<SpawnedChild, String> {
    let mut child = Command::new(node_path)
        .arg(sidecar_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    let stdin = child.stdin.take().ok_or("Failed to open sidecar stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to open sidecar stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open sidecar stderr")?;

    Ok(SpawnedChild {
        child,
        stdin,
        stdout,
        stderr,
    })
}

/// Manages the Node.js sidecar process lifecycle and IPC.
pub struct SidecarManager {
    child: Option<Child>,
    stdin: Option<tokio::process::ChildStdin>,
    pending: PendingMap,
    next_id: Arc<AtomicU64>,
    /// Flag to distinguish intentional shutdown from crash.
    shutting_down: Arc<AtomicBool>,
    /// Notify handle to cancel the monitor task on shutdown.
    shutdown_notify: Arc<Notify>,
    /// Crash tracking for auto-restart.
    restart_count: Arc<AtomicU64>,
    last_restart_time: Arc<Mutex<Option<Instant>>>,
    /// Agent count tracked from sidecar events (for tray updates).
    agent_count: Arc<AtomicU64>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
            shutting_down: Arc::new(AtomicBool::new(false)),
            shutdown_notify: Arc::new(Notify::new()),
            restart_count: Arc::new(AtomicU64::new(0)),
            last_restart_time: Arc::new(Mutex::new(None)),
            agent_count: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Spawn the sidecar process and start reading stdout in background.
    pub async fn spawn(
        &mut self,
        node_path: &str,
        sidecar_path: &str,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        log::info!("Spawning sidecar: {} {}", node_path, sidecar_path);
        self.shutting_down.store(false, Ordering::SeqCst);

        let spawned = spawn_child_process(node_path, sidecar_path)?;
        self.install_child(spawned, node_path, sidecar_path, app_handle);

        log::info!("Sidecar spawned successfully");
        Ok(())
    }

    /// Wire up a newly-spawned child: store handles, start reader tasks.
    fn install_child(
        &mut self,
        spawned: SpawnedChild,
        node_path: &str,
        sidecar_path: &str,
        app_handle: AppHandle,
    ) {
        self.child = Some(spawned.child);
        self.stdin = Some(spawned.stdin);

        // Clone shared state for the reader task
        let pending = self.pending.clone();
        let app = app_handle.clone();
        let shutting_down = self.shutting_down.clone();
        let shutdown_notify = self.shutdown_notify.clone();
        let agent_count = self.agent_count.clone();
        let restart_count = self.restart_count.clone();
        let last_restart_time = self.last_restart_time.clone();
        let restart_node_path = node_path.to_string();
        let restart_sidecar_path = sidecar_path.to_string();

        let stdout = spawned.stdout;
        let stderr = spawned.stderr;

        // Spawn stdout reader + crash monitor task
        tokio::spawn(async move {
            // --- Read stdout lines ---
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                match decode_line(&line) {
                    Ok(IpcMessage::Response(resp)) => {
                        let mut map = pending.lock().await;
                        if let Some(tx) = map.remove(&resp.id) {
                            if let Some(err) = resp.error {
                                let _ = tx.send(Err(err));
                            } else {
                                let _ = tx.send(Ok(resp.result.unwrap_or(Value::Null)));
                            }
                        }
                    }
                    Ok(IpcMessage::Event(evt)) => {
                        log::debug!("Sidecar event: {} {:?}", evt.event, evt.data);
                        handle_tray_event(&app, &evt.event, &evt.data, &agent_count);
                        let _ = app.emit("sidecar-event", &evt);
                    }
                    Err(e) => {
                        log::warn!("Failed to decode sidecar line: {e} — line: {line}");
                    }
                }
            }

            log::info!("Sidecar stdout reader ended");

            // --- Crash detection & auto-restart ---
            if shutting_down.load(Ordering::SeqCst) {
                log::info!("Sidecar shutdown was intentional, not restarting");
                return;
            }

            log::warn!("Sidecar exited unexpectedly, attempting auto-restart...");
            let _ = app.emit(
                "sidecar-crash",
                serde_json::json!({
                    "message": "Sidecar process crashed, attempting restart..."
                }),
            );

            // Check restart limits & apply backoff
            let can_restart = check_restart_limits(
                &restart_count,
                &last_restart_time,
                &shutting_down,
                &shutdown_notify,
                &app,
            )
            .await;

            if !can_restart {
                return;
            }

            // Re-spawn via AppState
            log::info!("Re-spawning sidecar...");
            match spawn_child_process(&restart_node_path, &restart_sidecar_path) {
                Ok(spawned) => {
                    let state: tauri::State<'_, crate::state::AppState> = app.state();
                    let mut sidecar = state.sidecar.lock().await;
                    sidecar.install_child(
                        spawned,
                        &restart_node_path,
                        &restart_sidecar_path,
                        app.clone(),
                    );

                    log::info!("Sidecar restarted successfully");
                    let _ = app.emit(
                        "sidecar-crash",
                        serde_json::json!({
                            "message": "Sidecar restarted successfully",
                            "recovered": true
                        }),
                    );

                    // Clone atomics before dropping sidecar lock
                    let stable_restart_count = sidecar.restart_count.clone();
                    let stable_shutdown = sidecar.shutting_down.clone();
                    drop(sidecar);

                    // Stability monitor: reset counter after 5 min stable
                    tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(RESTART_WINDOW_SECS))
                            .await;
                        if !stable_shutdown.load(Ordering::SeqCst) {
                            log::info!(
                                "Sidecar stable for {} minutes, resetting restart counter",
                                RESTART_WINDOW_SECS / 60
                            );
                            stable_restart_count.store(0, Ordering::SeqCst);
                        }
                    });
                }
                Err(e) => {
                    log::error!("Failed to restart sidecar: {e}");
                    let _ = app.emit(
                        "sidecar-crash",
                        serde_json::json!({
                            "message": format!("Failed to restart sidecar: {e}"),
                            "fatal": true
                        }),
                    );
                }
            }
        });

        // Spawn stderr reader task (forward to logs)
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::debug!("[sidecar stderr] {line}");
            }
        });
    }

    /// Send a request to the sidecar and await the response.
    pub async fn request(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        let stdin = self.stdin.as_mut().ok_or("Sidecar not running")?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = IpcRequest {
            id,
            method: method.to_string(),
            params,
        };

        let line = encode_request(&req).map_err(|e| format!("Serialize error: {e}"))?;

        // Register pending response
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        // Write to stdin
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to sidecar stdin: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush sidecar stdin: {e}"))?;

        // Await response with timeout
        match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Sidecar response channel closed".to_string()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err("Sidecar request timed out (10s)".to_string())
            }
        }
    }

    /// Gracefully shut down the sidecar.
    pub async fn shutdown(&mut self) -> Result<(), String> {
        // Signal intentional shutdown
        self.shutting_down.store(true, Ordering::SeqCst);
        self.shutdown_notify.notify_waiters();

        if self.stdin.is_some() {
            // Try to send shutdown command with a short timeout
            let shutdown_result = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                self.request("shutdown", None),
            )
            .await;

            match shutdown_result {
                Ok(Ok(_)) => log::info!("Sidecar acknowledged shutdown"),
                Ok(Err(e)) => log::warn!("Sidecar shutdown request failed: {e}"),
                Err(_) => log::warn!("Sidecar shutdown request timed out (3s)"),
            }
        }

        // Force kill if still running
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
        self.stdin = None;
        self.pending.lock().await.clear();
        log::info!("Sidecar shut down");
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }
}

/// Check restart limits, apply backoff, and return whether restart is allowed.
async fn check_restart_limits(
    restart_count: &Arc<AtomicU64>,
    last_restart_time: &Arc<Mutex<Option<Instant>>>,
    shutting_down: &Arc<AtomicBool>,
    shutdown_notify: &Arc<Notify>,
    app: &AppHandle,
) -> bool {
    let mut last_time = last_restart_time.lock().await;
    let now = Instant::now();

    // Reset counter if outside the window
    if let Some(t) = *last_time {
        if now.duration_since(t).as_secs() > RESTART_WINDOW_SECS {
            restart_count.store(0, Ordering::SeqCst);
        }
    }

    let count = restart_count.fetch_add(1, Ordering::SeqCst);
    *last_time = Some(now);
    drop(last_time); // Release lock before sleep

    if count >= MAX_RESTARTS as u64 {
        log::error!(
            "Sidecar crashed {} times within {} minutes, giving up",
            MAX_RESTARTS,
            RESTART_WINDOW_SECS / 60
        );
        let _ = app.emit(
            "sidecar-crash",
            serde_json::json!({
                "message": "Sidecar crashed too many times, giving up. Please restart the app.",
                "fatal": true
            }),
        );
        return false;
    }

    // Exponential backoff: 1s, 3s, 9s
    let delay_secs = BACKOFF_BASE_SECS * BACKOFF_MULTIPLIER.pow(count as u32);
    log::info!(
        "Waiting {}s before restart (attempt {}/{})",
        delay_secs,
        count + 1,
        MAX_RESTARTS
    );

    tokio::select! {
        _ = tokio::time::sleep(std::time::Duration::from_secs(delay_secs)) => {
            !shutting_down.load(Ordering::SeqCst)
        }
        _ = shutdown_notify.notified() => {
            log::info!("Shutdown requested during restart backoff");
            false
        }
    }
}

/// Handle tray-relevant events from the sidecar.
fn handle_tray_event(
    app: &AppHandle,
    event_name: &str,
    data: &Value,
    agent_count: &Arc<AtomicU64>,
) {
    match event_name {
        "connectionStatus" => {
            let connected = data
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !connected {
                agent_count.store(0, Ordering::SeqCst);
            }
            tray::update_tray_status(app, connected, agent_count.load(Ordering::SeqCst) as u32);
        }
        "agentStarted" | "agent_created" => {
            let count = agent_count.fetch_add(1, Ordering::SeqCst) + 1;
            tray::update_tray_status(app, true, count as u32);
        }
        "agentStopped" | "agent_closed" => {
            let prev = agent_count.load(Ordering::SeqCst);
            let count = if prev > 0 { prev - 1 } else { 0 };
            agent_count.store(count, Ordering::SeqCst);
            tray::update_tray_status(app, true, count as u32);
        }
        "connected" => {
            tray::update_tray_status(app, true, agent_count.load(Ordering::SeqCst) as u32);
        }
        "disconnected" => {
            agent_count.store(0, Ordering::SeqCst);
            tray::update_tray_status(app, false, 0);
        }
        _ => {}
    }
}
