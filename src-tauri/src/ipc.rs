use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// NDJSON IPC protocol types
//
// Communication with the Node.js sidecar uses newline-delimited JSON over
// stdin (requests) and stdout (responses / events).
// ---------------------------------------------------------------------------

/// A request sent from Rust to the Node.js sidecar via stdin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    /// Unique request identifier (monotonically increasing).
    pub id: u64,
    /// Method name, e.g. "connect", "disconnect", "getStatus".
    pub method: String,
    /// Optional JSON parameters for the method.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// A response received from the sidecar, correlated by `id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    /// Matches the request `id`.
    pub id: u64,
    /// Successful result payload (mutually exclusive with `error`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// Error message if the request failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// An unsolicited event pushed from the sidecar (no `id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcEvent {
    /// Event name, e.g. "agentCreated", "agentClosed", "statusUpdate".
    pub event: String,
    /// Arbitrary event payload.
    pub data: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Helper functions (placeholders — will be implemented with actual sidecar I/O)
// ---------------------------------------------------------------------------

/// Serialize an `IpcRequest` to a single NDJSON line (with trailing newline).
pub fn encode_request(req: &IpcRequest) -> Result<String, serde_json::Error> {
    let mut line = serde_json::to_string(req)?;
    line.push('\n');
    Ok(line)
}

/// Try to parse a single line from stdout as either a response or an event.
pub fn decode_line(line: &str) -> Result<IpcMessage, serde_json::Error> {
    // If the JSON contains an "id" field it is a response; otherwise an event.
    let value: serde_json::Value = serde_json::from_str(line)?;
    if value.get("id").is_some() {
        let resp: IpcResponse = serde_json::from_value(value)?;
        Ok(IpcMessage::Response(resp))
    } else {
        let evt: IpcEvent = serde_json::from_value(value)?;
        Ok(IpcMessage::Event(evt))
    }
}

/// Discriminated union for decoded stdout messages.
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
