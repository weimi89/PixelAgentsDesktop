/**
 * # AgentDetailsDrawer — 代理詳細資訊
 *
 * 右側滑出面板，顯示單一 agent 完整資訊：sessionId、專案、兩種狀態、
 * 進行中工具清單、最後活動時間。
 *
 * 使用 modal backdrop + ESC 關閉 + 點擊外部關閉。採 `role="dialog"` +
 * `aria-modal="true"` 與 focus 管理符合 WAI-ARIA dialog pattern。
 */

import { useEffect, useRef } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useTick } from "../hooks/useTick";
import { useTranslation } from "../i18n";
import { useThemeColors } from "../theme";

interface Props {
  sessionId: string;
  onClose: () => void;
}

function formatElapsed(timestamp: number): string {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

export function AgentDetailsDrawer({ sessionId, onClose }: Props) {
  const agent = useAgentStore((s) => s.agents.get(sessionId));
  const t = useTranslation();
  const c = useThemeColors();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useTick(); // 讓「最後活動 N 秒前」與工具經過時間自動刷新

  // agent 在開啟 drawer 後被移除時收掉 drawer。改用 effect 而非在 render
  // 期間直接呼叫 onClose（父層 setState）—— 後者違反 React「render 期間不得
  // 更新其他元件」規則，會觸發警告與可能的多餘 render / 閃爍。
  useEffect(() => {
    if (!agent) onClose();
  }, [agent, onClose]);

  // 初始焦點移到關閉按鈕；卸載時把焦點還原到開啟前的元素（WAI-ARIA dialog
  // focus restoration）。刻意只在 mount/unmount 各跑一次，避免父層每次 render
  // 產生新的 onClose 參考而讓焦點被反覆搶回關閉按鈕。
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => prevFocused?.focus?.();
  }, []);

  // ESC 關閉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus trap — Tab / Shift+Tab 在對話框內循環，不讓焦點跑到被遮蔽的背景
  // 內容，符合 role="dialog" + aria-modal="true" 應有的行為。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!agent) return null;

  const styles = {
    backdrop: {
      position: "fixed" as const,
      inset: 0,
      background: "rgba(0, 0, 0, 0.4)",
      zIndex: 50,
    },
    panel: {
      position: "fixed" as const,
      top: 0,
      right: 0,
      bottom: 0,
      width: "min(420px, 90vw)",
      background: c.bg,
      color: c.text,
      borderLeft: `2px solid ${c.border}`,
      padding: "16px 20px",
      overflowY: "auto" as const,
      display: "flex",
      flexDirection: "column" as const,
      gap: "12px",
      fontFamily: "monospace",
      fontSize: "13px",
      zIndex: 51,
    },
    title: {
      fontSize: "16px",
      fontWeight: 700,
      color: c.accent,
      marginBottom: "4px",
    },
    row: {
      display: "flex",
      justifyContent: "space-between",
      gap: "8px",
      padding: "6px 0",
      borderBottom: `1px solid ${c.bgElevated}`,
    },
    label: {
      color: c.textMuted,
    },
    value: {
      color: c.text,
      wordBreak: "break-all" as const,
      textAlign: "right" as const,
      maxWidth: "70%",
    },
    toolList: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "4px",
      marginTop: "4px",
    },
    toolRow: {
      padding: "4px 8px",
      background: c.bgElevated,
      border: `1px solid ${c.border}`,
      fontSize: "12px",
      color: c.text,
    },
    emptyText: {
      fontSize: "12px",
      color: c.textMuted,
      fontStyle: "italic" as const,
    },
    closeBtn: {
      padding: "8px 16px",
      background: c.accent,
      color: c.bg,
      border: "none",
      borderRadius: 0,
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "12px",
      fontFamily: "monospace",
      alignSelf: "flex-end" as const,
      marginTop: "auto",
    },
  } as const;

  return (
    <>
      <div
        style={styles.backdrop}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        style={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("agents.detailsTitle")}
      >
        <h2 style={styles.title}>{t("agents.detailsTitle")}</h2>

        <div style={styles.row}>
          <span style={styles.label}>{t("agents.detailsProject")}</span>
          <span style={styles.value}>{agent.projectName}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>{t("agents.detailsSessionId")}</span>
          <span style={styles.value}>{agent.sessionId}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>{t("agents.detailsStatus")}</span>
          <span style={{ ...styles.value, color: agent.status === "active" ? c.success : c.textMuted }}>
            {agent.status}
          </span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>{t("agents.detailsClaudeStatus")}</span>
          <span style={styles.value}>{agent.claudeStatus ?? "-"}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>{t("agents.detailsLastActivity")}</span>
          <span style={styles.value}>
            {agent.lastActivity > 0 ? formatElapsed(agent.lastActivity) : "-"}
          </span>
        </div>

        <div>
          <div style={styles.label}>{t("agents.detailsTools")}</div>
          {agent.tools.length === 0 ? (
            <div style={styles.emptyText}>{t("agents.detailsNoTools")}</div>
          ) : (
            <div style={styles.toolList}>
              {agent.tools.map((tool) => (
                <div key={tool.toolId} style={styles.toolRow}>
                  <strong>{tool.toolName}</strong>
                  {tool.toolStatus ? ` — ${tool.toolStatus}` : ""}{" "}
                  <span style={{ color: c.textMuted, fontSize: "11px" }}>
                    {formatElapsed(tool.startedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          ref={closeBtnRef}
          style={styles.closeBtn}
          onClick={onClose}
          aria-label={t("agents.detailsClose")}
        >
          {t("agents.detailsClose")}
        </button>
      </div>
    </>
  );
}
