import { Suspense, lazy, useMemo, useState } from "react";
import { AgentList } from "./AgentList";
import { LogViewer } from "./LogViewer";
import { SettingsView } from "./SettingsView";
import { StatusBar } from "./StatusBar";
import { useTranslation } from "../i18n";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useConnectionStore } from "../stores/connectionStore";
import { disconnect as invokeDisconnect } from "../tauri-api";
import { useThemeColors } from "../theme";

// TerminalPanel 引入 xterm.js（~200KB），僅在使用者切到「終端機」分頁時才載入，
// 其他分頁啟動時不需等待 xterm 下載與初始化。
const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);

type TabId = "agents" | "terminal" | "logs" | "settings";

function useStyles() {
  const c = useThemeColors();
  return {
    container: {
      flex: 1,
      display: "flex",
      flexDirection: "column" as const,
      minHeight: 0,
    },
    tabBar: {
      display: "flex",
      background: c.bgSurface,
      borderBottom: `2px solid ${c.bgElevated}`,
    },
    tab: (active: boolean) => ({
      padding: "8px 20px",
      background: active ? c.bgElevated : "transparent",
      color: active ? c.text : c.textMuted,
      border: "none",
      borderBottom: active ? `2px solid ${c.accent}` : "2px solid transparent",
      cursor: "pointer",
      fontSize: "13px",
      fontFamily: "monospace",
      fontWeight: active ? 700 : 400,
      marginBottom: "-2px",
      borderRadius: 0,
    }),
    content: {
      flex: 1,
      overflow: "auto",
      padding: "16px",
    },
  } as const;
}

function TerminalFallback() {
  const t = useTranslation();
  const c = useThemeColors();
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      color: c.textMuted,
      fontFamily: "monospace",
      fontSize: "13px",
    }}>
      {t("terminal.loading")}
    </div>
  );
}

export function MainView() {
  const [activeTab, setActiveTab] = useState<TabId>("agents");
  const t = useTranslation();
  const styles = useStyles();

  const tabs: { id: TabId; label: string }[] = [
    { id: "agents", label: t("tabs.agents") },
    { id: "terminal", label: t("tabs.terminal") },
    { id: "logs", label: t("tabs.logs") },
    { id: "settings", label: t("tabs.settings") },
  ];

  // 全域鍵盤快捷鍵：Cmd/Ctrl + 1~4 切 tab、Cmd/Ctrl + D 中斷連線
  const shortcuts = useMemo(
    () => [
      { mod: true, key: "1", action: () => setActiveTab("agents"), description: "代理" },
      { mod: true, key: "2", action: () => setActiveTab("terminal"), description: "終端機" },
      { mod: true, key: "3", action: () => setActiveTab("logs"), description: "日誌" },
      { mod: true, key: "4", action: () => setActiveTab("settings"), description: "設定" },
      {
        mod: true,
        key: "d",
        action: () => {
          void invokeDisconnect().catch(() => {});
          useConnectionStore.getState().reset();
        },
        description: "中斷連線",
      },
    ],
    [],
  );
  useKeyboardShortcuts(shortcuts);

  const renderContent = () => {
    switch (activeTab) {
      case "agents":
        return <AgentList />;
      case "terminal":
        return (
          <Suspense fallback={<TerminalFallback />}>
            <TerminalPanel />
          </Suspense>
        );
      case "logs":
        return <LogViewer />;
      case "settings":
        return <SettingsView />;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.tabBar} role="tablist" aria-label={t("app.title")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            style={styles.tab(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        style={{
          ...styles.content,
          ...(activeTab === "terminal" ? { padding: 0, overflow: "hidden" } : {}),
        }}
      >
        {renderContent()}
      </div>
      <StatusBar />
    </div>
  );
}
