/**
 * # System store
 *
 * 全域系統狀態：頂部 [[NoticeBanner]] 的當前通知、sidecar 協定版本。
 *
 * - `notice` 由 [[App.tsx]] 在收到 sidecar-crash / ready version mismatch
 *   等事件時寫入；非 fatal 的 8 秒後自動消失。
 * - `sidecarVersion` 由 sidecar 的 `ready` 事件填入，顯示於 [[StatusBar]]
 *   末尾供故障排查使用。
 */

import { create } from "zustand";

/** 通知等級，決定 [[NoticeBanner]] 顏色與 ARIA role (alert vs status)。 */
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
