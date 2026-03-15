import { useAgentStore } from "../stores/agentStore";
import { AgentCard } from "./AgentCard";

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    height: "100%",
  },
  empty: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    height: "100%",
    gap: "8px",
  },
  emptyIcon: {
    fontSize: "32px",
    color: "#45475a",
    fontFamily: "monospace",
  },
  emptyText: {
    color: "#6c7086",
    fontSize: "13px",
    fontFamily: "monospace",
    textAlign: "center" as const,
    lineHeight: "1.5",
  },
} as const;

export function AgentList() {
  const agents = useAgentStore((s) => s.agents);
  const agentList = Array.from(agents.values());

  if (agentList.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>[  ]</div>
        <div style={styles.emptyText}>
          No agents detected yet.
          <br />
          Waiting for Claude Code sessions...
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {agentList.map((agent) => (
        <AgentCard key={agent.sessionId} agent={agent} />
      ))}
    </div>
  );
}
