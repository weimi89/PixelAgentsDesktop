/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 所有 Tauri invoke 都要 mock — SettingsView 會呼叫多個命令
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { SettingsView } from "../src/components/SettingsView";
import { useSettingsStore } from "../src/stores/settingsStore";
import { useConnectionStore } from "../src/stores/connectionStore";
import { useLocaleStore } from "../src/i18n";
import { useThemeStore } from "../src/theme";

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.getState().reset();
    useLocaleStore.getState().setLocale("zh-TW");
    useThemeStore.getState().setMode("system");

    // 預設 invoke 返回：getDiagnostics / listCrashes 給 stub
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "load_config") return null;
      if (cmd === "plugin:autostart|is_enabled") return false;
      if (cmd === "get_diagnostics") {
        return {
          uptimeSecs: 42,
          ipc: { requestsTotal: 5, requestErrors: 0, eventsReceived: 3 },
          sidecar: { spawns: 1, restarts: 0, crashes: 0 },
          http: { retries: 0 },
        };
      }
      if (cmd === "list_crashes") {
        return { count: 0, path: "/tmp/crashes", entries: [] };
      }
      return null;
    });
  });

  it("渲染所有主要 section 標題", async () => {
    render(<SettingsView />);
    // 等 async effect settle
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("連線")).toBeInTheDocument();
    expect(screen.getByText("掃描")).toBeInTheDocument();
    expect(screen.getByText("應用程式")).toBeInTheDocument();
    expect(screen.getByText("診斷")).toBeInTheDocument();
    expect(screen.getByText("崩潰紀錄")).toBeInTheDocument();
    expect(screen.getByText("關於")).toBeInTheDocument();
  });

  it("server URL 未設定時顯示「未設定」", async () => {
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("未設定")).toBeInTheDocument();
  });

  it("語言下拉可切換至英文", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 20));
    const selects = screen.getAllByRole("combobox");
    const languageSelect = selects.find(
      (el) => (el as HTMLSelectElement).value === "zh-TW",
    ) as HTMLSelectElement;
    expect(languageSelect).toBeDefined();
    await user.selectOptions(languageSelect, "en");
    expect(useLocaleStore.getState().locale).toBe("en");
  });

  it("主題下拉可切換至 dark", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 20));
    // theme 下拉在語言下拉之後
    const themeSelect = screen
      .getAllByRole("combobox")
      .find((el) => (el as HTMLSelectElement).value === "system") as HTMLSelectElement;
    await user.selectOptions(themeSelect, "dark");
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  it("掃描間隔滑桿拖動更新 store", async () => {
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 20));
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "5" } });
    expect(useSettingsStore.getState().scanIntervalMs).toBe(5000);
  });

  it("診斷區顯示 uptime 值", async () => {
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("Crash 數 0 時顯示「無崩潰紀錄」", async () => {
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText("無崩潰紀錄")).toBeInTheDocument();
  });

  it("更新按鈕預設顯示「檢查更新」", async () => {
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("button", { name: "檢查更新" })).toBeInTheDocument();
  });

  it("登出按鈕呼叫 disconnect_server + logout 並重置 store", async () => {
    const user = userEvent.setup();
    act(() => {
      useConnectionStore.getState().setStatus("connected");
      useConnectionStore.getState().setServerUrl("https://x");
    });
    render(<SettingsView />);
    await new Promise((r) => setTimeout(r, 20));
    await user.click(screen.getByRole("button", { name: "登出" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(invoke).toHaveBeenCalledWith("disconnect_server");
    expect(invoke).toHaveBeenCalledWith("logout");
    expect(useConnectionStore.getState().status).toBe("disconnected");
  });
});
