/**
 * # tauri-api — 前端與 Rust 後端的唯一橋樑
 *
 * 所有 `invoke()` / `listen()` 呼叫都集中在這裡包裝為 typed helper；
 * 其他元件不應直接 `import { invoke } from "@tauri-apps/api/core"`。
 *
 * ## 為什麼集中
 *
 * 1. **型別安全**：每個 command 有對應的參數 / 返回型別 interface
 * 2. **命令名核對**：Rust `#[tauri::command] fn foo_bar` 對應 `invoke("foo_bar")`，
 *    若某處拼錯成 `invoke("fooBar")` 會 runtime 失敗（過去真實 bug）
 * 3. **mock 友善**：vitest 只需 mock `@tauri-apps/api/core` 一次即可測所有元件
 *
 * ## 事件與命令對照
 *
 * - **命令名稱**：見 `src-tauri/src/commands.rs` 模組註解的對照表
 * - **事件名稱**：[[SidecarEventKind]] 列出所有 sidecar 會發的 event 值
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// --- Status ---
//
// Rust `get_status` returns either:
//   { sidecarStatus: "stopped", connected, agentCount, latency }   — when sidecar is down
//   sidecar's getStatus response:  { sidecarVersion, connected, agents: [...] }
// The shape depends on whether the sidecar is running, so we type loosely.

export interface StatusResponse {
  connected: boolean;
  agentCount?: number;
  sidecarStatus?: string;
  sidecarVersion?: string;
  agents?: Array<{ sessionId: string; projectName: string }>;
  latency?: number;
}

export async function getStatus(): Promise<StatusResponse> {
  return invoke<StatusResponse>("get_status");
}

// --- Connection ---

export async function connect(
  serverUrl: string,
  token: string,
): Promise<void> {
  await invoke("connect_server", { serverUrl, token });
}

export async function disconnect(): Promise<void> {
  await invoke("disconnect_server");
}

// --- Login ---

export interface LoginResponse {
  ok: boolean;
  token: string;
  username: string;
}

export async function loginServer(
  serverUrl: string,
  username: string,
  password: string,
): Promise<LoginResponse> {
  return invoke<LoginResponse>("login_server", { serverUrl, username, password });
}

export async function loginWithKey(
  serverUrl: string,
  apiKey: string,
): Promise<LoginResponse> {
  return invoke<LoginResponse>("login_with_key", { serverUrl, apiKey });
}

// --- Config ---
//
// Rust writes { server, token } — keep these exact field names to match
// config_path() in commands.rs.

export interface AppConfig {
  server?: string;
  token?: string;
}

export async function loadConfig(): Promise<AppConfig | null> {
  return invoke<AppConfig | null>("load_config");
}

export async function saveConfig(serverUrl: string, token: string): Promise<void> {
  await invoke("save_config", { serverUrl, token });
}

// --- Terminal ---

export async function terminalAttach(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("terminal_attach", { sessionId, cols, rows });
}

export async function terminalInput(
  sessionId: string,
  data: string,
): Promise<void> {
  await invoke("terminal_input", { sessionId, data });
}

export async function terminalResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("terminal_resize", { sessionId, cols, rows });
}

export async function terminalDetach(sessionId: string): Promise<void> {
  await invoke("terminal_detach", { sessionId });
}

// --- Settings ---

export interface DesktopSettings {
  scanIntervalMs: number;
  excludedProjects: string[];
  autoStart: boolean;
  startMinimized: boolean;
}

export async function loadSettings(): Promise<DesktopSettings | null> {
  return invoke<DesktopSettings | null>("load_settings");
}

export async function saveSettings(settings: DesktopSettings): Promise<void> {
  await invoke("save_settings", { settings });
}

export async function updateScanInterval(intervalMs: number): Promise<void> {
  await invoke("update_scan_interval", { intervalMs });
}

export async function updateExcludedProjects(projects: string[]): Promise<void> {
  await invoke("update_excluded_projects", { projects });
}

export async function logout(): Promise<void> {
  await invoke("logout");
}

// --- Diagnostics ---

export interface DiagnosticsSnapshot {
  uptimeSecs: number;
  ipc: {
    requestsTotal: number;
    requestErrors: number;
    eventsReceived: number;
  };
  sidecar: {
    spawns: number;
    restarts: number;
    crashes: number;
  };
  http: {
    retries: number;
  };
}

export async function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  return invoke<DiagnosticsSnapshot>("get_diagnostics");
}

/** 將錯誤持久化到 ~/.pixel-agents/crashes/ 供後續回報使用 */
export async function reportCrash(
  kind: string,
  message: string,
  details?: unknown,
): Promise<void> {
  try {
    await invoke("report_crash", { kind, message, details });
  } catch {
    // 寫入失敗絕不能遞迴 throw — 吞下以避免 ErrorBoundary 迴圈
  }
}

