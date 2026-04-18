/**
 * # AgentCard — 單個 agent 的卡片
 *
 * 接收 `sessionId` 而非 agent 物件：內部以 `useAgentStore((s) => s.agents.get(id))`
 * 訂閱該 agent；只有該 agent 變更時本 card 才 re-render。
 *
 * ## 工具 badge 色系
 *
 * [[TOOL_COLORS]] 是**跨主題固定** 的語意色（File 操作=藍、Bash=綠等），
 * 不跟隨 dark/light theme 切換，以維持工具類別的視覺識別。
 *
 * ## React.memo
 *
 * 外層以 `memo` 包裝，配合父層 `AgentList` 的 `sessionIds` selector，
 * 保證：父層 state 變動（例如 tab 切換重渲染）時 AgentCard 不會重跑
 * selector；只有真的該 agent 變動時才 re-render。
 */

import { memo, useState } from "react";
import { useAgentStore, type ToolInfo } from "../stores/agentStore";
import { useTick } from "../hooks/useTick";
import { useTranslation } from "../i18n";
import { useThemeColors, type ThemeColors } from "../theme";

const TOOL_COLORS: Record<string, string> = {
  // File operations — blue
  Read: "#89b4fa",
  Edit: "#89b4fa",
  Write: "#89b4fa",
  MultiEdit: "#89b4fa",
  NotebookEdit: "#89b4fa",
  // Search — teal
  Grep: "#94e2d5",
  Glob: "#94e2d5",
  // Execute — green
  Bash: "#a6e3a1",
  // Network — purple
  WebFetch: "#cba6f7",
  WebSearch: "#cba6f7",
  // MCP — pink
  mcp: "#f5c2e7",
  // Agent — gold
  Task: "#f9e2af",
  Agent: "#f9e2af",
  TodoWrite: "#f9e2af",
};

function getToolColor(toolName: string, fallback: string): string {
  // Direct match — TOOL_COLORS 為固定色系（跨主題一致）
  const direct = TOOL_COLORS[toolName];
  if (direct) return direct;
  if (toolName.startsWith("mcp_") || toolName.startsWith("mcp__")) {
    return TOOL_COLORS.mcp ?? fallback;
  }
  return fallback;
}

function formatElapsed(startedAt: number): string {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m${sec % 60}s`;
}

function useFormatTimeSince(): (timestamp: number) => string {
  const t = useTranslation();
  return (timestamp: number): string => {
    const sec = Math.floor((Date.now() - timestamp) / 1000);
    if (sec < 5) return t("agents.timeJustNow");
    if (sec < 60) return t("agents.timeSecondsAgo", { n: sec });
    const min = Math.floor(sec / 60);
    if (min < 60) return t("agents.timeMinutesAgo", { n: min });
    const hr = Math.floor(min / 60);
    return t("agents.timeHoursAgo", { n: hr });
  };
}

function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 12) return sessionId;
  return sessionId.slice(0, 8) + "...";
}

function ToolBadge({ tool }: { tool: ToolInfo }) {
  const c = useThemeColors();
  const color = getToolColor(tool.toolName, c.textDim);
  // 訂閱共用 tick — 所有 Badge 同步每秒重新渲染，不各自建立 setInterval
  useTick();

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "1px 6px",
        background: color + "1a",
        border: `1px solid ${color}66`,
        borderRadius: 0,
        fontSize: "10px",
        fontFamily: "monospace",
        color: color,
      }}
    >
      {tool.toolName}
      <span style={{ opacity: 0.7 }}>{formatElapsed(tool.startedAt)}</span>
    </span>
  );
}

function makeStyles(c: ThemeColors) {
  return {
    card: (hovered: boolean) => ({
      padding: "12px 16px",
      background: c.bgElevated,
      border: `2px solid ${hovered ? c.accent : c.border}`,
      borderRadius: 0,
      display: "flex" as const,
      flexDirection: "column" as const,
      gap: "8px",
      cursor: "default",
      transition: "border-color 0.15s",
    }),
    header: {
      display: "flex" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    projectName: {
      fontSize: "14px",
      fontWeight: 700,
      color: c.text,
      fontFamily: "monospace",
    },
    statusDot: (status: string) => ({
      width: "8px",
      height: "8px",
      borderRadius: 0,
      background: status === "active" ? c.success : c.textMuted,
      border: `1px solid ${status === "active" ? c.success : c.borderLight}`,
      flexShrink: 0,
    }),
    sessionId: {
      fontSize: "10px",
      color: c.textMuted,
      fontFamily: "monospace",
    },
    toolsRow: {
      display: "flex" as const,
      flexWrap: "wrap" as const,
      gap: "4px",
    },
    footer: {
      fontSize: "10px",
      color: c.textMuted,
      fontFamily: "monospace",
    },
  } as const;
}

interface AgentCardProps {
  sessionId: string;
  /** 點擊卡片時的 callback（通常用來開啟 [[AgentDetailsDrawer]]）。
   *  可省略；無 handler 時卡片不顯示 pointer cursor。 */
  onSelect?: (sessionId: string) => void;
}

function AgentCardInner({ sessionId, onSelect }: AgentCardProps) {
  // 以 sessionId 訂閱單一 agent — 只有該 agent 變更時本 card 才重渲染
  const agent = useAgentStore((s) => s.agents.get(sessionId));
  const [hovered, setHovered] = useState(false);
  const t = useTranslation();
  const c = useThemeColors();
  const styles = makeStyles(c);
  const formatTimeSince = useFormatTimeSince();
  // 訂閱共用 tick 讓「最後活動: N 秒前」能每秒刷新
  useTick();

  if (!agent) return null;

  const clickable = !!onSelect;

  return (
    <div
      style={{
        ...styles.card(hovered),
        cursor: clickable ? "pointer" : "default",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect?.(sessionId)}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(sessionId);
        }
      }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${agent.projectName} — ${t("agents.detailsTitle")}` : undefined}
    >
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={styles.statusDot(agent.status)} />
          <span style={styles.projectName}>{agent.projectName}</span>
        </div>
        <span style={styles.sessionId}>{truncateSessionId(agent.sessionId)}</span>
      </div>

      {agent.tools.length > 0 && (
        <div style={styles.toolsRow}>
          {agent.tools.map((tool) => (
            <ToolBadge key={tool.toolId} tool={tool} />
          ))}
        </div>
      )}

      {agent.lastActivity > 0 && (
        <div style={styles.footer}>
          {t("agents.lastActivity")} {formatTimeSince(agent.lastActivity)}
        </div>
      )}
    </div>
  );
}

/** memo 避免父層 AgentList 重渲染時（例如 sessionId 列表未變但父層 state 改變）
 *  所有 AgentCard 一起跟著跑 selector，即使各自 agent 未變。 */
export const AgentCard = memo(AgentCardInner);
