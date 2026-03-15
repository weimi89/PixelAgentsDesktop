// ── IPC Protocol: Rust (Tauri) ↔ Node.js (Sidecar) via NDJSON over stdin/stdout ──

/** Request from Rust → Node */
export interface IpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** Response from Node → Rust */
export interface IpcResponse {
  id: number;
  result?: unknown;
  error?: string;
}

/** Push event from Node → Rust (no id) */
export interface IpcEvent {
  event: string;
  data: unknown;
}

/** All possible methods */
export type IpcMethod =
  | 'connect'         // { serverUrl, token }
  | 'disconnect'
  | 'getStatus'
  | 'shutdown'
  | 'terminalAttach'  // { sessionId, cols, rows }
  | 'terminalInput'   // { sessionId, data }
  | 'terminalResize'  // { sessionId, cols, rows }
  | 'terminalDetach'        // { sessionId }
  | 'updateScanInterval'    // { intervalMs }
  | 'updateExcludedProjects'; // { projects }

/** Event types pushed from sidecar */
export type IpcEventType =
  | 'agentStarted'
  | 'agentStopped'
  | 'toolStart'
  | 'toolDone'
  | 'agentThinking'
  | 'agentEmote'
  | 'modelDetected'
  | 'turnComplete'
  | 'subtaskStart'
  | 'subtaskDone'
  | 'statusChange'
  | 'connectionStatus'
  | 'terminalData'
  | 'terminalReady'
  | 'terminalExit'
  | 'log'
  | 'ready'
  | 'transcript';
