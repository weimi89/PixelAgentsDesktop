import { useEffect } from "react";
import { useSystemStore } from "../stores/systemStore";
import { useTranslation } from "../i18n";

const COLORS = {
  info: { bg: "#1e2333", border: "#89b4fa", text: "#89b4fa" },
  warn: { bg: "#2a2416", border: "#fab387", text: "#fab387" },
  error: { bg: "#2a1820", border: "#f38ba8", text: "#f38ba8" },
} as const;

const styles = {
  container: (color: { bg: string; border: string; text: string }, fatal: boolean) => ({
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "10px",
    padding: "8px 14px",
    background: color.bg,
    borderBottom: `2px solid ${color.border}`,
    color: color.text,
    fontFamily: "monospace",
    fontSize: "12px",
    fontWeight: fatal ? 700 : 400,
  }),
  message: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  button: (color: { text: string }) => ({
    background: "transparent",
    border: `1px solid ${color.text}`,
    color: color.text,
    padding: "2px 10px",
    fontFamily: "monospace",
    fontSize: "11px",
    cursor: "pointer",
  }),
} as const;

/**
 * 頂部橫幅 — 顯示 sidecar 崩潰/重啟、版本不符等系統通知。
 * 非 fatal 的通知在 8 秒後自動消失。
 */
export function NoticeBanner() {
  const notice = useSystemStore((s) => s.notice);
  const clearNotice = useSystemStore((s) => s.clearNotice);
  const t = useTranslation();

  useEffect(() => {
    if (!notice || notice.fatal) return;
    const id = setTimeout(() => {
      // 只有當 notice 仍然是同一個才清掉（避免清掉後來的）
      if (useSystemStore.getState().notice?.id === notice.id) {
        clearNotice();
      }
    }, 8000);
    return () => clearTimeout(id);
  }, [notice, clearNotice]);

  if (!notice) return null;

  const color = COLORS[notice.level];
  return (
    <div style={styles.container(color, !!notice.fatal)}>
      <span style={styles.message} title={notice.message}>
        {notice.message}
      </span>
      <button style={styles.button(color)} onClick={clearNotice}>
        {t("errors.close")}
      </button>
    </div>
  );
}
