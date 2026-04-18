/**
 * # App — 根元件與中央事件分派器
 *
 * - 依 `connectionStore.status` 切換 [[LoginView]] / [[MainView]]
 * - 註冊 `sidecar-event` / `sidecar-crash` listener 一次，路由到對應 store
 * - [[handleSidecarEvent]] 是 **非 React context 下** 執行的全域函式，
 *   以 `useXxxStore.getState()` 直接操作 store；不能用 hook
 * - 頂層掛 [[ThemeApplier]]（一次性，讀 theme 模式套用到 html）與
 *   [[NoticeBanner]]（全應用可見的系統通知列）
 *
 * ## Payload 驗證
 *
 * 所有事件 payload 先經 [[validators]] type guard；不合法時 console.warn
 * 並 skip，避免 sidecar 發出異常結構造成 runtime crash。
 */

import { useEffect } from "react";
import { useConnectionStore } from "./stores/connectionStore";
import { useAgentStore } from "./stores/agentStore";
import { useLogStore } from "./stores/logStore";
import { setupEventListeners, reportCrash, type SidecarEvent } from "./tauri-api";
import { LoginView } from "./components/LoginView";
import { MainView } from "./components/MainView";
import { NoticeBanner } from "./components/NoticeBanner";
import { useSystemStore } from "./stores/systemStore";
import { ThemeApplier } from "./theme/ThemeApplier";
import { useThemeColors } from "./theme";
import { useLocaleStore } from "./i18n";
import { zhTW } from "./i18n/locales/zh-TW";
import { en } from "./i18n/locales/en";
import { ja } from "./i18n/locales/ja";
import {
  isAgentStartedPayload,
  isSessionPayload,
  isToolStartPayload,
  isToolDonePayload,
  isAgentStatusPayload,
  isConnectionStatusPayload,
  isTranscriptPayload,
  isLatencyPayload,
  isErrorPayload,
  isTerminalExitPayload,
} from "./lib/validators";

const useStyles = () => {
  const c = useThemeColors();
  return {
    container: {
      display: "flex",
      flexDirection: "column" as const,
      height: "100vh",
      background: c.bg,
      color: c.text,
      fontFamily: "monospace, system-ui, -apple-system, sans-serif",
      margin: 0,
    },
  } as const;
};

// handleSidecarEvent 在非 React context 下呼叫（Tauri event listener callback），
// 不能用 useTranslation hook；直接讀當前 locale 對應的字典。
function dict() {
  const locale = useLocaleStore.getState().locale;
  if (locale === "en") return en;
  if (locale === "ja") return ja;
  return zhTW;
}

