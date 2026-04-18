// OS keychain 抽象：macOS Keychain / Windows Credential Manager / Linux Secret Service
//
// 目的：把認證 token 從檔案（即使 0600）遷移到使用者 keychain，減少
// 備份、誤傳檔案或跨帳號讀取時的風險面。
//
// 如果 keychain 在當前環境不可用（例如 Linux 上 secret-service 未啟動），
// 回退到舊的檔案儲存作為 fallback 並記錄警告 — 不阻斷應用啟動。

use keyring::Entry;

const SERVICE: &str = "com.pixel-agents.desktop";
const ACCOUNT: &str = "default";

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
