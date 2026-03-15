import { useConnectionStore } from "../stores/connectionStore";
import { disconnect } from "../tauri-api";

const styles = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "6px 16px",
    background: "#181825",
    borderTop: "2px solid #313244",
    fontSize: "12px",
    fontFamily: "monospace",
  },
  statusGroup: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  indicator: (color: string) => ({
    display: "inline-block",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
  label: {
    color: "#6c7086",
  },
  value: {
    color: "#cdd6f4",
  },
  serverUrl: {
    color: "#a6adc8",
    fontSize: "11px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: "200px",
  },
  spacer: {
    flex: 1,
  },
  error: {
    color: "#f38ba8",
    fontSize: "11px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: "300px",
  },
  disconnectButton: {
    padding: "2px 10px",
    background: "transparent",
    color: "#f38ba8",
    border: "1px solid #f38ba8",
    borderRadius: 0,
    cursor: "pointer",
    fontSize: "11px",
    fontFamily: "monospace",
  },
} as const;

const STATUS_COLORS: Record<string, string> = {
  disconnected: "#f38ba8",
  connecting: "#fab387",
  connected: "#a6e3a1",
};

export function StatusBar() {
  const { status, latency, agentCount, error, serverUrl, reset } =
    useConnectionStore();

  const indicatorColor = STATUS_COLORS[status] ?? "#6c7086";

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch {
      // ignore
    }
    reset();
  };

  return (
    <div style={styles.bar}>
      <div style={styles.statusGroup}>
        <span style={styles.indicator(indicatorColor)} />
        <span style={styles.value}>{status}</span>
      </div>

      {status === "connected" && serverUrl && (
        <span style={styles.serverUrl}>{serverUrl}</span>
      )}

      <span>
        <span style={styles.label}>Latency: </span>
        <span style={styles.value}>
          {latency > 0 ? `${latency}ms` : "--"}
        </span>
      </span>

      <span>
        <span style={styles.label}>Agents: </span>
        <span style={styles.value}>{agentCount}</span>
      </span>

      {error && <span style={styles.error}>{error}</span>}

      <div style={styles.spacer} />

      {status === "connected" && (
        <button style={styles.disconnectButton} onClick={handleDisconnect}>
          Disconnect
        </button>
      )}
    </div>
  );
}
