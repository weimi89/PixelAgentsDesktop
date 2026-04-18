/**
 * # LogViewer — 日誌分頁
 *
 * 以 `react-virtuoso` 虛擬化渲染；可支援數千條日誌不卡頓。
 *
 * ## 篩選
 *
 * 三個維度：等級、來源（子字串不分大小寫）、代理。透過
 * [[useFilteredLogs]] 在 render 時 `useMemo` 計算。
 *
 * ## 自動捲動
 *
 * `followOutput="smooth"` 由 Virtuoso 內建：使用者在底部時新日誌進來
 * 自動捲動，滑離底部時不打擾。`atBottomStateChange` 供顯示「捲動到底」
 * 按鈕。**不** 額外寫 `useEffect` 手動 `scrollToIndex`，會與 followOutput
 * 互搶時機。
 *
 * ## 匯出
 *
 * 匯出 **全部** 日誌（不套用當前篩選，這是慣例），以 Blob URL + 隱形
 * `<a>.click()` 觸發下載。
 */

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
import { useTranslation } from "../i18n";
import { useThemeColors, type ThemeColors } from "../theme";

function useLevelColors(): Record<LogLevel, string> {
  const c = useThemeColors();
  return {
    info: c.accent,
    warn: c.warning,
    error: c.error,
    debug: c.textMuted,
  };
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function makeStyles(c: ThemeColors, levelColors: Record<LogLevel, string>) {
  return {
    container: {
      display: "flex",
      flexDirection: "column" as const,
      height: "100%",
      fontFamily: "monospace",
      fontSize: "12px",
      color: c.text,
    },
    filterBar: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px",
      background: c.bgElevated,
      borderBottom: `2px solid ${c.border}`,
      flexWrap: "wrap" as const,
      flexShrink: 0,
    },
    select: {
      background: c.bg,
      color: c.text,
      border: `2px solid ${c.border}`,
      borderRadius: 0,
      padding: "4px 8px",
      fontFamily: "monospace",
      fontSize: "12px",
      cursor: "pointer",
    },
    input: {
      background: c.bg,
      color: c.text,
      border: `2px solid ${c.border}`,
      borderRadius: 0,
      padding: "4px 8px",
      fontFamily: "monospace",
      fontSize: "12px",
      width: "120px",
    },
    button: {
      background: c.bg,
      color: c.text,
      border: `2px solid ${c.border}`,
      borderRadius: 0,
      padding: "4px 10px",
      fontFamily: "monospace",
      fontSize: "12px",
      cursor: "pointer",
    },
    buttonDanger: {
      background: c.bg,
      color: c.error,
      border: `2px solid ${c.error}`,
      borderRadius: 0,
      padding: "4px 10px",
      fontFamily: "monospace",
      fontSize: "12px",
      cursor: "pointer",
    },
    listContainer: { flex: 1, minHeight: 0 },
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
      borderBottom: `1px solid ${c.bgSurface}`,
    },
    timestamp: { color: c.textMuted, flexShrink: 0 },
    badge: (level: LogLevel) => ({
      display: "inline-block",
      padding: "0 6px",
      color: c.bg,
      background: levelColors[level],
      fontWeight: 700,
      fontSize: "10px",
      textTransform: "uppercase" as const,
      flexShrink: 0,
      minWidth: "40px",
      textAlign: "center" as const,
    }),
    source: {
      color: c.textDim,
      flexShrink: 0,
      maxWidth: "120px",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    message: {
      color: c.text,
      overflow: "hidden",
      textOverflow: "ellipsis",
      flex: 1,
    },
    scrollButton: {
      position: "absolute" as const,
      bottom: "12px",
      right: "20px",
      background: c.bgElevated,
      color: c.accent,
      border: `2px solid ${c.accent}`,
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
      color: c.textMuted,
      fontSize: "13px",
      fontFamily: "monospace",
    },
    filterLabel: { color: c.textMuted, fontSize: "11px" },
    spacer: { flex: 1 },
  } as const;
}

function LogRow({ entry }: { entry: LogEntry }) {
  const c = useThemeColors();
  const levelColors = useLevelColors();
  const styles = makeStyles(c, levelColors);
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
  const t = useTranslation();
  const c = useThemeColors();
  const levelColors = useLevelColors();
  const styles = makeStyles(c, levelColors);
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
        <span style={styles.filterLabel}>{t("logs.filterLevel")}</span>
        <select
          style={styles.select}
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LogLevel | "")}
        >
          <option value="">{t("logs.levelAll")}</option>
          <option value="info">{t("logs.levelInfo")}</option>
          <option value="warn">{t("logs.levelWarn")}</option>
          <option value="error">{t("logs.levelError")}</option>
          <option value="debug">{t("logs.levelDebug")}</option>
        </select>

        <span style={styles.filterLabel}>{t("logs.filterSource")}</span>
        <input
          style={styles.input}
          type="text"
          placeholder={t("logs.filterSourcePlaceholder")}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        />

        <span style={styles.filterLabel}>{t("logs.filterAgent")}</span>
        <select
          style={styles.select}
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">{t("logs.levelAll")}</option>
          {agentList.map((a) => (
            <option key={a.sessionId} value={a.sessionId}>
              {a.projectName || a.sessionId.slice(0, 8)}
            </option>
          ))}
        </select>

        <button style={styles.button} onClick={handleClearFilters}>
          {t("logs.clearFilters")}
        </button>

        <div style={styles.spacer} />

        <button style={styles.button} onClick={handleExport}>
          {t("logs.export")}
        </button>
        <button style={styles.buttonDanger} onClick={clearLogs}>
          {t("logs.clearLogs")}
        </button>
      </div>

      <div style={{ ...styles.listContainer, position: "relative" }}>
        {filteredLogs.length === 0 ? (
          <div style={styles.empty}>{t("logs.emptyText")}</div>
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
                {t("logs.scrollToBottom")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
