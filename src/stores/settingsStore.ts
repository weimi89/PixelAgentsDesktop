/**
 * # Settings store
 *
 * 使用者偏好設定；持久化於 `~/.pixel-agents/desktop-settings.json`，
 * 由 Rust 的 `load_settings` / `save_settings` 命令讀寫。
 *
 * ## 寫入策略
 *
 * 所有變更都立刻 `set()` 到 store（UI 即時反應），但 **磁碟寫入與
 * sidecar push 有 debounce**：
 *
 * - `schedulePersist` 250ms — 檔案系統寫入
 * - `scheduleScanIntervalPush` / `scheduleExcludedPush` 300ms — IPC
 *
 * 避免滑桿拖動觸發每幀寫盤 + IPC（原本會導致視覺卡頓與磁碟 I/O 爆量）。
 *
 * ## Schema 驗證
 *
 * `loadSettings` 把 invoke 的 raw unknown 交給 [[parseDesktopSettings]]
 * 驗證型別與範圍，回退到安全預設；使用者手動編輯 JSON 打錯不會讓 UI 崩潰。
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { parseDesktopSettings, DESKTOP_SETTINGS_DEFAULTS } from "../lib/validators";

export type DesktopSettings = {
  scanIntervalMs: number;
  excludedProjects: string[];
  autoStart: boolean;
  startMinimized: boolean;
  telemetryEnabled: boolean;
};

const DEFAULT_SETTINGS: DesktopSettings = DESKTOP_SETTINGS_DEFAULTS;

/** Debounce 寫盤 / IPC — 滑桿拖動等連續操作不應觸發多次磁碟寫入。 */
const PERSIST_DEBOUNCE_MS = 250;
const SIDECAR_PUSH_DEBOUNCE_MS = 300;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let scanIntervalPushTimer: ReturnType<typeof setTimeout> | null = null;
let excludedPushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(snapshot: DesktopSettings): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistSettings(snapshot);
  }, PERSIST_DEBOUNCE_MS);
}

function scheduleScanIntervalPush(intervalMs: number): void {
  if (scanIntervalPushTimer) clearTimeout(scanIntervalPushTimer);
  scanIntervalPushTimer = setTimeout(() => {
    scanIntervalPushTimer = null;
    void invoke("update_scan_interval", { intervalMs }).catch(() => {});
  }, SIDECAR_PUSH_DEBOUNCE_MS);
}

function scheduleExcludedPush(projects: string[]): void {
  if (excludedPushTimer) clearTimeout(excludedPushTimer);
  excludedPushTimer = setTimeout(() => {
    excludedPushTimer = null;
    void invoke("update_excluded_projects", { projects }).catch(() => {});
  }, SIDECAR_PUSH_DEBOUNCE_MS);
}

interface SettingsState extends DesktopSettings {
  loaded: boolean;

  // Actions
  setScanInterval: (ms: number) => void;
  addExcludedProject: (project: string) => void;
  removeExcludedProject: (project: string) => void;
  setAutoStart: (enabled: boolean) => void;
  setStartMinimized: (enabled: boolean) => void;
  setTelemetryEnabled: (enabled: boolean) => void;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  /** 匯入完整設定：單次套用所有欄位、單次寫盤，並同步需要下推 sidecar 的
   *  欄位（掃描間隔、排除清單）。取代逐欄 setter 造成的多次 debounced 寫入。 */
  importSettings: (settings: DesktopSettings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  setScanInterval: (ms: number) => {
    set({ scanIntervalMs: ms });
    schedulePersist(snapshotFromState(get()));
    scheduleScanIntervalPush(ms);
  },

  addExcludedProject: (project: string) => {
    const current = get().excludedProjects;
    if (current.includes(project)) return;
    const updated = [...current, project];
    set({ excludedProjects: updated });
    schedulePersist(snapshotFromState(get()));
    scheduleExcludedPush(updated);
  },

  removeExcludedProject: (project: string) => {
    const updated = get().excludedProjects.filter((p) => p !== project);
    set({ excludedProjects: updated });
    schedulePersist(snapshotFromState(get()));
    scheduleExcludedPush(updated);
  },

  setAutoStart: (enabled: boolean) => {
    set({ autoStart: enabled });
    schedulePersist(snapshotFromState(get()));
  },

  setStartMinimized: (enabled: boolean) => {
    set({ startMinimized: enabled });
    schedulePersist(snapshotFromState(get()));
  },

  setTelemetryEnabled: (enabled: boolean) => {
    set({ telemetryEnabled: enabled });
    schedulePersist(snapshotFromState(get()));
  },

  loadSettings: async () => {
    try {
      const raw = await invoke<unknown>("load_settings");
      if (raw) {
        // 透過 schema 驗證 + 回退，避免使用者手動編輯 JSON 打錯
        // 型別時把錯誤值塞進 store。
        const parsed = parseDesktopSettings(raw);
        set({ ...parsed, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  saveSettings: async () => {
    await persistSettings(snapshotFromState(get()));
  },

  importSettings: async (settings: DesktopSettings) => {
    // 一次套用全部欄位（單次 set → 單次 UI 更新）
    set({ ...settings });
    // 立即完整寫盤，取代逐欄 setter 各自排一次 debounced 寫入造成的重複 I/O
    await persistSettings(settings);
    // 下推需要 sidecar 立即生效的欄位；sidecar 未執行時 invoke 會 reject，
    // 吞掉即可（與 scheduleScanIntervalPush / scheduleExcludedPush 一致）
    void invoke("update_scan_interval", { intervalMs: settings.scanIntervalMs }).catch(() => {});
    void invoke("update_excluded_projects", { projects: settings.excludedProjects }).catch(() => {});
  },
}));

function snapshotFromState(state: SettingsState): DesktopSettings {
  return {
    scanIntervalMs: state.scanIntervalMs,
    excludedProjects: state.excludedProjects,
    autoStart: state.autoStart,
    startMinimized: state.startMinimized,
    telemetryEnabled: state.telemetryEnabled,
  };
}

async function persistSettings(settings: DesktopSettings): Promise<void> {
  try {
    await invoke("save_settings", { settings });
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}