export interface CrashEntry {
  name: string;
  size: number;
  modifiedAt: number;
}
export interface CrashListing {
  count: number;
  path: string;
  entries: CrashEntry[];
}

export async function listCrashes(): Promise<CrashListing> {
  return invoke<CrashListing>("list_crashes");
}

export async function clearCrashes(): Promise<{ moved: number }> {
  return invoke<{ moved: number }>("clear_crashes");
}

// --- Event listeners ---
//
// SidecarEventKind lists every event `event` value that the sidecar emits
// (see bridge.ts handleAgentEvent and main.ts sendEvent calls).

export type SidecarEventKind =
  // Connection lifecycle (legacy + current)
  | "connected"
  | "disconnected"
  | "connectionStatus"
  // Agent lifecycle
  | "agent_created"
  | "agent_closed"
  | "agentStarted"
  | "agentStopped"
  // Tool lifecycle
  | "agent_tool_start"
  | "agent_tool_done"
  | "toolStart"
  | "toolDone"
  | "subtaskStart"
  | "subtaskDone"
  // Agent state
  | "agent_status"
  | "statusChange"
  | "agentThinking"
  | "agentEmote"
  | "modelDetected"
  | "turnComplete"
  | "transcript"
  // Latency / diagnostics
  | "latency"
  | "error"
  | "log"
  | "ready"
  // Terminal
  | "terminalData"
  | "terminalReady"
  | "terminalExit";

export interface SidecarEvent {
  // When the Rust side forwards IpcEvent, Tauri serialises as { event, data }.
  // `kind`/`payload` are the older field names kept for backwards-compat in
  // the handler switch.
  kind?: SidecarEventKind;
  payload?: unknown;
  event?: SidecarEventKind;
  data?: unknown;
}

export async function onSidecarEvent(
  callback: (event: SidecarEvent) => void,
): Promise<UnlistenFn> {
  return listen<SidecarEvent>("sidecar-event", (event) => {
    callback(event.payload);
  });
}

/** Rust 發出的 sidecar 崩潰 / 重啟通知事件 */
export interface SidecarCrashEvent {
  message: string;
  recovered?: boolean;
  fatal?: boolean;
  warning?: boolean;
}

export async function onSidecarCrash(
  callback: (event: SidecarCrashEvent) => void,
): Promise<UnlistenFn> {
  return listen<SidecarCrashEvent>("sidecar-crash", (event) => {
    callback(event.payload);
  });
}

/**
 * Set up event listeners. Returns a cleanup function.
 */
export async function setupEventListeners(handlers: {
  onSidecar?: (event: SidecarEvent) => void;
  onSidecarCrash?: (event: SidecarCrashEvent) => void;
}): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];

  if (handlers.onSidecar) {
    unlisteners.push(await onSidecarEvent(handlers.onSidecar));
  }
  if (handlers.onSidecarCrash) {
    unlisteners.push(await onSidecarCrash(handlers.onSidecarCrash));
  }

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
