use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, Notify};
use tokio::task::JoinHandle;

use crate::diagnostics;
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
/// Request timeout in seconds.
const REQUEST_TIMEOUT_SECS: u64 = 10;
/// Shutdown IPC timeout (shorter than REQUEST_TIMEOUT_SECS).
const SHUTDOWN_TIMEOUT_SECS: u64 = 3;

/// IPC protocol version expected from the sidecar's `ready` event.
/// Bump this if `ipcProtocol.ts` adds breaking changes (not when adding new
/// optional fields).
const EXPECTED_SIDECAR_VERSION: &str = "0.1.0";

/// Result of spawning a child process — the parts we need to wire up.
struct SpawnedChild {
    child: Child,
    stdin: ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
}

/// Spawn the node sidecar process.
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
///
/// All fields are internally mutable (Arc<Mutex<>> / Arc<Atomic*>) so that
/// `SidecarManager` can be shared via `Arc<Self>` with all methods taking `&self`.
/// This avoids holding any outer lock while awaiting IPC responses, preventing
/// the shutdown deadlock that occurred when a held `Mutex<SidecarManager>` was
/// needed by the reader task's crash-restart path.
pub struct SidecarManager {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    pending: PendingMap,
    next_id: Arc<AtomicU64>,
    shutting_down: Arc<AtomicBool>,
    shutdown_notify: Arc<Notify>,
    restart_count: Arc<AtomicU64>,
    last_restart_time: Arc<Mutex<Option<Instant>>>,
    agent_count: Arc<AtomicU64>,
    /// Last successful connect params; used to re-connect after a crash restart.
    last_connect_params: Arc<Mutex<Option<ConnectParams>>>,
    /// Handle to the stability-monitor task (aborted on subsequent restarts).
    stability_task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[derive(Debug, Clone)]
pub struct ConnectParams {
    pub server_url: String,
    pub token: String,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
            shutting_down: Arc::new(AtomicBool::new(false)),
            shutdown_notify: Arc::new(Notify::new()),
            restart_count: Arc::new(AtomicU64::new(0)),
            last_restart_time: Arc::new(Mutex::new(None)),
            agent_count: Arc::new(AtomicU64::new(0)),
            last_connect_params: Arc::new(Mutex::new(None)),
            stability_task: Arc::new(Mutex::new(None)),
        }
    }

    /// Spawn the sidecar process and start reading stdout in background.
    pub async fn spawn(
        self: Arc<Self>,
        node_path: &str,
        sidecar_path: &str,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        tracing::info!(node_path, sidecar_path, "spawning sidecar");
        diagnostics::incr_sidecar_spawn();
        self.shutting_down.store(false, Ordering::SeqCst);

        let spawned = spawn_child_process(node_path, sidecar_path)?;
        self.install_child(
            spawned,
            node_path.to_string(),
            sidecar_path.to_string(),
            app_handle,
        )
        .await;

        tracing::info!("Sidecar spawned successfully");
        Ok(())
    }

    /// Wire up a newly-spawned child: store handles, start reader tasks.
    ///
    /// Returns a `BoxFuture` (not `async fn`) so the recursive call from the
    /// reader task's restart path has a concrete, `Send` type — avoiding
    /// infinite auto-trait inference on `impl Future`.
    fn install_child(
        self: Arc<Self>,
        spawned: SpawnedChild,
        node_path: String,
        sidecar_path: String,
        app_handle: AppHandle,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'static>> {
        Box::pin(self.install_child_impl(spawned, node_path, sidecar_path, app_handle))
    }

    async fn install_child_impl(
        self: Arc<Self>,
        spawned: SpawnedChild,
        node_path: String,
        sidecar_path: String,
        app_handle: AppHandle,
    ) {
        *self.child.lock().await = Some(spawned.child);
        *self.stdin.lock().await = Some(spawned.stdin);

        // Shared state for reader task
        let pending = self.pending.clone();
        let app = app_handle.clone();
        let shutting_down = self.shutting_down.clone();
        let shutdown_notify = self.shutdown_notify.clone();
        let agent_count = self.agent_count.clone();
        let manager = self.clone();
        let restart_node_path = node_path;
        let restart_sidecar_path = sidecar_path;

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
                        diagnostics::incr_ipc_event();
                        tracing::debug!(event = %evt.event, "sidecar event");
                        if evt.event == "ready" {
                            if let Some(version) =
                                evt.data.get("version").and_then(|v| v.as_str())
                            {
                                if version != EXPECTED_SIDECAR_VERSION {
                                    tracing::warn!(
                                        "Sidecar protocol version mismatch: expected {}, got {}",
                                        EXPECTED_SIDECAR_VERSION,
                                        version
                                    );
                                    let _ = app.emit(
                                        "sidecar-crash",
                                        serde_json::json!({
                                            "message": format!(
                                                "Sidecar protocol version mismatch: expected {}, got {}. Some features may not work.",
                                                EXPECTED_SIDECAR_VERSION, version
                                            ),
                                            "warning": true
                                        }),
                                    );
                                } else {
                                    tracing::info!("Sidecar protocol version: {}", version);
                                }
                            }
                        }
                        handle_tray_event(&app, &evt.event, &evt.data, &agent_count);
                        let _ = app.emit("sidecar-event", &evt);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to decode sidecar line: {e} — line: {line}");
                    }
                }
            }

            tracing::info!("Sidecar stdout reader ended");

            // --- Drain pending to avoid 10s timeouts on the frontend ---
            {
                let mut map = pending.lock().await;
                let drained: Vec<_> = map.drain().collect();
                drop(map);
                for (_, tx) in drained {
                    let _ = tx.send(Err("Sidecar exited".to_string()));
                }
            }

            // Close stdin since the process is gone
            *manager.stdin.lock().await = None;

            // --- Crash detection & auto-restart ---
            if shutting_down.load(Ordering::SeqCst) {
                tracing::info!("Sidecar shutdown was intentional, not restarting");
                return;
            }

            tracing::warn!("Sidecar exited unexpectedly, attempting auto-restart...");
            diagnostics::incr_sidecar_crash();
            let _ = app.emit(
                "sidecar-crash",
                serde_json::json!({
                    "message": "Sidecar process crashed, attempting restart..."
                }),
            );

            // Check restart limits & apply backoff
            let can_restart = check_restart_limits(
                &manager.restart_count,
                &manager.last_restart_time,
                &shutting_down,
                &shutdown_notify,
                &app,
            )
            .await;

            if !can_restart {
                return;
            }

            tracing::info!("Re-spawning sidecar...");
            match spawn_child_process(&restart_node_path, &restart_sidecar_path) {
                Ok(spawned) => {
                    manager
                        .clone()
                        .install_child(
                            spawned,
                            restart_node_path.clone(),
                            restart_sidecar_path.clone(),
                            app.clone(),
                        )
                        .await;

                    tracing::info!("Sidecar restarted successfully");
                    diagnostics::incr_sidecar_restart();
                    let _ = app.emit(
                        "sidecar-crash",
                        serde_json::json!({
                            "message": "Sidecar restarted successfully",
                            "recovered": true
                        }),
                    );

                    // Stability monitor: reset counter after 5 min stable.
                    // Cancel any prior monitor first so we don't pile up tasks.
                    let prev_task = manager.stability_task.lock().await.take();
                    if let Some(handle) = prev_task {
                        handle.abort();
                    }
                    let shutdown_flag = manager.shutting_down.clone();
                    let restart_count = manager.restart_count.clone();
                    let new_task = tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(RESTART_WINDOW_SECS))
                            .await;
                        if !shutdown_flag.load(Ordering::SeqCst) {
                            tracing::info!(
                                "Sidecar stable for {} minutes, resetting restart counter",
                                RESTART_WINDOW_SECS / 60
                            );
                            restart_count.store(0, Ordering::SeqCst);
                        }
                    });
                    *manager.stability_task.lock().await = Some(new_task);

                    // Re-connect to server if we had a prior successful connect.
                    let maybe_params = manager.last_connect_params.lock().await.clone();
                    if let Some(params) = maybe_params {
                        tracing::info!("Re-connecting after restart...");
                        match manager
                            .request(
                                "connect",
                                Some(serde_json::json!({
                                    "serverUrl": params.server_url,
                                    "token": params.token,
                                })),
                            )
                            .await
                        {
                            Ok(_) => tracing::info!("Auto-reconnect succeeded"),
                            Err(e) => tracing::warn!("Auto-reconnect failed: {e}"),
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to restart sidecar: {e}");
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
                tracing::debug!("[sidecar stderr] {line}");
            }
        });
    }

    /// Send a request to the sidecar and await the response.
    ///
    /// The stdin lock is held only during the write; awaiting the response
    /// does not hold any sidecar-wide lock.
    pub async fn request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        diagnostics::incr_ipc_request();
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = IpcRequest {
            id,
            method: method.to_string(),
            params: params.clone(),
        };
        let line = encode_request(&req).map_err(|e| format!("Serialize error: {e}"))?;

        // Register pending response
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        // Write to stdin — hold the lock only for the write
        {
            let mut guard = self.stdin.lock().await;
            let stdin = match guard.as_mut() {
                Some(s) => s,
                None => {
                    self.pending.lock().await.remove(&id);
                    return Err("Sidecar not running".to_string());
                }
            };
            if let Err(e) = stdin.write_all(line.as_bytes()).await {
                self.pending.lock().await.remove(&id);
                return Err(format!("Failed to write to sidecar stdin: {e}"));
            }
            if let Err(e) = stdin.flush().await {
                self.pending.lock().await.remove(&id);
                return Err(format!("Failed to flush sidecar stdin: {e}"));
            }
        }

        // Await response with timeout (no locks held)
        let result = match tokio::time::timeout(
            std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS),
            rx,
        )
        .await
        {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Sidecar response channel closed".to_string()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(format!(
                    "Sidecar request timed out ({}s)",
                    REQUEST_TIMEOUT_SECS
                ))
            }
        };

        if result.is_err() {
            diagnostics::incr_ipc_error();
        }

        // Remember successful connect params for post-crash auto-reconnect
        if method == "connect" && result.is_ok() {
            if let Some(p) = params.as_ref() {
                if let (Some(server), Some(token)) = (
                    p.get("serverUrl").and_then(|v| v.as_str()),
                    p.get("token").and_then(|v| v.as_str()),
                ) {
                    *self.last_connect_params.lock().await = Some(ConnectParams {
                        server_url: server.to_string(),
                        token: token.to_string(),
                    });
                }
            }
        } else if method == "disconnect" && result.is_ok() {
            // Clear remembered params so a crash after intentional disconnect
            // doesn't reconnect unexpectedly.
            *self.last_connect_params.lock().await = None;
        }

        result
    }

    /// Gracefully shut down the sidecar.
    ///
    /// Critically, this does NOT hold any shared sidecar lock while awaiting
    /// the shutdown response. The reader task may complete during shutdown;
    /// holding a lock here while it tries to run would deadlock.
    pub async fn shutdown(&self) -> Result<(), String> {
        // Signal intentional shutdown BEFORE sending the request so the
        // reader task won't trigger auto-restart when the process exits.
        self.shutting_down.store(true, Ordering::SeqCst);
        self.shutdown_notify.notify_waiters();

        // Abort stability monitor if any
        if let Some(handle) = self.stability_task.lock().await.take() {
            handle.abort();
        }

        // Send shutdown request with a short timeout (no outer lock held)
        let stdin_present = self.stdin.lock().await.is_some();
        if stdin_present {
            let req_fut = self.request("shutdown", None);
            match tokio::time::timeout(
                std::time::Duration::from_secs(SHUTDOWN_TIMEOUT_SECS),
                req_fut,
            )
            .await
            {
                Ok(Ok(_)) => tracing::info!("Sidecar acknowledged shutdown"),
                Ok(Err(e)) => tracing::warn!("Sidecar shutdown request failed: {e}"),
                Err(_) => tracing::warn!(
                    "Sidecar shutdown request timed out ({SHUTDOWN_TIMEOUT_SECS}s)"
                ),
            }
        }

        // Close stdin first so the child's readline EOFs
        *self.stdin.lock().await = None;

        // Force kill if still running
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }

        // Clear pending and notify any remaining waiters
        let drained: Vec<_> = self.pending.lock().await.drain().collect();
        for (_, tx) in drained {
            let _ = tx.send(Err("Sidecar shut down".to_string()));
        }

        tracing::info!("Sidecar shut down");
        Ok(())
    }

    pub async fn is_running(&self) -> bool {
        self.child.lock().await.is_some()
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
    drop(last_time);

    if count >= MAX_RESTARTS as u64 {
        tracing::error!(
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
    tracing::info!(
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
            tracing::info!("Shutdown requested during restart backoff");
            false
        }
    }
}

/// Tray update summary derived from an event. Extracted for testability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayUpdate {
    pub connected: bool,
    pub agent_count: u32,
}

