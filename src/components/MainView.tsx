import { Suspense, lazy, useState } from "react";
import { AgentList } from "./AgentList";
import { LogViewer } from "./LogViewer";
import { SettingsView } from "./SettingsView";
import { StatusBar } from "./StatusBar";
import { useTranslation } from "../i18n";

// TerminalPanel 引入 xterm.js（~200KB），僅在使用者切到「終端機」分頁時才載入，
// 其他分頁啟動時不需等待 xterm 下載與初始化。
const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);

type TabId = "agents" | "terminal" | "logs" | "settings";

const styles = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    minHeight: 0,
  },
  tabBar: {
    display: "flex",
    background: "#181825",
    borderBottom: "2px solid #313244",
  },
  tab: (active: boolean) => ({
    padding: "8px 20px",
    background: active ? "#313244" : "transparent",
    color: active ? "#cdd6f4" : "#6c7086",
    border: "none",
    borderBottom: active ? "2px solid #89b4fa" : "2px solid transparent",
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

function TerminalFallback() {
  const t = useTranslation();
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      color: "#6c7086",
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

  const tabs: { id: TabId; label: string }[] = [
    { id: "agents", label: t("tabs.agents") },
    { id: "terminal", label: t("tabs.terminal") },
    { id: "logs", label: t("tabs.logs") },
    { id: "settings", label: t("tabs.settings") },
  ];

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
      <div style={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            style={styles.tab(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{
        ...styles.content,
        ...(activeTab === "terminal" ? { padding: 0, overflow: "hidden" } : {}),
      }}>{renderContent()}</div>
      <StatusBar />
    </div>
  );
}
