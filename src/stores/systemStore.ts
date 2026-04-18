import { create } from "zustand";

export type SystemNoticeLevel = "info" | "warn" | "error";

export interface SystemNotice {
  id: number;
  level: SystemNoticeLevel;
  message: string;
  /** 是否為嚴重/無法自動復原的狀態，UI 應顯示更醒目 */
  fatal?: boolean;
  timestamp: number;
}

interface SystemState {
  notice: SystemNotice | null;
  sidecarVersion: string | null;

  setNotice: (notice: Omit<SystemNotice, "id" | "timestamp"> | null) => void;
  clearNotice: () => void;
  setSidecarVersion: (version: string | null) => void;
}

let nextId = 1;

export const useSystemStore = create<SystemState>((set) => ({
  notice: null,
  sidecarVersion: null,

  setNotice: (notice) => {
    if (notice === null) {
      set({ notice: null });
      return;
    }
    set({
      notice: { id: nextId++, timestamp: Date.now(), ...notice },
    });
  },

  clearNotice: () => set({ notice: null }),

  setSidecarVersion: (version) => set({ sidecarVersion: version }),
}));