/// Pure function: update agent_count atomic based on event, return the
/// tray update to apply. Separating this from the I/O makes it unit-testable.
fn compute_tray_update(
    event_name: &str,
    data: &Value,
    agent_count: &Arc<AtomicU64>,
) -> Option<TrayUpdate> {
    match event_name {
        "connectionStatus" => {
            let connected = data
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !connected {
                agent_count.store(0, Ordering::SeqCst);
            }
            Some(TrayUpdate {
                connected,
                agent_count: agent_count.load(Ordering::SeqCst) as u32,
            })
        }
        "agentStarted" | "agent_created" => {
            let count = agent_count.fetch_add(1, Ordering::SeqCst) + 1;
            Some(TrayUpdate {
                connected: true,
                agent_count: count as u32,
            })
        }
        "agentStopped" | "agent_closed" => {
            let prev = agent_count.load(Ordering::SeqCst);
            let count = if prev > 0 { prev - 1 } else { 0 };
            agent_count.store(count, Ordering::SeqCst);
            Some(TrayUpdate {
                connected: true,
                agent_count: count as u32,
            })
        }
        "connected" => Some(TrayUpdate {
            connected: true,
            agent_count: agent_count.load(Ordering::SeqCst) as u32,
        }),
        "disconnected" => {
            agent_count.store(0, Ordering::SeqCst);
            Some(TrayUpdate {
                connected: false,
                agent_count: 0,
            })
        }
        _ => None,
    }
}

