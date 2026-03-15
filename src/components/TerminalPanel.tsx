import { useState, useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAgentStore } from "../stores/agentStore";
import { useTerminal } from "../hooks/useTerminal";
import {
  terminalAttach,
  terminalInput,
  terminalResize,
  terminalDetach,
} from "../tauri-api";
import type { SidecarEvent } from "../tauri-api";

import "@xterm/xterm/css/xterm.css";

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    gap: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    background: "#181825",
    borderBottom: "2px solid #313244",
    flexShrink: 0,
  },
  label: {
    color: "#6c7086",
    fontSize: "12px",
    fontFamily: "monospace",
    whiteSpace: "nowrap" as const,
  },
  select: {
    flex: 1,
    background: "#313244",
    color: "#cdd6f4",
    border: "1px solid #45475a",
    borderRadius: 0,
    padding: "4px 8px",
    fontSize: "12px",
    fontFamily: "monospace",
    cursor: "pointer",
    outline: "none",
  },
  statusDot: (ready: boolean) => ({
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: ready ? "#a6e3a1" : "#6c7086",
    flexShrink: 0,
  }),
  terminalWrapper: {
    flex: 1,
    overflow: "hidden",
    background: "#1e1e2e",
    padding: "4px",
    minHeight: 0,
  },
  placeholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#6c7086",
    fontSize: "13px",
    fontFamily: "monospace",
  },
  exitMessage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#f38ba8",
    fontSize: "13px",
    fontFamily: "monospace",
  },
};

export function TerminalPanel() {
  const agents = useAgentStore((s) => s.agents);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [termReady, setTermReady] = useState(false);
  const [termExited, setTermExited] = useState(false);
  const [exitMessage, setExitMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<string | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { getTerminal, write, clear, getDimensions, fit } = useTerminal();

  const agentList = Array.from(agents.values());

  // Open terminal into DOM container when both are available
  useEffect(() => {
    const terminal = getTerminal();
    const container = containerRef.current;
    if (!terminal || !container) return;

    // Only open if not already opened in this container
    if (container.querySelector(".xterm")) return;

    terminal.open(container);
    requestAnimationFrame(() => fit());
  }, [getTerminal, fit, selectedSessionId]);

  // Forward user typing to sidecar
  useEffect(() => {
    const terminal = getTerminal();
    if (!terminal) return;

    const disposable = terminal.onData((data: string) => {
      if (attachedRef.current) {
        terminalInput(attachedRef.current, data).catch(() => {});
      }
    });

    return () => disposable.dispose();
  }, [getTerminal]);

  // Listen for terminal events from sidecar
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      unlisten = await listen<SidecarEvent>("sidecar-event", (event) => {
        const evt = event.payload;
        // Rust IpcEvent emits { event, data } fields
        const kind = evt.kind ?? evt.event;
        const payload = (evt.payload ?? evt.data ?? {}) as Record<string, unknown>;

        if (kind === "terminalData") {
          const sessionId = payload.sessionId as string;
          const data = payload.data as string;
          if (sessionId === attachedRef.current) {
            write(data);
          }
        } else if (kind === "terminalReady") {
          const sessionId = payload.sessionId as string;
          if (sessionId === attachedRef.current) {
            setTermReady(true);
            setTermExited(false);
            setExitMessage(null);
          }
        } else if (kind === "terminalExit") {
          const sessionId = payload.sessionId as string;
          const code = payload.code as number | undefined;
          if (sessionId === attachedRef.current) {
            setTermReady(false);
            setTermExited(true);
            setExitMessage(
              `Terminal exited with code ${code ?? "unknown"}`,
            );
          }
        }
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, [write]);

  // Attach/detach when selectedSessionId changes
  useEffect(() => {
    const prev = attachedRef.current;

    // Detach previous
    if (prev && prev !== selectedSessionId) {
      terminalDetach(prev).catch(() => {});
      attachedRef.current = null;
      setTermReady(false);
      setTermExited(false);
      setExitMessage(null);
      clear();
    }

    // Attach new
    if (selectedSessionId && selectedSessionId !== prev) {
      attachedRef.current = selectedSessionId;
      clear();
      const dims = getDimensions();
      const cols = dims?.cols ?? 80;
      const rows = dims?.rows ?? 24;
      terminalAttach(selectedSessionId, cols, rows).catch((err) => {
        console.error("Failed to attach terminal:", err);
      });
    }

    return () => {
      // Cleanup on unmount
      const current = attachedRef.current;
      if (current) {
        terminalDetach(current).catch(() => {});
        attachedRef.current = null;
      }
    };
  }, [selectedSessionId, clear, getDimensions]);

  // Window resize handler
  const handleResize = useCallback(() => {
    if (resizeTimerRef.current) {
      clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = setTimeout(() => {
      fit();
      const dims = getDimensions();
      if (dims && attachedRef.current) {
        terminalResize(attachedRef.current, dims.cols, dims.rows).catch(
          () => {},
        );
      }
    }, 150);
  }, [getDimensions, fit]);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
    };
  }, [handleResize]);

  // Auto-select first agent if none selected
  useEffect(() => {
    if (!selectedSessionId && agentList.length > 0) {
      setSelectedSessionId(agentList[0].sessionId);
    }
    // If the selected agent was removed, clear selection
    if (selectedSessionId && !agents.has(selectedSessionId)) {
      setSelectedSessionId(null);
    }
  }, [agents, selectedSessionId, agentList]);

  if (agentList.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.placeholder}>
          No agents available. Connect to a server first.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.label}>Agent:</span>
        <select
          style={styles.select}
          value={selectedSessionId ?? ""}
          onChange={(e) => setSelectedSessionId(e.target.value || null)}
        >
          <option value="">-- Select agent --</option>
          {agentList.map((agent) => (
            <option key={agent.sessionId} value={agent.sessionId}>
              {agent.projectName} ({agent.sessionId.slice(0, 8)})
            </option>
          ))}
        </select>
        <div
          style={styles.statusDot(termReady)}
          title={termReady ? "Connected" : "Disconnected"}
        />
      </div>

      {selectedSessionId ? (
        termExited ? (
          <div style={styles.exitMessage}>{exitMessage}</div>
        ) : (
          <div ref={containerRef} style={styles.terminalWrapper} />
        )
      ) : (
        <div style={styles.placeholder}>
          Select an agent to open its terminal.
        </div>
      )}
    </div>
  );
}
