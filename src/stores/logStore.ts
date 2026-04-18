import { create } from "zustand";
import { useMemo } from "react";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  agentSessionId?: string;
  message: string;
}

interface LogState {
  // Circular buffer：head 指向下一個寫入位置，count 為實際條數。
  // 上限 maxLogs 時 head 覆寫最舊記錄。avoid O(n) slice on every push.
  buffer: (LogEntry | undefined)[];
  head: number;
  count: number;
  maxLogs: number;
  nextId: number;

  addLog: (entry: Omit<LogEntry, "id">) => void;
  clearLogs: () => void;
}

const MAX_LOGS = 5000;

export const useLogStore = create<LogState>((set) => ({
  buffer: new Array<LogEntry | undefined>(MAX_LOGS),
  head: 0,
  count: 0,
  maxLogs: MAX_LOGS,
  nextId: 1,

  addLog: (entry) =>
    set((state) => {
      const newEntry: LogEntry = { ...entry, id: state.nextId };
      // 必須建立新 buffer 引用才能讓 selector 察覺變化；直接原地覆寫
      // 再回傳同引用，Zustand 的 Object.is 比較會誤判未變。
      const nextBuffer = state.buffer.slice();
      nextBuffer[state.head] = newEntry;
      const nextHead = (state.head + 1) % state.maxLogs;
      const nextCount = Math.min(state.count + 1, state.maxLogs);
      return {
        buffer: nextBuffer,
        head: nextHead,
        count: nextCount,
        nextId: state.nextId + 1,
      };
    }),

  clearLogs: () =>
    set((state) => ({
      buffer: new Array<LogEntry | undefined>(state.maxLogs),
      head: 0,
      count: 0,
      nextId: 1,
    })),
}));

/**
 * 將環形 buffer 視圖化為時間順序（舊→新）陣列。
 * 只在 buffer/head/count 變動時才重新建立陣列。
 */
function selectOrderedLogs(state: LogState): LogEntry[] {
  const { buffer, head, count, maxLogs } = state;
  if (count === 0) return EMPTY_LOGS;
  const result: LogEntry[] = new Array(count);
  const start = count < maxLogs ? 0 : head;
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % maxLogs;
    const entry = buffer[idx];
    if (entry) result[i] = entry;
  }
  return result;
}

const EMPTY_LOGS: LogEntry[] = [];

/** 取得目前所有 log 的有序快照（舊→新），不訂閱 store。 */
export function snapshotOrderedLogs(): LogEntry[] {
  return selectOrderedLogs(useLogStore.getState());
}

export function useOrderedLogs(): LogEntry[] {
  // 訂閱三個變動欄位；任一變動才重建有序陣列
  const buffer = useLogStore((s) => s.buffer);
  const head = useLogStore((s) => s.head);
  const count = useLogStore((s) => s.count);
  const maxLogs = useLogStore((s) => s.maxLogs);

  return useMemo(
    () => selectOrderedLogs({ buffer, head, count, maxLogs } as LogState),
    [buffer, head, count, maxLogs],
  );
}

export function useFilteredLogs(filters: {
  level?: LogLevel;
  source?: string;
  agentSessionId?: string;
}): LogEntry[] {
  const logs = useOrderedLogs();

  return useMemo(() => {
    let result = logs;

    if (filters.level) {
      result = result.filter((l) => l.level === filters.level);
    }
    if (filters.source) {
      const s = filters.source.toLowerCase();
      result = result.filter((l) => l.source.toLowerCase().includes(s));
    }
    if (filters.agentSessionId) {
      result = result.filter((l) => l.agentSessionId === filters.agentSessionId);
    }

    return result;
  }, [logs, filters.level, filters.source, filters.agentSessionId]);
}
