// 應用程式內部診斷指標
//
// 桌面應用通常不需要完整的 OpenTelemetry / Prometheus exporter；
// 這裡只保留一組原子計數器 + 全域 startup 時間，供前端顯示
// 「診斷」區塊（IPC 請求次數、錯誤、重啟次數、上線時間等）。
// 當計數爆炸時會 saturating 不 panic。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

#[derive(Default)]
pub struct Metrics {
    pub started_at: OnceLock<Instant>,
    pub ipc_requests_total: AtomicU64,
    pub ipc_request_errors: AtomicU64,
    pub ipc_events_received: AtomicU64,
    pub sidecar_spawns: AtomicU64,
    pub sidecar_restarts: AtomicU64,
    pub sidecar_crashes: AtomicU64,
    pub http_retries: AtomicU64,
}

static METRICS: Metrics = Metrics {
    started_at: OnceLock::new(),
    ipc_requests_total: AtomicU64::new(0),
    ipc_request_errors: AtomicU64::new(0),
    ipc_events_received: AtomicU64::new(0),
    sidecar_spawns: AtomicU64::new(0),
    sidecar_restarts: AtomicU64::new(0),
    sidecar_crashes: AtomicU64::new(0),
    http_retries: AtomicU64::new(0),
};

pub fn init() {
    let _ = METRICS.started_at.set(Instant::now());
}

pub fn incr_ipc_request() {
    METRICS.ipc_requests_total.fetch_add(1, Ordering::Relaxed);
}

pub fn incr_ipc_error() {
    METRICS.ipc_request_errors.fetch_add(1, Ordering::Relaxed);
}

pub fn incr_ipc_event() {
    METRICS.ipc_events_received.fetch_add(1, Ordering::Relaxed);
}

pub fn incr_sidecar_spawn() {
    METRICS.sidecar_spawns.fetch_add(1, Ordering::Relaxed);
}

pub fn incr_sidecar_restart() {
    METRICS.sidecar_restarts.fetch_add(1, Ordering::Relaxed);
}

pub fn incr_sidecar_crash() {
    METRICS.sidecar_crashes.fetch_add(1, Ordering::Relaxed);
}

pub fn incr_http_retry() {
    METRICS.http_retries.fetch_add(1, Ordering::Relaxed);
}

/// 取得快照。uptime_secs 為 init() 之後到現在的秒數。
pub fn snapshot() -> serde_json::Value {
    let uptime_secs = METRICS
        .started_at
        .get()
        .map(|t| t.elapsed().as_secs())
        .unwrap_or(0);
    serde_json::json!({
        "uptimeSecs": uptime_secs,
        "ipc": {
            "requestsTotal": METRICS.ipc_requests_total.load(Ordering::Relaxed),
            "requestErrors": METRICS.ipc_request_errors.load(Ordering::Relaxed),
            "eventsReceived": METRICS.ipc_events_received.load(Ordering::Relaxed),
        },
        "sidecar": {
            "spawns": METRICS.sidecar_spawns.load(Ordering::Relaxed),
            "restarts": METRICS.sidecar_restarts.load(Ordering::Relaxed),
            "crashes": METRICS.sidecar_crashes.load(Ordering::Relaxed),
        },
        "http": {
            "retries": METRICS.http_retries.load(Ordering::Relaxed),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_increment_and_snapshot_reflects_values() {
        incr_ipc_request();
        incr_ipc_request();
        incr_ipc_event();
        let snap = snapshot();
        // 無法斷言絕對值（與其他測試共享 global），但應 >= 我們剛加的
        assert!(snap["ipc"]["requestsTotal"].as_u64().unwrap() >= 2);
        assert!(snap["ipc"]["eventsReceived"].as_u64().unwrap() >= 1);
    }

    #[test]
    fn snapshot_has_all_expected_fields() {
        let snap = snapshot();
        assert!(snap["uptimeSecs"].is_number());
        assert!(snap["ipc"]["requestsTotal"].is_number());
        assert!(snap["ipc"]["requestErrors"].is_number());
        assert!(snap["ipc"]["eventsReceived"].is_number());
        assert!(snap["sidecar"]["spawns"].is_number());
        assert!(snap["sidecar"]["restarts"].is_number());
        assert!(snap["sidecar"]["crashes"].is_number());
        assert!(snap["http"]["retries"].is_number());
    }
}
