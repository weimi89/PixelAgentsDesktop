import { useEffect } from "react";
import { useConnectionStore } from "./stores/connectionStore";
import { useAgentStore } from "./stores/agentStore";
import { useLogStore } from "./stores/logStore";
import { setupEventListeners, type SidecarEvent } from "./tauri-api";
import { LoginView } from "./components/LoginView";
import { MainView } from "./components/MainView";

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: "#1e1e2e",
    color: "#cdd6f4",
    fontFamily: "monospace, system-ui, -apple-system, sans-serif",
    margin: 0,
  },
} as const;

function handleSidecarEvent(event: SidecarEvent) {
  const { setStatus, setLatency, setAgentCount, setError } =
    useConnectionStore.getState();
  const { addAgent, removeAgent, updateAgent, clearAgents, addTool, removeTool, updateAgentActivity } =
    useAgentStore.getState();
  const { addLog } = useLogStore.getState();

  switch (event.kind) {
    case "connected":
      setStatus("connected");
      setError(null);
      addLog({ timestamp: Date.now(), level: "info", source: "connection", message: "已連線至伺服器" });
      break;

    case "disconnected":
      setStatus("disconnected");
      clearAgents();
      addLog({ timestamp: Date.now(), level: "warn", source: "connection", message: "已中斷與伺服器的連線" });
      break;

    case "agent_created":
    case "agentStarted": {
      const p = event.payload as {
        sessionId: string;
        projectName: string;
      };
      addAgent(p.sessionId, {
        sessionId: p.sessionId,
        projectName: p.projectName,
        tools: [],
        status: "idle",
        lastActivity: Date.now(),
      });
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "agent",
        agentSessionId: p.sessionId,
        message: `代理已啟動: ${p.projectName || p.sessionId.slice(0, 8)}`,
      });
      break;
    }

    case "agent_closed":
    case "agentStopped": {
      const p = event.payload as { sessionId: string };
      removeAgent(p.sessionId);
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "agent",
        agentSessionId: p.sessionId,
        message: `代理已停止: ${p.sessionId.slice(0, 8)}`,
      });
      break;
    }

    case "agent_tool_start":
    case "toolStart": {
      const p = event.payload as {
        sessionId: string;
        toolId?: string;
        toolName: string;
        toolStatus?: string;
      };
      const toolId = p.toolId ?? `${p.toolName}-${Date.now()}`;
      addTool(p.sessionId, {
        toolId,
        toolName: p.toolName,
        toolStatus: p.toolStatus ?? "running",
        startedAt: Date.now(),
      });
      addLog({
        timestamp: Date.now(),
        level: "debug",
        source: "tool",
        agentSessionId: p.sessionId,
        message: `工具已啟動: ${p.toolName}`,
      });
      break;
    }

    case "agent_tool_done":
    case "toolDone": {
      const p = event.payload as {
        sessionId: string;
        toolId?: string;
        toolName?: string;
      };
      if (p.toolId) {
        removeTool(p.sessionId, p.toolId);
      } else if (p.toolName) {
        // Fallback: remove the first matching tool by name
        const agents = useAgentStore.getState().agents;
        const agent = agents.get(p.sessionId);
        if (agent) {
          const match = agent.tools.find((t) => t.toolName === p.toolName);
          if (match) {
            removeTool(p.sessionId, match.toolId);
          }
        }
      }
      addLog({
        timestamp: Date.now(),
        level: "debug",
        source: "tool",
        agentSessionId: p.sessionId,
        message: `工具已完成${p.toolName ? `: ${p.toolName}` : ""}`,
      });
      break;
    }

    case "agent_status": {
      const p = event.payload as {
        sessionId: string;
        status: "active" | "idle";
      };
      updateAgent(p.sessionId, { status: p.status });
      updateAgentActivity(p.sessionId);
      break;
    }

    case "connectionStatus": {
      const p = event.payload as { connected: boolean };
      setStatus(p.connected ? "connected" : "disconnected");
      if (!p.connected) {
        clearAgents();
      }
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "connection",
        message: `連線: ${p.connected ? "已連線" : "已中斷"}`,
      });
      break;
    }

    case "transcript": {
      const p = event.payload as {
        sessionId?: string;
        summary?: string;
        message?: string;
      };
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "transcript",
        agentSessionId: p.sessionId,
        message: p.summary || p.message || "對話記錄更新",
      });
      break;
    }

    case "latency": {
      const p = event.payload as { ms: number };
      setLatency(p.ms);
      break;
    }

    case "error": {
      const p = event.payload as { message: string };
      setError(p.message);
      addLog({
        timestamp: Date.now(),
        level: "error",
        source: "sidecar",
        message: p.message,
      });
      break;
    }

    // Terminal events — handled by TerminalPanel's own listener,
    // but logged here for the log viewer.
    case "terminalData":
      // High-frequency — skip logging
      break;

    case "terminalReady": {
      const p = event.payload as { sessionId: string };
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "terminal",
        agentSessionId: p.sessionId,
        message: "終端機就緒",
      });
      break;
    }

    case "terminalExit": {
      const p = event.payload as { sessionId: string; code?: number };
      addLog({
        timestamp: Date.now(),
        level: "warn",
        source: "terminal",
        agentSessionId: p.sessionId,
        message: `終端機已結束 (代碼: ${p.code ?? "未知"})`,
      });
      break;
    }
  }

  // Update agent count
  const agentCount = useAgentStore.getState().agents.size;
  setAgentCount(agentCount);
}

function App() {
  const status = useConnectionStore((s) => s.status);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    setupEventListeners({
      onSidecar: handleSidecarEvent,
      onConnection: (connected) => {
        const { setStatus } = useConnectionStore.getState();
        setStatus(connected ? "connected" : "disconnected");
        if (!connected) {
          useAgentStore.getState().clearAgents();
        }
      },
    }).then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  }, []);

  const isConnected = status === "connected";

  return (
    <div style={styles.container}>
      {isConnected ? <MainView /> : <LoginView />}
    </div>
  );
}

export default App;
