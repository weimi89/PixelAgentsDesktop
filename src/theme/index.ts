/**
 * # Theme — Catppuccin Mocha (dark) / Latte (light)
 *
 * 三模式：
 * - `dark`：強制深色
 * - `light`：強制淺色
 * - `system`：跟隨作業系統 `prefers-color-scheme`
 *
 * `mode` 是使用者偏好，`resolved` 是 `system` 解析後的實際值。UI 綁
 * `useThemeColors()` 拿當前色票，theme 切換會即時重渲染。
 *
 * ## 新增色票步驟
 *
 * 1. 在 [[ThemeColors]] interface 加新欄位
 * 2. 在 [[DARK_THEME]] 與 [[LIGHT_THEME]] 填入對應值
 * 3. 若需供 CSS 使用，在 [[ThemeApplier]] 內 `setProperty` 寫入
 *    `--pixel-*` custom property
 */

import { create } from "zustand";

/** 使用者可選的主題模式。`system` 會依 `prefers-color-scheme` 動態解析。 */
export type ThemeMode = "dark" | "light" | "system";

export interface ThemeColors {
  bg: string;
  bgSurface: string;
  bgElevated: string;
  border: string;
  borderLight: string;
  text: string;
  textDim: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** 強調色透明疊加（例如 selection / hover 高亮），0.2 alpha */
  accentAlpha: string;
  /** Tag / badge 預設前景色 */
  tagText: string;
  /** 次要互動元件背景（select / 次按鈕） */
  controlBg: string;
  /** 終端機背景（通常比 bg 深一點） */
  terminalBg: string;
}

export const DARK_THEME: ThemeColors = {
  bg: "#1e1e2e",
  bgSurface: "#181825",
  bgElevated: "#313244",
  border: "#45475a",
  borderLight: "#585b70",
  text: "#cdd6f4",
  textDim: "#a6adc8",
  textMuted: "#6c7086",
  accent: "#89b4fa",
  accentHover: "#b4d0fb",
  success: "#a6e3a1",
  warning: "#f9e2af",
  error: "#f38ba8",
  info: "#89dceb",
  accentAlpha: "rgba(137, 180, 250, 0.2)",
  tagText: "#cdd6f4",
  controlBg: "#45475a",
  terminalBg: "#1e1e2e",
};

export const LIGHT_THEME: ThemeColors = {
  bg: "#eff1f5",
  bgSurface: "#e6e9ef",
  bgElevated: "#dce0e8",
  border: "#bcc0cc",
  borderLight: "#acb0be",
  text: "#4c4f69",
  textDim: "#5c5f77",
  textMuted: "#6c6f85",
  accent: "#1e66f5",
  accentHover: "#5a82f6",
  success: "#40a02b",
  warning: "#df8e1d",
  error: "#d20f39",
  info: "#04a5e5",
  accentAlpha: "rgba(30, 102, 245, 0.15)",
  tagText: "#4c4f69",
  controlBg: "#ccd0da",
  terminalBg: "#e6e9ef",
};

interface ThemeState {
  mode: ThemeMode;
  /** 實際被 apply 的 theme（system 會被解析為 dark 或 light） */
  resolved: "dark" | "light";
  setMode: (mode: ThemeMode) => void;
  _setResolved: (r: "dark" | "light") => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: "system",
  resolved: "dark",
  setMode: (mode) => set({ mode }),
  _setResolved: (resolved) => set({ resolved }),
}));

/** 以當前 resolved 主題取得對應色票。 */
export function useThemeColors(): ThemeColors {
  const resolved = useThemeStore((s) => s.resolved);
  return resolved === "light" ? LIGHT_THEME : DARK_THEME;
}
