// Runtime payload validators for sidecar events.
//
// Tauri 的 IPC 將 JSON 傳過來時 TS 型別是 `unknown`；過去程式碼用 `as {...}`
// 強制轉型，任何格式錯誤都會 silent crash。改用純函式 type guard，
// 讓 handler 在 payload 不合法時能優雅 skip 並記錄 warning。

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface SessionPayload {
  sessionId: string;
}

export function isSessionPayload(p: unknown): p is SessionPayload {
  return isObject(p) && isString(p.sessionId);
}

export interface AgentStartedPayload extends SessionPayload {
  projectName: string;
}

export function isAgentStartedPayload(p: unknown): p is AgentStartedPayload {
  return isSessionPayload(p) && isString((p as unknown as Record<string, unknown>).projectName);
}

export interface ToolStartPayload extends SessionPayload {
  toolId?: string;
  toolName: string;
  toolStatus?: string;
}

export function isToolStartPayload(p: unknown): p is ToolStartPayload {
  if (!isSessionPayload(p)) return false;
  const r = p as unknown as Record<string, unknown>;
  return isString(r.toolName);
}

export interface ToolDonePayload extends SessionPayload {
  toolId?: string;
  toolName?: string;
}

export function isToolDonePayload(p: unknown): p is ToolDonePayload {
  return isSessionPayload(p);
}

export interface AgentStatusPayload extends SessionPayload {
  status: "active" | "idle";
}

export function isAgentStatusPayload(p: unknown): p is AgentStatusPayload {
  if (!isSessionPayload(p)) return false;
  const r = p as unknown as Record<string, unknown>;
  return r.status === "active" || r.status === "idle";
}

export interface ConnectionStatusPayload {
  connected: boolean;
  status?: string;
  reason?: string;
}

export function isConnectionStatusPayload(p: unknown): p is ConnectionStatusPayload {
  return isObject(p) && typeof p.connected === "boolean";
}

export interface TranscriptPayload {
  sessionId?: string;
  summary?: string;
  message?: string;
  role?: string;
}

export function isTranscriptPayload(p: unknown): p is TranscriptPayload {
  return isObject(p);
}

export interface LatencyPayload {
  ms: number;
}

export function isLatencyPayload(p: unknown): p is LatencyPayload {
  return isObject(p) && isNumber(p.ms);
}

export interface ErrorPayload {
  message: string;
}

export function isErrorPayload(p: unknown): p is ErrorPayload {
  return isObject(p) && isString(p.message);
}

export interface TerminalExitPayload extends SessionPayload {
  code?: number;
}

export function isTerminalExitPayload(p: unknown): p is TerminalExitPayload {
  return isSessionPayload(p);
}
