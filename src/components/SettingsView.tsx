import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../stores/connectionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { disconnect, loadConfig } from "../tauri-api";
import { invoke } from "@tauri-apps/api/core";
import { useLocaleStore, useTranslation, type LocaleCode } from "../i18n";

const APP_VERSION = "0.1.0";
const GITHUB_URL = "https://github.com/nicepkg/pixel-agents-desktop";

const styles = {
  container: {
    maxWidth: 600,
    margin: "0 auto",
  },
  section: {
    marginBottom: "24px",
    background: "#181825",
    border: "2px solid #313244",
    borderRadius: 0,
    padding: "16px",
  },
  sectionTitle: {
    fontSize: "14px",
    fontWeight: 700,
    color: "#89b4fa",
    margin: "0 0 12px 0",
    fontFamily: "monospace",
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid #313244",
  },
  rowLast: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
  },
  label: {
    fontSize: "13px",
    color: "#cdd6f4",
    fontFamily: "monospace",
  },
  value: {
    fontSize: "13px",
    color: "#a6adc8",
    fontFamily: "monospace",
  },
  input: {
    padding: "4px 8px",
    background: "#1e1e2e",
    border: "2px solid #45475a",
    borderRadius: 0,
    color: "#cdd6f4",
    fontSize: "13px",
    fontFamily: "monospace",
    outline: "none",
    width: "200px",
    boxSizing: "border-box" as const,
  },
  button: {
    padding: "6px 14px",
    background: "#89b4fa",
    color: "#1e1e2e",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    fontFamily: "monospace",
  },
  dangerButton: {
    padding: "6px 14px",
    background: "#f38ba8",
    color: "#1e1e2e",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    fontFamily: "monospace",
  },
  smallButton: {
    padding: "4px 10px",
    background: "#45475a",
    color: "#cdd6f4",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontWeight: 400,
    fontSize: "11px",
    fontFamily: "monospace",
  },
  removeButton: {
    padding: "2px 8px",
    background: "#45475a",
    color: "#f38ba8",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontSize: "11px",
    fontFamily: "monospace",
    marginLeft: "8px",
  },
  checkbox: {
    marginRight: "8px",
    accentColor: "#89b4fa",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 0",
    cursor: "pointer",
  },
  sliderContainer: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  slider: {
    width: "120px",
    accentColor: "#89b4fa",
  },
  sliderValue: {
    fontSize: "13px",
    color: "#89b4fa",
    fontFamily: "monospace",
    fontWeight: 700,
    minWidth: "30px",
    textAlign: "right" as const,
  },
  tag: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    background: "#313244",
    border: "1px solid #45475a",
    borderRadius: 0,
    fontSize: "12px",
    fontFamily: "monospace",
    color: "#cdd6f4",
    margin: "2px 4px 2px 0",
  },
  tagList: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "4px",
    marginTop: "8px",
  },
  addRow: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  },
  link: {
    color: "#89b4fa",
    textDecoration: "none",
    fontSize: "13px",
    fontFamily: "monospace",
    cursor: "pointer",
  },
  emptyText: {
    fontSize: "12px",
    color: "#6c7086",
    fontFamily: "monospace",
    fontStyle: "italic" as const,
  },
} as const;

