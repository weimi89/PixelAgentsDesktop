import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface DesktopSettings {
  scanIntervalMs: number;
  excludedProjects: string[];
  autoStart: boolean;
  startMinimized: boolean;
}

const DEFAULT_SETTINGS: DesktopSettings = {
  scanIntervalMs: 1000,
  excludedProjects: [],
  autoStart: false,
  startMinimized: false,
};

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
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
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

  loadSettings: async () => {
    try {
      const raw = await invoke<DesktopSettings | null>("load_settings");
      if (raw) {
        set({
          scanIntervalMs: raw.scanIntervalMs ?? DEFAULT_SETTINGS.scanIntervalMs,
          excludedProjects: raw.excludedProjects ?? DEFAULT_SETTINGS.excludedProjects,
          autoStart: raw.autoStart ?? DEFAULT_SETTINGS.autoStart,
          startMinimized: raw.startMinimized ?? DEFAULT_SETTINGS.startMinimized,
          loaded: true,
        });
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
}));

function snapshotFromState(state: SettingsState): DesktopSettings {
  return {
    scanIntervalMs: state.scanIntervalMs,
    excludedProjects: state.excludedProjects,
    autoStart: state.autoStart,
    startMinimized: state.startMinimized,
  };
}

async function persistSettings(settings: DesktopSettings): Promise<void> {
  try {
    await invoke("save_settings", { settings });
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}
