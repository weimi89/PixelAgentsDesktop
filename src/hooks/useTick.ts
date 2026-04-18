/**
 * # useTick — 全域共用 1 秒 tick
 *
 * 當多個元件都需要「N 秒前 / N 分鐘前」這類相對時間顯示，每個各自建立
 * `setInterval` 會讓 50 個 AgentCard + 每個 ToolBadge 產生 50+ 個 timer
 * 同時燒 CPU。本 hook 用 `useSyncExternalStore` 將訂閱統一到單一 interval。
 *
 * ## 自動管理
 *
 * - 第一個訂閱者觸發 `startIfNeeded()` 建立 interval
 * - 最後一個訂閱者卸載時 `stopIfIdle()` 清除 interval
 * - 不訂閱時零背景工作
 *
 * ## 用法
 * ```tsx
 * function Badge({ startedAt }) {
 *   useTick();                        // 不需要用返回值，只是強制每秒重渲染
 *   return <span>{formatElapsed(startedAt)}</span>;
 * }
 * ```
 */

import { useSyncExternalStore } from "react";

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