export function SettingsView() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  // 只訂閱需要的欄位，避免其他 connection state 變化（例如 latency 更新）
  // 造成整個設定畫面重渲染
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const {
    scanIntervalMs,
    excludedProjects,
    autoStart,
    startMinimized,
    loaded,
    setScanInterval,
    addExcludedProject,
    removeExcludedProject,
    setStartMinimized,
    loadSettings,
  } = useSettingsStore(
    useShallow((s) => ({
      scanIntervalMs: s.scanIntervalMs,
      excludedProjects: s.excludedProjects,
      autoStart: s.autoStart,
      startMinimized: s.startMinimized,
      loaded: s.loaded,
      setScanInterval: s.setScanInterval,
      addExcludedProject: s.addExcludedProject,
      removeExcludedProject: s.removeExcludedProject,
      setStartMinimized: s.setStartMinimized,
      loadSettings: s.loadSettings,
    })),
  );
  const setAutoStart = useSettingsStore((s) => s.setAutoStart);

  const [newExcluded, setNewExcluded] = useState("");
  const [configUsername, setConfigUsername] = useState<string | null>(null);
  const [autoStartEnabled, setAutoStartEnabled] = useState<boolean | null>(null);

  // Load settings on mount
  useEffect(() => {
    if (!loaded) {
      void loadSettings();
    }
  }, [loaded, loadSettings]);

  // Load username from config
  useEffect(() => {
    void loadConfig().then((config) => {
      // Rust writes { server, token }; show connection flag based on `server`.
      setConfigUsername(config?.server ? "connected" : null);
    }).catch(() => {});
  }, []);

  // Sync autostart plugin state
  useEffect(() => {
    void invoke("plugin:autostart|is_enabled")
      .then((enabled) => setAutoStartEnabled(enabled as boolean))
      .catch(() => setAutoStartEnabled(null));
  }, []);

  const handleLogout = async () => {
    try {
      await disconnect();
      // Delete config file via save with empty values
      await invoke("logout");
    } catch (err) {
      console.error("Logout failed:", err);
    }
    // Reset connection store to force back to login
    useConnectionStore.getState().reset();
  };

  const handleAddExcluded = () => {
    const trimmed = newExcluded.trim();
    if (trimmed && !excludedProjects.includes(trimmed)) {
      addExcludedProject(trimmed);
      setNewExcluded("");
    }
  };

  const handleAutoStartToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        await invoke("plugin:autostart|enable");
      } else {
        await invoke("plugin:autostart|disable");
      }
      setAutoStartEnabled(enabled);
      setAutoStart(enabled);
    } catch (err) {
      console.error("Failed to toggle autostart:", err);
    }
  };

  const scanIntervalSec = scanIntervalMs / 1000;

  return (
    <div style={styles.container}>
      {/* Connection Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t("settings.connection")}</h3>
        <div style={styles.row}>
          <span style={styles.label}>{t("settings.serverUrl")}</span>
          <span style={styles.value}>{serverUrl || t("settings.notConfigured")}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>{t("settings.statusLabel")}</span>
          <span style={{ ...styles.value, color: configUsername ? "#a6e3a1" : "#f38ba8" }}>
            {configUsername ? t("settings.statusConnected") : t("settings.statusDisconnected")}
          </span>
        </div>
        <div style={styles.rowLast}>
          <span style={styles.label}>{t("settings.session")}</span>
          <button style={styles.dangerButton} onClick={handleLogout}>
            {t("settings.logout")}
          </button>
        </div>
      </div>

      {/* Scanning Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t("settings.scan")}</h3>
        <div style={styles.row}>
          <span style={styles.label}>{t("settings.scanInterval")}</span>
          <div style={styles.sliderContainer}>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={scanIntervalSec}
              onChange={(e) => setScanInterval(Number(e.target.value) * 1000)}
              style={styles.slider}
            />
            <span style={styles.sliderValue}>{scanIntervalSec}s</span>
          </div>
        </div>
        <div style={{ padding: "8px 0" }}>
          <span style={styles.label}>{t("settings.excludedProjects")}</span>
          {excludedProjects.length === 0 ? (
            <div style={{ ...styles.tagList }}>
              <span style={styles.emptyText}>{t("settings.noExcluded")}</span>
            </div>
          ) : (
            <div style={styles.tagList}>
              {excludedProjects.map((project) => (
                <span key={project} style={styles.tag}>
                  {project}
                  <button
                    style={styles.removeButton}
                    onClick={() => removeExcludedProject(project)}
                    title={t("settings.remove")}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={styles.addRow}>
            <input
              style={styles.input}
              type="text"
              placeholder={t("settings.excludedPlaceholder")}
              value={newExcluded}
              onChange={(e) => setNewExcluded(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddExcluded();
              }}
            />
            <button style={styles.smallButton} onClick={handleAddExcluded}>
              {t("settings.add")}
            </button>
          </div>
        </div>
      </div>

      {/* Application Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t("settings.application")}</h3>
        <div style={styles.row}>
          <span style={styles.label}>{t("settingsExtra.language")}</span>
          <select
            style={{
              background: "#1e1e2e",
              color: "#cdd6f4",
              border: "2px solid #45475a",
              borderRadius: 0,
              padding: "4px 8px",
              fontFamily: "monospace",
              fontSize: "12px",
              cursor: "pointer",
            }}
            value={locale}
            onChange={(e) => setLocale(e.target.value as LocaleCode)}
          >
            <option value="zh-TW">{t("settingsExtra.languageZh")}</option>
            <option value="en">{t("settingsExtra.languageEn")}</option>
          </select>
        </div>
        <div
          style={{
            ...styles.checkboxRow,
            cursor: autoStartEnabled === null ? "wait" : "pointer",
            opacity: autoStartEnabled === null ? 0.6 : 1,
          }}
          onClick={() => {
            // 初始讀取尚未完成時禁止觸發，避免以 store 的預設值切換實際系統狀態
            if (autoStartEnabled === null) return;
            void handleAutoStartToggle(!autoStartEnabled);
          }}
        >
          <input
            type="checkbox"
            style={styles.checkbox}
            checked={autoStartEnabled ?? false}
            disabled={autoStartEnabled === null}
            onChange={() => {}}
          />
          <span style={styles.label}>{t("settings.autoStart")}</span>
        </div>
        <div
          style={styles.checkboxRow}
          onClick={() => setStartMinimized(!startMinimized)}
        >
          <input
            type="checkbox"
            style={styles.checkbox}
            checked={startMinimized}
            onChange={() => {}}
          />
          <span style={styles.label}>{t("settings.startMinimized")}</span>
        </div>
      </div>

      {/* About Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t("settings.about")}</h3>
        <div style={styles.row}>
          <span style={styles.label}>{t("settings.version")}</span>
          <span style={styles.value}>v{APP_VERSION}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>{t("settings.update")}</span>
          <span style={{ ...styles.value, color: "#6c7086", fontStyle: "italic" }}>
            {t("settings.updateUnsupported")}
          </span>
        </div>
        <div style={styles.rowLast}>
          <span style={styles.label}>{t("settings.sourceCode")}</span>
          <a
            style={styles.link}
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              void invoke("plugin:shell|open", { path: GITHUB_URL }).catch(() => {
                window.open(GITHUB_URL, "_blank");
              });
            }}
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
