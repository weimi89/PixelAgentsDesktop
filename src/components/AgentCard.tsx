import { useState, useEffect } from "react";
import type { AgentInfo, ToolInfo } from "../stores/agentStore";

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
  if (TOOL_COLORS[toolName]) return TOOL_COLORS[toolName];
  // MCP tools
  if (toolName.startsWith("mcp_") || toolName.startsWith("mcp__")) return TOOL_COLORS.mcp;
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
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 12) return sessionId;
  return sessionId.slice(0, 8) + "...";
}

function ToolBadge({ tool }: { tool: ToolInfo }) {
  const color = getToolColor(tool.toolName);
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

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

export function AgentCard({ agent }: { agent: AgentInfo }) {
  const [hovered, setHovered] = useState(false);
  const [, setTick] = useState(0);

  // Update "time since" display
  useEffect(() => {
    if (agent.tools.length > 0) return; // ToolBadge handles its own ticking
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, [agent.tools.length]);

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
          Last activity: {formatTimeSince(agent.lastActivity)}
        </div>
      )}
    </div>
  );
}
