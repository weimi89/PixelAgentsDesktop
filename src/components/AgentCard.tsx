import { memo, useState } from "react";
import { useAgentStore, type ToolInfo } from "../stores/agentStore";
import { useTick } from "../hooks/useTick";

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

function getToolColor(toolName: string): string {
  // Direct match
  const direct = TOOL_COLORS[toolName];
  if (direct) return direct;
  // MCP tools
  if (toolName.startsWith("mcp_") || toolName.startsWith("mcp__")) {
    return TOOL_COLORS.mcp ?? "#a6adc8";
  }
  // Fallback
  return "#a6adc8";
}

function formatElapsed(startedAt: number): string {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m${sec % 60}s`;
}

function formatTimeSince(timestamp: number): string {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 5) return "剛剛";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分前`;
  const hr = Math.floor(min / 60);
  return `${hr} 小時前`;
}

function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 12) return sessionId;
  return sessionId.slice(0, 8) + "...";
}

function ToolBadge({ tool }: { tool: ToolInfo }) {
  const color = getToolColor(tool.toolName);
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

const styles = {
  card: (hovered: boolean) => ({
    padding: "12px 16px",
    background: "#313244",
    border: `2px solid ${hovered ? "#89b4fa" : "#45475a"}`,
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
    color: "#cdd6f4",
    fontFamily: "monospace",
  },
  statusDot: (status: string) => ({
    width: "8px",
    height: "8px",
    borderRadius: 0,
    background: status === "active" ? "#a6e3a1" : "#6c7086",
    border: `1px solid ${status === "active" ? "#a6e3a1" : "#585b70"}`,
    flexShrink: 0,
  }),
  sessionId: {
    fontSize: "10px",
    color: "#6c7086",
    fontFamily: "monospace",
  },
  toolsRow: {
    display: "flex" as const,
    flexWrap: "wrap" as const,
    gap: "4px",
  },
  footer: {
    fontSize: "10px",
    color: "#585b70",
    fontFamily: "monospace",
  },
} as const;

function AgentCardInner({ sessionId }: { sessionId: string }) {
  // 以 sessionId 訂閱單一 agent — 只有該 agent 變更時本 card 才重渲染
  const agent = useAgentStore((s) => s.agents.get(sessionId));
  const [hovered, setHovered] = useState(false);
  // 訂閱共用 tick 讓「最後活動: N 秒前」能每秒刷新
  useTick();

  if (!agent) return null;

  return (
    <div
      style={styles.card(hovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
          最後活動: {formatTimeSince(agent.lastActivity)}
        </div>
      )}
    </div>
  );
}

/** memo 避免父層 AgentList 重渲染時（例如 sessionId 列表未變但父層 state 改變）
 *  所有 AgentCard 一起跟著跑 selector，即使各自 agent 未變。 */
export const AgentCard = memo(AgentCardInner);
