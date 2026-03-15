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
