/**
 * # AgentList — 代理列表容器
 *
 * 以 `useShallow` 只訂閱 `sessionIds` 陣列 — 單一 agent 的工具/狀態
 * 變動不會讓列表本身重渲染。每個 [[AgentCard]] 用 `sessionId` 作 key
 * 與 prop，內部獨立訂閱自己的 agent 資料。
 *
 * ## 搜尋與排序
 *
 * 查詢是純文字子字串（不分大小寫）比對 projectName + sessionId；
 * 排序支援最近活動 (desc) 或專案名稱 (asc)。這兩個條件對應查詢/排序都
 * 在記憶體內完成，規模預期 O(10~100) agent。
 *
 * ## Details drawer
 *
 * 點擊 AgentCard 會開啟 [[AgentDetailsDrawer]] 顯示該 agent 完整資訊。
 */

import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore, type AgentInfo } from "../stores/agentStore";
import { AgentCard } from "./AgentCard";
import { AgentDetailsDrawer } from "./AgentDetailsDrawer";
import { useTranslation } from "../i18n";
import { useThemeColors } from "../theme";

type SortMode = "recent" | "name";

function useStyles() {
  const c = useThemeColors();
  return {
    container: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "8px",
      height: "100%",
    },
    filterBar: {
      display: "flex",
      gap: "8px",
      alignItems: "center",
      flexShrink: 0,
    },
    search: {
      flex: 1,
      padding: "6px 10px",
      background: c.bgSurface,
      border: `1px solid ${c.border}`,
      borderRadius: 0,
      color: c.text,
      fontSize: "12px",
      fontFamily: "monospace",
      outline: "none",
    },
    sortLabel: {
      color: c.textMuted,
      fontSize: "11px",
      fontFamily: "monospace",
    },
    sortSelect: {
      background: c.bgSurface,
      color: c.text,
      border: `1px solid ${c.border}`,
      borderRadius: 0,
      padding: "4px 8px",
      fontSize: "11px",
      fontFamily: "monospace",
      cursor: "pointer",
    },
    list: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "8px",
      overflow: "auto" as const,
      flex: 1,
      minHeight: 0,
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
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // 只訂閱 sessionId 陣列（shallow 比較）——單一 agent 的工具/狀態/活動更新
  // 不會替換此陣列，因此不觸發列表重渲染，符合本模組開頭的效能承諾。過濾/
  // 排序所需的 projectName / lastActivity 於重算時以 getState() 讀當下快照。
  const sessionIds = useAgentStore(
    useShallow((s) => Array.from(s.agents.keys())),
  );

  const filteredSortedIds = useMemo(() => {
    const store = useAgentStore.getState().agents;
    const q = query.trim().toLowerCase();
    const entries = sessionIds
      .map((id) => store.get(id))
      .filter((a): a is AgentInfo => !!a);
    const filtered = q
      ? entries.filter(
          (a) =>
            a.projectName.toLowerCase().includes(q) ||
            a.sessionId.toLowerCase().includes(q),
        )
      : entries;
    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === "recent") return b.lastActivity - a.lastActivity;
      return a.projectName.localeCompare(b.projectName);
    });
    return sorted.map((a) => a.sessionId);
  }, [sessionIds, query, sortMode]);

  // 傳給 drawer 的 onClose 用穩定參考，避免每次 render 產生新箭頭，導致
  // drawer 內依賴 onClose 的 effect 反覆重跑（焦點被搶回、listener 重綁）。
  const handleCloseDrawer = useCallback(() => setSelectedSessionId(null), []);

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
      <div style={styles.filterBar}>
        <input
          style={styles.search}
          type="text"
          placeholder={t("agents.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("agents.searchPlaceholder")}
        />
        <span style={styles.sortLabel}>{t("agents.sortBy")}</span>
        <select
          style={styles.sortSelect}
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          aria-label={t("agents.sortBy")}
        >
          <option value="recent">{t("agents.sortRecent")}</option>
          <option value="name">{t("agents.sortName")}</option>
        </select>
      </div>

      {filteredSortedIds.length === 0 ? (
        <div style={styles.emptyText}>{t("agents.noMatch")}</div>
      ) : (
        <div style={styles.list}>
          {filteredSortedIds.map((sessionId) => (
            <AgentCard
              key={sessionId}
              sessionId={sessionId}
              onSelect={setSelectedSessionId}
            />
          ))}
        </div>
      )}

      {selectedSessionId && (
        <AgentDetailsDrawer
          sessionId={selectedSessionId}
          onClose={handleCloseDrawer}
        />
      )}
    </div>
  );
}
