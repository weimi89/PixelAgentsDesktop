import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../stores/connectionStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  disconnect,
  loadConfig,
  getDiagnostics,
  listCrashes,
  clearCrashes,
  type DiagnosticsSnapshot,
  type CrashListing,
} from "../tauri-api";
import { invoke } from "@tauri-apps/api/core";
import { useLocaleStore, useTranslation, type LocaleCode } from "../i18n";
import { checkForUpdate, type UpdateCheckResult } from "../lib/updater";
import { useThemeStore, type ThemeMode } from "../theme";

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
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
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
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [crashes, setCrashes] = useState<CrashListing | null>(null);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "result"; result: UpdateCheckResult }
    | { kind: "installing" }
  >({ kind: "idle" });

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

  // Load diagnostics once on mount
  const refreshDiagnostics = () => {
    void getDiagnostics()
      .then((snap) => setDiagnostics(snap))
      .catch(() => setDiagnostics(null));
  };
  useEffect(() => {
    refreshDiagnostics();
  }, []);

  const refreshCrashes = () => {
    void listCrashes()
      .then((c) => setCrashes(c))
      .catch(() => setCrashes(null));
  };
  useEffect(() => {
    refreshCrashes();
  }, []);

  const handleOpenCrashFolder = () => {
    if (!crashes?.path) return;
    void invoke("plugin:shell|open", { path: crashes.path }).catch(() => {});
  };

  const handleClearCrashes = async () => {
    try {
      const res = await clearCrashes();
      setClearMessage(t("crashes.cleared", { n: res.moved }));
      refreshCrashes();
      setTimeout(() => setClearMessage(null), 3000);
    } catch {
      /* ignore */
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateState({ kind: "checking" });
    const result = await checkForUpdate();
    setUpdateState({ kind: "result", result });
  };

  const handleDownloadUpdate = async () => {
    if (updateState.kind !== "result" || updateState.result.kind !== "available") return;
    const { download } = updateState.result;
    setUpdateState({ kind: "installing" });
    try {
      await download();
      // relaunch 後這行不會執行；若 relaunch 失敗則把狀態還原
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateState({ kind: "result", result: { kind: "error", message: msg } });
    }
  };

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
            <option value="ja">{t("settingsExtra.languageJa")}</option>
          </select>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>{t("settingsExtra.theme")}</span>
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
            value={themeMode}
            onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
          >
            <option value="system">{t("settingsExtra.themeSystem")}</option>
            <option value="dark">{t("settingsExtra.themeDark")}</option>
            <option value="light">{t("settingsExtra.themeLight")}</option>
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

      {/* Diagnostics Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t("diagnostics.title")}</h3>
        {diagnostics ? (
          <>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.uptime")}</span>
              <span style={styles.value}>
                {diagnostics.uptimeSecs} {t("diagnostics.secondsUnit")}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.ipcRequests")}</span>
              <span style={styles.value}>{diagnostics.ipc.requestsTotal}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.ipcErrors")}</span>
              <span style={{ ...styles.value, color: diagnostics.ipc.requestErrors > 0 ? "#f38ba8" : undefined }}>
                {diagnostics.ipc.requestErrors}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.ipcEvents")}</span>
              <span style={styles.value}>{diagnostics.ipc.eventsReceived}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.sidecarSpawns")}</span>
              <span style={styles.value}>{diagnostics.sidecar.spawns}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.sidecarRestarts")}</span>
              <span style={{ ...styles.value, color: diagnostics.sidecar.restarts > 0 ? "#fab387" : undefined }}>
                {diagnostics.sidecar.restarts}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.sidecarCrashes")}</span>
              <span style={{ ...styles.value, color: diagnostics.sidecar.crashes > 0 ? "#f38ba8" : undefined }}>
                {diagnostics.sidecar.crashes}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("diagnostics.httpRetries")}</span>
              <span style={styles.value}>{diagnostics.http.retries}</span>
            </div>
            <div style={styles.rowLast}>
              <button style={styles.smallButton} onClick={refreshDiagnostics}>
                {t("diagnostics.refresh")}
              </button>
            </div>
          </>
        ) : (
          <span style={styles.emptyText}>{t("diagnostics.loading")}</span>
        )}
      </div>

      {/* Crash Logs Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t("crashes.title")}</h3>
        {crashes ? (
          <>
            <div style={styles.row}>
              <span style={styles.label}>{t("crashes.count", { n: crashes.count })}</span>
              {crashes.count > 0 ? (
                <span style={{ ...styles.value, color: "#f38ba8" }}>⚠ {crashes.count}</span>
              ) : (
                <span style={{ ...styles.value, color: "#a6e3a1" }}>{t("crashes.none")}</span>
              )}
            </div>
            <div style={styles.row}>
              <span style={styles.label}>{t("crashes.path")}</span>
              <span style={{ ...styles.value, fontSize: "11px", maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis" }} title={crashes.path}>
                {crashes.path}
              </span>
            </div>
            <div style={styles.rowLast}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {clearMessage && (
                  <span style={{ ...styles.value, color: "#a6e3a1", fontSize: "11px" }}>
                    {clearMessage}
                  </span>
                )}
                <button style={styles.smallButton} onClick={refreshCrashes}>
                  {t("crashes.refresh")}
                </button>
                <button style={styles.smallButton} onClick={handleOpenCrashFolder}>
                  {t("crashes.openFolder")}
                </button>
                {crashes.count > 0 && (
                  <button style={styles.smallButton} onClick={handleClearCrashes}>
                    {t("crashes.clear")}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <span style={styles.emptyText}>{t("diagnostics.loading")}</span>
        )}
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
          <UpdateStatus
            state={updateState}
            onCheck={handleCheckUpdate}
            onDownload={handleDownloadUpdate}
          />
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

interface UpdateStatusProps {
  state:
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "result"; result: UpdateCheckResult }
    | { kind: "installing" };
  onCheck: () => void;
  onDownload: () => void;
}

function UpdateStatus({ state, onCheck, onDownload }: UpdateStatusProps) {
  const t = useTranslation();
  const smallButton = {
    padding: "4px 10px",
    background: "#45475a",
    color: "#cdd6f4",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontWeight: 400,
    fontSize: "11px",
    fontFamily: "monospace",
  } as const;
  const text = {
    fontSize: "12px",
    color: "#a6adc8",
    fontFamily: "monospace",
  } as const;

  if (state.kind === "idle") {
    return (
      <button style={smallButton} onClick={onCheck}>
        {t("updater.check")}
      </button>
    );
  }
  if (state.kind === "checking") {
    return <span style={text}>{t("updater.checking")}</span>;
  }
  if (state.kind === "installing") {
    return <span style={text}>{t("updater.installing")}</span>;
  }
  // kind === "result"
  const r = state.result;
  switch (r.kind) {
    case "noUpdate":
      return <span style={{ ...text, color: "#a6e3a1" }}>{t("updater.upToDate")}</span>;
    case "notConfigured":
      return <span style={{ ...text, fontStyle: "italic" }}>{t("updater.notConfigured")}</span>;
    case "error":
      return (
        <span style={{ ...text, color: "#f38ba8" }}>
          {t("updater.error", { message: r.message })}
        </span>
      );
    case "available":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ ...text, color: "#fab387" }}>
            {t("updater.available", { version: r.version })}
          </span>
          <button style={smallButton} onClick={onDownload}>
            {t("updater.download")}
          </button>
        </div>
      );
  }
}
