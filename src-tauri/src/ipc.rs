//! # NDJSON IPC 協定型別
//!
//! Rust 主程序與 Node.js sidecar 透過 stdin / stdout 交換訊息。每一行是
//! 一個 JSON 物件（newline-delimited JSON），三種型別以**有無 `id` 欄位**
//! 區分：
//!
//! | 方向            | 型別          | 判別            |
//! |-----------------|---------------|-----------------|
//! | Rust → Sidecar  | `IpcRequest`  | 有 `id+method`  |
//! | Sidecar → Rust  | `IpcResponse` | 有 `id` 無 `method` |
//! | Sidecar → Rust  | `IpcEvent`    | 無 `id` 有 `event`  |
//!
//! ## 序列化規則
//!
//! - `id`：`u64` 單調遞增，由 `SidecarManager.next_id` 產生；重啟 sidecar
//!   不重置，避免跨 restart 的舊 response 誤配對。
//! - `params` / `result` / `error` 缺省時不序列化（`skip_serializing_if`），
//!   以縮短 NDJSON 行並節省 IPC buffer。
//! - 序列化失敗目前視為 bug 而非 runtime 錯誤 — 所有欄位型別均已受 TS 端
//!   ipcProtocol.ts 鏡射，若打破 schema 會在兩端都編譯失敗。

use serde::{Deserialize, Serialize};

/// 從 Rust 發往 sidecar 的請求訊息。
///
/// 每個請求必須帶唯一的 [`id`](Self::id)，sidecar 回應時以同 `id` 填入
/// [`IpcResponse`] 供 Rust 端配對 pending map 中的 oneshot sender。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    /// 單調遞增的請求識別碼。
    pub id: u64,
    /// 方法名稱，對應 sidecar `main.ts` 的 `switch (method)`，例如
    /// `"connect"`、`"disconnect"`、`"getStatus"`、`"terminalAttach"`。
    pub method: String,
    /// JSON 參數；可省略（sidecar 視方法而定接收或忽略）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// Sidecar 對某個 [`IpcRequest`] 的回應，以 `id` 配對。
///
/// `result` 與 `error` 二擇一；兩者皆缺席時視為 `null` 結果（由呼叫端
/// 負責解讀是否合理）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    /// 對應原 [`IpcRequest::id`]。
    pub id: u64,
    /// 成功時的結果 JSON。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// 失敗訊息。前端 UI 應直接向使用者呈現或轉為 log。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Sidecar 主動推送的事件，**無** `id`。
///
/// 常見 event 值見 sidecar `bridge.ts::handleAgentEvent`：
/// `agentStarted` / `agentStopped` / `toolStart` / `toolDone` /
/// `connectionStatus` / `terminalData` / `ready` / `log` 等。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcEvent {
    /// 事件類型字串。見 `src/tauri-api.ts::SidecarEventKind` 的完整列表。
    pub event: String,
    /// 事件 payload（任意 JSON）。
    pub data: serde_json::Value,
}

/// 將 [`IpcRequest`] 序列化為單行 NDJSON（含結尾 `\n`）。
///
/// 失敗時回傳 `serde_json::Error`；呼叫端 ([`crate::sidecar::SidecarManager::request`])
/// 視為應用層錯誤並回傳給前端。
pub fn encode_request(req: &IpcRequest) -> Result<String, serde_json::Error> {
    let mut line = serde_json::to_string(req)?;
    line.push('\n');
    Ok(line)
}

/// 解析 sidecar stdout 的單行 JSON 為 [`IpcMessage`]。
///
/// **判別規則**：若 JSON 物件含 `"id"` 欄位視為 [`IpcResponse`]，否則為
/// [`IpcEvent`]。這是與 sidecar `main.ts::send` 的對稱約定。
pub fn decode_line(line: &str) -> Result<IpcMessage, serde_json::Error> {
    let value: serde_json::Value = serde_json::from_str(line)?;
    if value.get("id").is_some() {
        let resp: IpcResponse = serde_json::from_value(value)?;
        Ok(IpcMessage::Response(resp))
    } else {
        let evt: IpcEvent = serde_json::from_value(value)?;
        Ok(IpcMessage::Event(evt))
    }
}

/// [`decode_line`] 的 discriminated union 回傳值。
#[derive(Debug, Clone)]
pub enum IpcMessage {
    Response(IpcResponse),
    Event(IpcEvent),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn encode_request_appends_newline() {
        let req = IpcRequest {
            id: 42,
            method: "getStatus".into(),
            params: None,
        };
        let encoded = encode_request(&req).unwrap();
        assert!(encoded.ends_with('\n'));
        assert!(encoded.contains("\"id\":42"));
        assert!(encoded.contains("\"method\":\"getStatus\""));
        // None 的 params 不會被序列化
        assert!(!encoded.contains("\"params\""));
    }

    #[test]
    fn encode_request_includes_params_when_present() {
        let req = IpcRequest {
            id: 1,
            method: "connect".into(),
            params: Some(json!({ "serverUrl": "https://x", "token": "t" })),
        };
        let encoded = encode_request(&req).unwrap();
        assert!(encoded.contains("\"serverUrl\":\"https://x\""));
    }

    #[test]
    fn decode_line_distinguishes_response_from_event_by_id_field() {
        let resp_line = r#"{"id":7,"result":{"ok":true}}"#;
        match decode_line(resp_line).unwrap() {
            IpcMessage::Response(r) => {
                assert_eq!(r.id, 7);
                assert!(r.error.is_none());
                assert_eq!(r.result.unwrap(), json!({"ok": true}));
            }
            _ => panic!("expected response"),
        }

        let event_line = r#"{"event":"agentStarted","data":{"sessionId":"s1"}}"#;
        match decode_line(event_line).unwrap() {
            IpcMessage::Event(e) => {
                assert_eq!(e.event, "agentStarted");
                assert_eq!(e.data, json!({"sessionId": "s1"}));
            }
            _ => panic!("expected event"),
        }
    }

    #[test]
    fn decode_line_response_with_error_field() {
        let line = r#"{"id":3,"error":"boom"}"#;
        match decode_line(line).unwrap() {
            IpcMessage::Response(r) => {
                assert_eq!(r.id, 3);
                assert_eq!(r.error.as_deref(), Some("boom"));
            }
            _ => panic!("expected response"),
        }
    }

    #[test]
    fn decode_line_rejects_malformed_json() {
        assert!(decode_line("not-json").is_err());
        assert!(decode_line("{incomplete").is_err());
    }
}
