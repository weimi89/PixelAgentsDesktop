import { useState, useRef, useCallback } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  useFilteredLogs,
  useLogStore,
  snapshotOrderedLogs,
  type LogLevel,
  type LogEntry,
} from "../stores/logStore";
import { useAgentStore } from "../stores/agentStore";

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: "#89b4fa",
  warn: "#fab387",
  error: "#f38ba8",
  debug: "#6c7086",
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    fontFamily: "monospace",
    fontSize: "12px",
    color: "#cdd6f4",
  },
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px",
    background: "#313244",
    borderBottom: "2px solid #45475a",
    flexWrap: "wrap" as const,
    flexShrink: 0,
  },
  select: {
    background: "#1e1e2e",
    color: "#cdd6f4",
    border: "2px solid #45475a",
    borderRadius: 0,
    padding: "4px 8px",
    fontFamily: "monospace",
    fontSize: "12px",
    cursor: "pointer",
  },
  input: {
    background: "#1e1e2e",
    color: "#cdd6f4",
    border: "2px solid #45475a",
    borderRadius: 0,
    padding: "4px 8px",
    fontFamily: "monospace",
    fontSize: "12px",
    width: "120px",
  },
  button: {
    background: "#1e1e2e",
    color: "#cdd6f4",
    border: "2px solid #45475a",
    borderRadius: 0,
    padding: "4px 10px",
    fontFamily: "monospace",
    fontSize: "12px",
    cursor: "pointer",
  },
  buttonDanger: {
    background: "#1e1e2e",
    color: "#f38ba8",
    border: "2px solid #f38ba8",
    borderRadius: 0,
    padding: "4px 10px",
    fontFamily: "monospace",
    fontSize: "12px",
    cursor: "pointer",
  },
  listContainer: {
    flex: 1,
    minHeight: 0,
  },
  logRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "2px 8px",
    height: "24px",
    lineHeight: "24px",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    borderBottom: "1px solid #181825",
  },
  timestamp: {
    color: "#6c7086",
    flexShrink: 0,
  },
  badge: (level: LogLevel) => ({
    display: "inline-block",
    padding: "0 6px",
    color: "#1e1e2e",
    background: LEVEL_COLORS[level],
    fontWeight: 700,
    fontSize: "10px",
    textTransform: "uppercase" as const,
    flexShrink: 0,
    minWidth: "40px",
    textAlign: "center" as const,
  }),
  source: {
    color: "#a6adc8",
    flexShrink: 0,
    maxWidth: "120px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  message: {
    color: "#cdd6f4",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
  },
  scrollButton: {
    position: "absolute" as const,
    bottom: "12px",
    right: "20px",
    background: "#313244",
    color: "#89b4fa",
    border: "2px solid #89b4fa",
    borderRadius: 0,
    padding: "4px 12px",
    fontFamily: "monospace",
    fontSize: "11px",
    cursor: "pointer",
    zIndex: 10,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#6c7086",
    fontSize: "13px",
    fontFamily: "monospace",
  },
  filterLabel: {
    color: "#6c7086",
    fontSize: "11px",
  },
  spacer: {
    flex: 1,
  },
} as const;

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div style={styles.logRow}>
      <span style={styles.timestamp}>{formatTimestamp(entry.timestamp)}</span>
      <span style={styles.badge(entry.level)}>{entry.level}</span>
      <span style={styles.source}>[{entry.source}]</span>
      <span style={styles.message}>{entry.message}</span>
    </div>
  );
}

export function LogViewer() {
  const [levelFilter, setLevelFilter] = useState<LogLevel | "">("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [atBottom, setAtBottom] = useState(true);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const agents = useAgentStore((s) => s.agents);

  const filteredLogs = useFilteredLogs({
    level: levelFilter || undefined,
    source: sourceFilter || undefined,
    agentSessionId: agentFilter || undefined,
  });

  const agentList = Array.from(agents.values());

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      behavior: "smooth",
    });
  }, []);

  // 注意：Virtuoso 的 followOutput="smooth" 已經在 at-bottom 時自動捲動；
  // 先前的 useEffect scrollToIndex 是冗餘且會與 followOutput 互搶時機。

  const handleExport = useCallback(() => {
    // 匯出目前所有日誌（不套用篩選條件 — 這是慣例）
    const ordered = snapshotOrderedLogs();
    const blob = new Blob([JSON.stringify(ordered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pixel-agents-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleClearFilters = useCallback(() => {
    setLevelFilter("");
    setSourceFilter("");
    setAgentFilter("");
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.filterBar}>
        <span style={styles.filterLabel}>等級:</span>
        <select
          style={styles.select}
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LogLevel | "")}
        >
          <option value="">全部</option>
          <option value="info">資訊</option>
          <option value="warn">警告</option>
          <option value="error">錯誤</option>
          <option value="debug">除錯</option>
        </select>

        <span style={styles.filterLabel}>來源:</span>
        <input
          style={styles.input}
          type="text"
          placeholder="篩選來源..."
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        />

        <span style={styles.filterLabel}>代理:</span>
        <select
          style={styles.select}
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">全部</option>
          {agentList.map((a) => (
            <option key={a.sessionId} value={a.sessionId}>
              {a.projectName || a.sessionId.slice(0, 8)}
            </option>
          ))}
        </select>

        <button style={styles.button} onClick={handleClearFilters}>
          清除篩選
        </button>

        <div style={styles.spacer} />

        <button style={styles.button} onClick={handleExport}>
          匯出
        </button>
        <button style={styles.buttonDanger} onClick={clearLogs}>
          清除日誌
        </button>
      </div>

      <div style={{ ...styles.listContainer, position: "relative" }}>
        {filteredLogs.length === 0 ? (
          <div style={styles.empty}>無日誌記錄</div>
        ) : (
          <>
            <Virtuoso
              ref={virtuosoRef}
              data={filteredLogs}
              itemContent={(_index, entry) => <LogRow entry={entry} />}
              followOutput="smooth"
              atBottomStateChange={setAtBottom}
              style={{ height: "100%" }}
            />
            {!atBottom && (
              <button style={styles.scrollButton} onClick={scrollToBottom}>
                捲動至底部
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
