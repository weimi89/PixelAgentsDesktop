/**
 * # Runtime payload validators
 *
 * Tauri invoke / listen 傳回的 payload TS 型別為 `unknown`；若直接用
 * `as { sessionId: string }` 強制斷言，當 sidecar 因 bug 發出異常結構
 * 時整個 handler 會 silent crash（下一行存取 `.sessionId` 得 `undefined`）。
 *
 * 本模組提供純函式 type guard，讓 handler 優雅處理：
 *
 * ```ts
 * if (!isToolStartPayload(payload)) {
 *   console.warn("invalid toolStart payload", payload);
 *   break;
 * }
 * // 此後 payload 被 narrow 為 ToolStartPayload
 * ```
 *
 * 另外提供 [[parseDesktopSettings]] 用於持久化 JSON schema 驗證。
 */

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

/** statusChange 事件 — 由 sidecar parser.ts 發出，指示 agent 在等待
 *  使用者輸入（waiting）、請求權限（permission）、或閒置（idle）。
 *  與 agent_status 不同：statusChange 是 Claude Code 主動生命週期事件，
 *  agent_status 是應用層推導的 active/idle。 */
export interface StatusChangePayload extends SessionPayload {
  status: "waiting" | "permission" | "idle";
}

export function isStatusChangePayload(p: unknown): p is StatusChangePayload {
  if (!isSessionPayload(p)) return false;
  const r = p as unknown as Record<string, unknown>;
  return r.status === "waiting" || r.status === "permission" || r.status === "idle";
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

// ---------- 設定檔 Schema ----------
//
// ~/.pixel-agents/desktop-settings.json 是使用者可手動編輯的純 JSON，
// loadSettings 讀入時以此驗證並逐欄回退到預設值；避免使用者打錯格式
// 時 Zustand store 被塞入型別錯誤值、後續 UI 當掉。

export interface DesktopSettingsShape {
  scanIntervalMs: number;
  excludedProjects: string[];
  autoStart: boolean;
  startMinimized: boolean;
  /** 遙測 / 錯誤回報的同意狀態。預設 `false`（opt-in 而非 opt-out）。
   *  目前只是預留欄位；未來接入 Sentry 等服務時，只有此欄位 true
   *  才會發送任何 telemetry。 */
  telemetryEnabled: boolean;
}

export const DESKTOP_SETTINGS_DEFAULTS: DesktopSettingsShape = {
  scanIntervalMs: 1000,
  excludedProjects: [],
  autoStart: false,
  startMinimized: false,
  telemetryEnabled: false,
};

const SCAN_INTERVAL_MIN = 500;
const SCAN_INTERVAL_MAX = 600000;

/**
 * 驗證並清理使用者提供的 settings JSON；任何欄位型別不符或超出合理範圍，
 * 回退到預設值並記錄 warning。返回結果保證符合 DesktopSettingsShape。
 */
export function parseDesktopSettings(raw: unknown): DesktopSettingsShape {
  if (!isObject(raw)) return { ...DESKTOP_SETTINGS_DEFAULTS };

  const warnings: string[] = [];
  const out: DesktopSettingsShape = { ...DESKTOP_SETTINGS_DEFAULTS };

  if (isNumber(raw.scanIntervalMs)) {
    if (raw.scanIntervalMs < SCAN_INTERVAL_MIN || raw.scanIntervalMs > SCAN_INTERVAL_MAX) {
      warnings.push(
        `scanIntervalMs ${raw.scanIntervalMs} 超出範圍 [${SCAN_INTERVAL_MIN}, ${SCAN_INTERVAL_MAX}]，使用預設值`,
      );
    } else {
      out.scanIntervalMs = raw.scanIntervalMs;
    }
  } else if (raw.scanIntervalMs !== undefined) {
    warnings.push(`scanIntervalMs 型別錯誤，需為 number`);
  }

  if (Array.isArray(raw.excludedProjects)) {
    const filtered = raw.excludedProjects.filter((x): x is string => isString(x));
    if (filtered.length !== raw.excludedProjects.length) {
      warnings.push("excludedProjects 中的非字串元素已被忽略");
    }
    out.excludedProjects = filtered;
  } else if (raw.excludedProjects !== undefined) {
    warnings.push("excludedProjects 型別錯誤，需為 string[]");
  }

  if (typeof raw.autoStart === "boolean") {
    out.autoStart = raw.autoStart;
  } else if (raw.autoStart !== undefined) {
    warnings.push("autoStart 型別錯誤，需為 boolean");
  }

  if (typeof raw.startMinimized === "boolean") {
    out.startMinimized = raw.startMinimized;
  } else if (raw.startMinimized !== undefined) {
    warnings.push("startMinimized 型別錯誤，需為 boolean");
  }

  if (typeof raw.telemetryEnabled === "boolean") {
    out.telemetryEnabled = raw.telemetryEnabled;
  } else if (raw.telemetryEnabled !== undefined) {
    warnings.push("telemetryEnabled 型別錯誤，需為 boolean");
  }

  if (warnings.length > 0) {
    console.warn("[settings] 設定檔格式問題：\n" + warnings.map((w) => "  - " + w).join("\n"));
  }

  return out;
}