/// Handle tray-relevant events from the sidecar.
fn handle_tray_event(
    app: &AppHandle,
    event_name: &str,
    data: &Value,
    agent_count: &Arc<AtomicU64>,
) {
    if let Some(update) = compute_tray_update(event_name, data, agent_count) {
        tray::update_tray_status(app, update.connected, update.agent_count);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn new_count(n: u64) -> Arc<AtomicU64> {
        Arc::new(AtomicU64::new(n))
    }

    #[test]
    fn connection_status_true_keeps_agent_count() {
        let c = new_count(3);
        let u = compute_tray_update("connectionStatus", &json!({"connected": true}), &c)
            .expect("should emit update");
        assert_eq!(u, TrayUpdate { connected: true, agent_count: 3 });
        assert_eq!(c.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn connection_status_false_resets_agent_count() {
        let c = new_count(3);
        let u = compute_tray_update("connectionStatus", &json!({"connected": false}), &c)
            .expect("should emit update");
        assert_eq!(u, TrayUpdate { connected: false, agent_count: 0 });
        assert_eq!(c.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn connection_status_missing_connected_defaults_false() {
        let c = new_count(2);
        let u = compute_tray_update("connectionStatus", &json!({}), &c).unwrap();
        assert_eq!(u.connected, false);
        assert_eq!(u.agent_count, 0);
    }

    #[test]
    fn agent_started_increments_both_aliases() {
        let c = new_count(0);
        let u1 = compute_tray_update("agentStarted", &json!(null), &c).unwrap();
        assert_eq!(u1, TrayUpdate { connected: true, agent_count: 1 });
        let u2 = compute_tray_update("agent_created", &json!(null), &c).unwrap();
        assert_eq!(u2, TrayUpdate { connected: true, agent_count: 2 });
    }

    #[test]
    fn agent_stopped_does_not_underflow() {
        let c = new_count(0);
        let u = compute_tray_update("agentStopped", &json!(null), &c).unwrap();
        assert_eq!(u.agent_count, 0);
        assert_eq!(c.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn agent_stopped_decrements_normally() {
        let c = new_count(5);
        let u = compute_tray_update("agent_closed", &json!(null), &c).unwrap();
        assert_eq!(u.agent_count, 4);
    }

    #[test]
    fn connected_event_reads_but_does_not_reset_count() {
        let c = new_count(7);
        let u = compute_tray_update("connected", &json!(null), &c).unwrap();
        assert_eq!(u, TrayUpdate { connected: true, agent_count: 7 });
    }

    #[test]
    fn disconnected_event_resets_count() {
        let c = new_count(7);
        let u = compute_tray_update("disconnected", &json!(null), &c).unwrap();
        assert_eq!(u, TrayUpdate { connected: false, agent_count: 0 });
        assert_eq!(c.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn unknown_event_returns_none() {
        let c = new_count(3);
        assert!(compute_tray_update("someRandomEvent", &json!(null), &c).is_none());
        // 未知事件不動計數
        assert_eq!(c.load(Ordering::SeqCst), 3);
    }
}
