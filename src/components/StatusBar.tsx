/**
 * # StatusBar — 底部狀態列
 *
 * 顯示連線狀態指示燈、server URL（可點擊複製）、延遲 ms、代理數、
 * 錯誤訊息（若有）、sidecar 協定版本、中斷連線按鈕。
 *
 * 以 `useConnectionStore()` 解構整個 state；此元件在已連線時頻繁更新
 * （每次 latency 變動重渲染），這是可接受的 — 整條 bar 不含任何 heavy DOM。
 */

import { useState } from "react";
import { useConnectionStore } from "../stores/connectionStore";
import { useSystemStore } from "../stores/systemStore";
import { disconnect } from "../tauri-api";
import { useTranslation } from "../i18n";
import { useThemeColors } from "../theme";

function useStyles() {
  const c = useThemeColors();
  return {
    bar: {
      display: "flex",
      alignItems: "center",
      gap: "16px",
      padding: "6px 16px",
      background: c.bgSurface,
      borderTop: `2px solid ${c.bgElevated}`,
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
    label: { color: c.textMuted },
    value: { color: c.text },
    serverUrl: {
      color: c.textDim,
      fontSize: "11px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap" as const,
      maxWidth: "200px",
      cursor: "pointer",
      background: "transparent",
      border: "none",
      padding: 0,
      fontFamily: "monospace",
    },
    version: { color: c.textMuted, fontSize: "11px" },
    spacer: { flex: 1 },
    error: {
      color: c.error,
      fontSize: "11px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap" as const,
      maxWidth: "300px",
    },
    disconnectButton: {
      padding: "2px 10px",
      background: "transparent",
      color: c.error,
      border: `1px solid ${c.error}`,
      borderRadius: 0,
      cursor: "pointer",
      fontSize: "11px",
      fontFamily: "monospace",
    },
  } as const;
}

function useStatusColors() {
  const c = useThemeColors();
  return {
    disconnected: c.error,
    connecting: c.warning,
    connected: c.success,
  } as Record<string, string>;
}

export function StatusBar() {
  const { status, latency, agentCount, error, serverUrl, reset } =
    useConnectionStore();
  const sidecarVersion = useSystemStore((s) => s.sidecarVersion);
  const [copied, setCopied] = useState(false);
  const t = useTranslation();
  const styles = useStyles();
  const statusColors = useStatusColors();
  const colors = useThemeColors();

  const indicatorColor = statusColors[status] ?? colors.textMuted;

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch {
      // ignore
    }
    reset();
  };

  const handleCopy = async () => {
    if (!serverUrl) return;
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API 可能被拒；fail silently
    }
  };

  return (
    <div style={styles.bar}>
      <div style={styles.statusGroup}>
        <span style={styles.indicator(indicatorColor)} />
        <span style={styles.value}>
          {status === "connected"
            ? t("status.connected")
            : status === "connecting"
            ? t("status.connecting")
            : t("status.disconnected")}
        </span>
      </div>

      {status === "connected" && serverUrl && (
        <button
          style={styles.serverUrl}
          onClick={handleCopy}
          title={copied ? t("status.copied") : `${t("status.copyHint")}: ${serverUrl}`}
        >
          {copied ? t("status.copied") : serverUrl}
        </button>
      )}

      <span>
        <span style={styles.label}>{t("status.latency")} </span>
        <span style={styles.value}>
          {latency > 0 ? `${latency}ms` : "--"}
        </span>
      </span>

      <span>
        <span style={styles.label}>{t("status.agents")} </span>
        <span style={styles.value}>{agentCount}</span>
      </span>

      {error && <span style={styles.error}>{error}</span>}

      <div style={styles.spacer} />

      {sidecarVersion && (
        <span style={styles.version} title={t("status.sidecarVersion")}>
          sidecar v{sidecarVersion}
        </span>
      )}

      {status === "connected" && (
        <button style={styles.disconnectButton} onClick={handleDisconnect}>
          {t("status.disconnect")}
        </button>
      )}
    </div>
  );
}
