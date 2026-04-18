//! # AppState — Tauri managed state
//!
//! 此模組定義應用全域狀態，由 Tauri runtime 以 `tauri::Builder::manage()`
//! 存放並以 `State<'_, AppState>` 注入 Tauri 命令（見 [`crate::commands`]）。

use std::sync::Arc;

use crate::sidecar::SidecarManager;

/// Tauri 命令共享的全域狀態。
///
/// `sidecar` 故意 **不** 包外層 `Mutex` — [`SidecarManager`] 內部已以
/// `Arc<Mutex/Atomic>` 保護所有可變欄位，且所有方法皆為 `&self`。包外層
/// `Mutex` 會讓全部 Tauri 命令序列化執行，並重現早期版本造成 shutdown 死鎖
/// 的 lock ordering 問題。
///
/// 每個命令取得 `State<'_, AppState>` 後以 `state.sidecar.clone()` 取得
/// 自己的 `Arc<SidecarManager>`，即可並行 await 不互相阻塞。
pub struct AppState {
    /// 管理 Node.js sidecar 子程序生命週期與 IPC。
    pub sidecar: Arc<SidecarManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sidecar: Arc::new(SidecarManager::new()),
        }
    }
}
