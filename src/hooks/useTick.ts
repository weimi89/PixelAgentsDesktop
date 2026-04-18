import { useSyncExternalStore } from "react";

// 全域共用的每秒 tick — 所有需要「相對時間」顯示的元件訂閱同一個 interval，
// 取代每個 AgentCard / ToolBadge 各自建立 setInterval 的模式，
// 避免 50 個 agent 時 50+ 個 timer 同時執行。

let tick = 0;
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function startIfNeeded(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    tick++;
    for (const fn of listeners) fn();
  }, 1000);
}

function stopIfIdle(): void {
  if (intervalId !== null && listeners.size === 0) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  startIfNeeded();
  return () => {
    listeners.delete(onChange);
    stopIfIdle();
  };
}

function getSnapshot(): number {
  return tick;
}

/** 訂閱全域 1 秒 tick，返回會隨時間遞增的數字。 */
export function useTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
