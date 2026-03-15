import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// --- Invoke wrappers (typed) ---

export interface StatusResponse {
  sidecar_running: boolean;
  connected: boolean;
  agent_count: number;
  uptime_secs: number;
}

export async function getStatus(): Promise<StatusResponse> {
  return invoke<StatusResponse>("get_status");
}

export async function connect(
  serverUrl: string,
  token: string,
): Promise<void> {
  return invoke("connect", { serverUrl, token });
}

export async function disconnect(): Promise<void> {
  return invoke("disconnect");
}

export async function loginServer(
  serverUrl: string,
  username: string,
  password: string,
): Promise<string> {
  return invoke<string>("login_server", { serverUrl, username, password });
}

export interface AppConfig {
  server_url?: string;
  token?: string;
}

export async function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

// --- Terminal invoke wrappers ---

export async function terminalAttach(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_attach", { sessionId, cols, rows });
}

export async function terminalInput(
  sessionId: string,
  data: string,
): Promise<void> {
  return invoke("terminal_input", { sessionId, data });
}

export async function terminalResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_resize", { sessionId, cols, rows });
}

export async function terminalDetach(sessionId: string): Promise<void> {
  return invoke("terminal_detach", { sessionId });
}

// --- Settings invoke wrappers ---

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
  return invoke("save_settings", { settings });
}

export async function updateScanInterval(intervalMs: number): Promise<void> {
  return invoke("update_scan_interval", { intervalMs });
}

export async function updateExcludedProjects(projects: string[]): Promise<void> {
  return invoke("update_excluded_projects", { projects });
}

export async function logout(): Promise<void> {
  return invoke("logout");
}

// --- Event listeners ---

export type SidecarEventKind =
  | "connected"
  | "disconnected"
  | "agent_created"
  | "agent_closed"
  | "agent_tool_start"
  | "agent_tool_done"
  | "agent_status"
  | "latency"
  | "error"
  // Aliases for server-side naming conventions
  | "agentStarted"
  | "agentStopped"
  | "toolStart"
  | "toolDone"
  | "connectionStatus"
  | "transcript"
  // Terminal events
  | "terminalData"
  | "terminalReady"
  | "terminalExit";

export interface SidecarEvent {
  kind: SidecarEventKind;
  payload: unknown;
  // Raw fields from Rust IpcEvent (event/data)
  event?: string;
  data?: unknown;
}

export async function onSidecarEvent(
  callback: (event: SidecarEvent) => void,
): Promise<UnlistenFn> {
  return listen<SidecarEvent>("sidecar-event", (event) => {
    callback(event.payload);
  });
}

export async function onConnectionChange(
  callback: (connected: boolean) => void,
): Promise<UnlistenFn> {
  return listen<boolean>("connection-change", (event) => {
    callback(event.payload);
  });
}

/**
 * Set up all event listeners. Returns a cleanup function.
 */
export async function setupEventListeners(handlers: {
  onSidecar?: (event: SidecarEvent) => void;
  onConnection?: (connected: boolean) => void;
}): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];

  if (handlers.onSidecar) {
    unlisteners.push(await onSidecarEvent(handlers.onSidecar));
  }
  if (handlers.onConnection) {
    unlisteners.push(await onConnectionChange(handlers.onConnection));
  }

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
