import { useState } from "react";
import { AgentList } from "./AgentList";
import { TerminalPanel } from "./TerminalPanel";
import { LogViewer } from "./LogViewer";
import { SettingsView } from "./SettingsView";
import { StatusBar } from "./StatusBar";

type TabId = "agents" | "terminal" | "logs" | "settings";

const TABS: { id: TabId; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "terminal", label: "Terminal" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];

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

export function MainView() {
  const [activeTab, setActiveTab] = useState<TabId>("agents");

  const renderContent = () => {
    switch (activeTab) {
      case "agents":
        return <AgentList />;
      case "terminal":
        return <TerminalPanel />;
      case "logs":
        return <LogViewer />;
      case "settings":
        return <SettingsView />;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.tabBar}>
        {TABS.map((tab) => (
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
