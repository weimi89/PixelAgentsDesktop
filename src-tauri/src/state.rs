use std::sync::Arc;

use crate::sidecar::SidecarManager;

/// Application state shared across Tauri commands.
///
/// `SidecarManager` is wrapped in `Arc`, not `Mutex`, because every method on
/// `SidecarManager` takes `&self` and uses internal synchronization. Holding
/// an outer `Mutex` here would serialize all Tauri commands and defeat the
/// deadlock-avoidance design of `SidecarManager`.
pub struct AppState {
    pub sidecar: Arc<SidecarManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sidecar: Arc::new(SidecarManager::new()),
        }
    }
}
