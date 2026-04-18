//! # OS keychain 抽象層
//!
//! 將認證 token 從純檔案（即使 0600 權限）遷移至作業系統內建的 secret
//! 儲存服務，降低備份/誤傳檔案/跨帳號讀取時的洩漏風險。
//!
//! ## 平台對應
//!
//! | OS      | 實作                                     |
//! |---------|------------------------------------------|
//! | macOS   | Keychain（Security framework）           |
//! | Windows | Credential Manager（wincred API）        |
//! | Linux   | Secret Service（D-Bus，需 gnome-keyring / KWallet 等 daemon） |
//!
//! 以 [`keyring`] crate 統一介面，由 Cargo features 啟用 `apple-native` /
//! `windows-native` / `sync-secret-service` 使用各平台原生 API（非 mock）。
//!
//! ## Fallback 策略
//!
//! 若 keychain 無法使用（例如 Linux 伺服器模式沒有 gnome-keyring daemon）：
//! - [`store_token`] 回傳 `Ok(false)`，呼叫端 [`crate::commands::save_config_to_file`]
//!   回退到檔案儲存（0600 權限）。
//! - [`load_token`] 回傳 `None`，呼叫端再嘗試從檔案讀取舊版 token 欄位。
//!
//! 如此可確保應用在各環境都能啟動，且升級路徑平滑。

use keyring::Entry;

/// Keychain 服務名稱。macOS 上顯示為「Pixel Agents Desktop」對應項目。
const SERVICE: &str = "com.pixel-agents.desktop";

/// Keychain 帳號名稱。目前單帳號設計；若未來支援多 profile 可改用
/// profile 名稱作為 account。
const ACCOUNT: &str = "default";

/// 建立 [`keyring::Entry`] 實例；失敗時回傳錯誤訊息供上層 log。
fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keyring init failed: {e}"))
}

/// 儲存 token 至 keychain。回傳 Ok(true) 代表成功儲存於 keychain，
/// Ok(false) 代表 keychain 不可用（呼叫端應回退到檔案）。
pub fn store_token(token: &str) -> Result<bool, String> {
    match entry() {
        Ok(e) => match e.set_password(token) {
            Ok(()) => Ok(true),
            Err(err) => {
                tracing::warn!("keychain store failed, will fall back to file: {err}");
                Ok(false)
            }
        },
        Err(err) => {
            tracing::warn!("keychain unavailable, will fall back to file: {err}");
            Ok(false)
        }
    }
}

/// 讀取 token。回傳 None 代表 keychain 中無紀錄或不可用。
pub fn load_token() -> Option<String> {
    let e = entry().ok()?;
    match e.get_password() {
        Ok(s) => Some(s),
        Err(keyring::Error::NoEntry) => None,
        Err(err) => {
            tracing::warn!("keychain read failed: {err}");
            None
        }
    }
}

/// 刪除 token。對不存在不報錯。
pub fn delete_token() -> Result<(), String> {
    let e = match entry() {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    match e.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("keychain delete failed: {err}")),
    }
}
