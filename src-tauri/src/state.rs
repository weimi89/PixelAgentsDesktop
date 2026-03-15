use tokio::sync::Mutex;

use crate::sidecar::SidecarManager;

/// Application state shared across Tauri commands.
pub struct AppState {
    pub sidecar: Mutex<SidecarManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sidecar: Mutex::new(SidecarManager::new()),
        }
    }
}
