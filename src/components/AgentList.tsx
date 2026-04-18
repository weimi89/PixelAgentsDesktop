/**
 * # AgentList — 代理列表容器
 *
 * 以 `useShallow` 只訂閱 `sessionIds` 陣列 — 單一 agent 的工具/狀態
 * 變動不會讓列表本身重渲染。每個 [[AgentCard]] 用 `sessionId` 作 key
 * 與 prop，內部獨立訂閱自己的 agent 資料。
 */

import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "../stores/agentStore";
import { AgentCard } from "./AgentCard";
import { useTranslation } from "../i18n";
import { useThemeColors } from "../theme";

function useStyles() {
  const c = useThemeColors();
  return {
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
      color: c.border,
      fontFamily: "monospace",
    },
    emptyText: {
      color: c.textMuted,
      fontSize: "13px",
      fontFamily: "monospace",
      textAlign: "center" as const,
      lineHeight: "1.5",
    },
  } as const;
}

export function AgentList() {
  const t = useTranslation();
  const styles = useStyles();
  // 只訂閱 sessionId 陣列 — 單一 agent 的 tool/狀態變化不會讓 AgentList 重渲染；
  // useShallow 以淺比較避免每次返回新 array 引用導致誤判更新。
  const sessionIds = useAgentStore(
    useShallow((s) => Array.from(s.agents.keys())),
  );

  if (sessionIds.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>[  ]</div>
        <div style={styles.emptyText}>
          {t("agents.emptyTitle")}
          <br />
          {t("agents.emptyHint")}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {sessionIds.map((sessionId) => (
        <AgentCard key={sessionId} sessionId={sessionId} />
      ))}
    </div>
  );
}
