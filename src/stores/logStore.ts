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
  logs: LogEntry[];
  maxLogs: number;
  nextId: number;

  addLog: (entry: Omit<LogEntry, "id">) => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  logs: [],
  maxLogs: 5000,
  nextId: 1,

  addLog: (entry) =>
    set((state) => {
      const newEntry: LogEntry = { ...entry, id: state.nextId };
      const next = [...state.logs, newEntry];
      // Ring buffer: trim oldest if exceeding maxLogs
      const trimmed = next.length > state.maxLogs
        ? next.slice(next.length - state.maxLogs)
        : next;
      return { logs: trimmed, nextId: state.nextId + 1 };
    }),

  clearLogs: () => set({ logs: [], nextId: 1 }),
}));

export function useFilteredLogs(filters: {
  level?: LogLevel;
  source?: string;
  agentSessionId?: string;
}): LogEntry[] {
  const logs = useLogStore((s) => s.logs);

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
