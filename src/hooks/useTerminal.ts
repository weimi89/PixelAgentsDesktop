/**
 * # useTerminal — xterm.js 生命週期
 *
 * 在 [[TerminalPanel]] 使用。封裝 xterm `Terminal` 與 `FitAddon` 實例
 * 的建立、銷毀、尺寸計算。
 *
 * ## termEpoch
 *
 * 每次 instance 重建（StrictMode dispose → 重建；未來也可能用於 theme
 * 切換觸發重建）會讓 `termEpoch` 遞增。下游 effect 應把 `termEpoch`
 * 列入 deps 以便在 instance ready 後再執行 `terminal.open(container)`；
 * 否則首次 mount 時 `getTerminal()` 可能為 null（hook useEffect 尚未執行），
 * 下游 effect 跑完也不會再被觸發。
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const TERMINAL_THEME = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  selectionBackground: "#585b7066",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
};

export interface UseTerminalReturn {
  /** Get the current Terminal instance (may be null before mount) */
  getTerminal: () => Terminal | null;
  /** Get the current FitAddon instance */
  getFitAddon: () => FitAddon | null;
  /** Write data to the terminal */
  write: (data: string) => void;
  /** Clear the terminal screen */
  clear: () => void;
  /** Get current terminal dimensions */
  getDimensions: () => { cols: number; rows: number } | null;
  /** Call fit on the FitAddon */
  fit: () => void;
  /** Increments when the underlying Terminal instance is (re)created.
   * Downstream effects should depend on this to re-run after mount / Strict Mode remount. */
  termEpoch: number;
}

/**
 * Custom hook managing xterm.js lifecycle.
 * Call `initTerminal(container)` to attach xterm to a DOM element.
 * Returns stable refs that persist across renders.
 */
export function useTerminal(): UseTerminalReturn {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [termEpoch, setTermEpoch] = useState(0);

  // Create terminal once (or per StrictMode remount)
  useEffect(() => {
    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      convertEol: true,
    });
    terminal.loadAddon(fitAddon);

    termRef.current = terminal;
    fitRef.current = fitAddon;
    // Bump epoch to notify consumers that termRef.current is now valid.
    // Downstream effects that need the terminal should depend on termEpoch.
    setTermEpoch((n) => n + 1);

    return () => {
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  const getTerminal = useCallback(() => termRef.current, []);
  const getFitAddon = useCallback(() => fitRef.current, []);

  const write = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  const clear = useCallback(() => {
    termRef.current?.clear();
  }, []);

  const getDimensions = useCallback(() => {
    const term = termRef.current;
    if (!term) return null;
    return { cols: term.cols, rows: term.rows };
  }, []);

  const fit = useCallback(() => {
    try {
      fitRef.current?.fit();
    } catch {
      // container may not be visible
    }
  }, []);

  return { getTerminal, getFitAddon, write, clear, getDimensions, fit, termEpoch };
}
