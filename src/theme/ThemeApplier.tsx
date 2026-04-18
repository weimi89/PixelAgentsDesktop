import { useEffect } from "react";
import { useThemeStore, DARK_THEME, LIGHT_THEME, type ThemeColors } from "./index";

/**
 * 應用當前主題到 <html>：
 *  - 設定 data-theme 屬性供 CSS 的 [data-theme="light"] 選擇器使用
 *  - 把色票寫入 CSS custom properties 供 styles.css 與將來遷移的元件使用
 *  - mode === "system" 時監聽 prefers-color-scheme 變化並同步 resolved
 */
export function ThemeApplier() {
  const mode = useThemeStore((s) => s.mode);
  const setResolved = useThemeStore((s) => s._setResolved);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");

    const resolve = (): "dark" | "light" => {
      if (mode === "dark") return "dark";
      if (mode === "light") return "light";
      return media.matches ? "light" : "dark";
    };

    const apply = () => {
      const resolved = resolve();
      const colors: ThemeColors = resolved === "light" ? LIGHT_THEME : DARK_THEME;
      const root = document.documentElement;
      root.setAttribute("data-theme", resolved);
      root.style.setProperty("--pixel-bg", colors.bg);
      root.style.setProperty("--pixel-bg-surface", colors.bgSurface);
      root.style.setProperty("--pixel-bg-elevated", colors.bgElevated);
      root.style.setProperty("--pixel-border", colors.border);
      root.style.setProperty("--pixel-border-light", colors.borderLight);
      root.style.setProperty("--pixel-text", colors.text);
      root.style.setProperty("--pixel-text-dim", colors.textDim);
      root.style.setProperty("--pixel-text-muted", colors.textMuted);
      root.style.setProperty("--pixel-accent", colors.accent);
      root.style.setProperty("--pixel-accent-hover", colors.accentHover);
      root.style.setProperty("--pixel-success", colors.success);
      root.style.setProperty("--pixel-warning", colors.warning);
      root.style.setProperty("--pixel-error", colors.error);
      root.style.setProperty("--pixel-info", colors.info);
      setResolved(resolved);
    };

    apply();
    if (mode === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    return undefined;
  }, [mode, setResolved]);

  return null;
}