function handleSidecarEvent(event: SidecarEvent) {
  const { setStatus, setLatency, setAgentCount, setError } =
    useConnectionStore.getState();
  const { addAgent, removeAgent, updateAgent, clearAgents, addTool, removeTool, updateAgentActivity } =
    useAgentStore.getState();
  const { addLog } = useLogStore.getState();
  const d = dict();

  // Rust 發 IpcEvent 序列化為 { event, data }；舊欄位名為 { kind, payload }。
  const kind = (event.kind ?? event.event) as SidecarEvent["kind"];
  const payload: unknown = event.payload ?? event.data ?? {};

  switch (kind) {
    case "connected":
      setStatus("connected");
      setError(null);
      addLog({ timestamp: Date.now(), level: "info", source: "connection", message: d.log.connected });
      break;

    case "disconnected":
      setStatus("disconnected");
      clearAgents();
      addLog({ timestamp: Date.now(), level: "warn", source: "connection", message: d.log.disconnected });
      break;

    case "agent_created":
    case "agentStarted": {
      if (!isAgentStartedPayload(payload)) {
        console.warn("[App] invalid agentStarted payload", payload);
        break;
      }
      addAgent(payload.sessionId, {
        sessionId: payload.sessionId,
        projectName: payload.projectName,
        tools: [],
        status: "idle",
        lastActivity: Date.now(),
      });
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "agent",
        agentSessionId: payload.sessionId,
        message: `${d.agents.agentStarted} ${payload.projectName || payload.sessionId.slice(0, 8)}`,
      });
      break;
    }

    case "agent_closed":
    case "agentStopped": {
      if (!isSessionPayload(payload)) {
        console.warn("[App] invalid agentStopped payload", payload);
        break;
      }
      removeAgent(payload.sessionId);
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "agent",
        agentSessionId: payload.sessionId,
        message: `${d.agents.agentStopped} ${payload.sessionId.slice(0, 8)}`,
      });
      break;
    }

    case "agent_tool_start":
    case "toolStart": {
      if (!isToolStartPayload(payload)) {
        console.warn("[App] invalid toolStart payload", payload);
        break;
      }
      const toolId = payload.toolId ?? `${payload.toolName}-${Date.now()}`;
      addTool(payload.sessionId, {
        toolId,
        toolName: payload.toolName,
        toolStatus: payload.toolStatus ?? "running",
        startedAt: Date.now(),
      });
      addLog({
        timestamp: Date.now(),
        level: "debug",
        source: "tool",
        agentSessionId: payload.sessionId,
        message: `${d.log.toolStarted} ${payload.toolName}`,
      });
      break;
    }

    case "agent_tool_done":
    case "toolDone": {
      if (!isToolDonePayload(payload)) {
        console.warn("[App] invalid toolDone payload", payload);
        break;
      }
      if (payload.toolId) {
        removeTool(payload.sessionId, payload.toolId);
      } else if (payload.toolName) {
        // Fallback: remove the first matching tool by name
        const agents = useAgentStore.getState().agents;
        const agent = agents.get(payload.sessionId);
        if (agent) {
          const match = agent.tools.find((t) => t.toolName === payload.toolName);
          if (match) {
            removeTool(payload.sessionId, match.toolId);
          }
        }
      }
      addLog({
        timestamp: Date.now(),
        level: "debug",
        source: "tool",
        agentSessionId: payload.sessionId,
        message: payload.toolName
          ? `${d.log.toolCompletedWith} ${payload.toolName}`
          : d.log.toolCompleted,
      });
      break;
    }

    case "agent_status": {
      if (!isAgentStatusPayload(payload)) {
        console.warn("[App] invalid agent_status payload", payload);
        break;
      }
      updateAgent(payload.sessionId, { status: payload.status });
      updateAgentActivity(payload.sessionId);
      break;
    }

    case "connectionStatus": {
      if (!isConnectionStatusPayload(payload)) {
        console.warn("[App] invalid connectionStatus payload", payload);
        break;
      }
      setStatus(payload.connected ? "connected" : "disconnected");
      if (!payload.connected) {
        clearAgents();
      }
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "connection",
        message: `${d.log.connectionLabel} ${payload.connected ? d.status.connected : d.status.disconnected}`,
      });
      break;
    }

    case "transcript": {
      if (!isTranscriptPayload(payload)) break;
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "transcript",
        agentSessionId: payload.sessionId,
        message: payload.summary || payload.message || d.log.transcriptUpdate,
      });
      break;
    }

    case "latency": {
      if (!isLatencyPayload(payload)) break;
      setLatency(payload.ms);
      break;
    }

    case "error": {
      if (!isErrorPayload(payload)) break;
      setError(payload.message);
      addLog({
        timestamp: Date.now(),
        level: "error",
        source: "sidecar",
        message: payload.message,
      });
      break;
    }

    // Terminal events — handled by TerminalPanel's own listener,
    // but logged here for the log viewer.
    case "terminalData":
      // High-frequency — skip logging
      break;

    case "terminalReady": {
      if (!isSessionPayload(payload)) break;
      addLog({
        timestamp: Date.now(),
        level: "info",
        source: "terminal",
        agentSessionId: payload.sessionId,
        message: d.terminal.ready,
      });
      break;
    }

    case "terminalExit": {
      if (!isTerminalExitPayload(payload)) break;
      addLog({
        timestamp: Date.now(),
        level: "warn",
        source: "terminal",
        agentSessionId: payload.sessionId,
        message: d.terminal.exitedLog.replace("{code}", String(payload.code ?? "?")),
      });
      break;
    }
  }

  // 只在數量實際變化時更新 — 避免每個事件都觸發 connectionStore 的 subscriber 重渲染
  const agentCount = useAgentStore.getState().agents.size;
  if (agentCount !== useConnectionStore.getState().agentCount) {
    setAgentCount(agentCount);
  }
}

function handleReadyEvent(event: SidecarEvent): void {
  const kind = event.kind ?? event.event;
  if (kind !== "ready") return;
  const data = event.payload ?? event.data;
  if (typeof data === "object" && data !== null && "version" in data) {
    const v = (data as { version?: unknown }).version;
    if (typeof v === "string") {
      useSystemStore.getState().setSidecarVersion(v);
    }
  }
}

function App() {
  const status = useConnectionStore((s) => s.status);
  const styles = useStyles();

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    setupEventListeners({
      onSidecar: (evt) => {
        handleReadyEvent(evt);
        handleSidecarEvent(evt);
      },
      onSidecarCrash: (evt) => {
        const level = evt.fatal ? "error" : evt.warning ? "warn" : "info";
        useSystemStore.getState().setNotice({
          level,
          message: evt.message,
          fatal: !!evt.fatal,
        });
        useLogStore.getState().addLog({
          timestamp: Date.now(),
          level: evt.fatal ? "error" : "warn",
          source: "sidecar",
          message: evt.message,
        });
        // 嚴重情況（fatal）持久化到 crash 目錄
        if (evt.fatal) {
          void reportCrash("sidecar-fatal", evt.message, evt);
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
      <ThemeApplier />
      <NoticeBanner />
      {isConnected ? <MainView /> : <LoginView />}
    </div>
  );
}

export default App;
