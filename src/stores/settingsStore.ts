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
    // Fire-and-forget save + sidecar update
    const state = get();
    void persistSettings(state);
    void invoke("update_scan_interval", { intervalMs: ms }).catch(() => {});
  },

  addExcludedProject: (project: string) => {
    const current = get().excludedProjects;
    if (current.includes(project)) return;
    const updated = [...current, project];
    set({ excludedProjects: updated });
    const state = get();
    void persistSettings(state);
    void invoke("update_excluded_projects", { projects: updated }).catch(() => {});
  },

  removeExcludedProject: (project: string) => {
    const updated = get().excludedProjects.filter((p) => p !== project);
    set({ excludedProjects: updated });
    const state = get();
    void persistSettings(state);
    void invoke("update_excluded_projects", { projects: updated }).catch(() => {});
  },

  setAutoStart: (enabled: boolean) => {
    set({ autoStart: enabled });
    void persistSettings(get());
  },

  setStartMinimized: (enabled: boolean) => {
    set({ startMinimized: enabled });
    void persistSettings(get());
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
    await persistSettings(get());
  },
}));

async function persistSettings(state: SettingsState): Promise<void> {
  const settings: DesktopSettings = {
    scanIntervalMs: state.scanIntervalMs,
    excludedProjects: state.excludedProjects,
    autoStart: state.autoStart,
    startMinimized: state.startMinimized,
  };
  try {
    await invoke("save_settings", { settings });
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}
