/**
 * # IPC 協定型別（Sidecar 側對應 Rust `src-tauri/src/ipc.rs`）
 *
 * 兩側 schema **必須保持同步**；新增欄位請同時更新對應 Rust struct。
 * 測試 `tests/sidecar-ipc.test.ts` 會實際 spawn sidecar 驗證 NDJSON 協定。
 */


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
