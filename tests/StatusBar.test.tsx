/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { StatusBar } from "../src/components/StatusBar";
import { useConnectionStore } from "../src/stores/connectionStore";
import { useSystemStore } from "../src/stores/systemStore";
import { useLocaleStore } from "../src/i18n";

describe("StatusBar", () => {
  beforeEach(() => {
    useConnectionStore.getState().reset();
    useSystemStore.getState().clearNotice();
    useSystemStore.getState().setSidecarVersion(null);
    useLocaleStore.getState().setLocale("zh-TW");
  });

  it("未連線時顯示「未連線」", () => {
    render(<StatusBar />);
    expect(screen.getByText("未連線")).toBeInTheDocument();
  });

  it("connecting 狀態顯示「連線中」", () => {
    act(() => {
      useConnectionStore.getState().setStatus("connecting");
    });
    render(<StatusBar />);
    expect(screen.getByText("連線中")).toBeInTheDocument();
  });

  it("已連線時顯示 server URL 按鈕與中斷連線按鈕", () => {
    act(() => {
      useConnectionStore.getState().setStatus("connected");
      useConnectionStore.getState().setServerUrl("https://x.example.com");
    });
    render(<StatusBar />);
    expect(screen.getByText("已連線")).toBeInTheDocument();
    expect(screen.getByText("https://x.example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中斷連線" })).toBeInTheDocument();
  });

  it("顯示延遲 ms", () => {
    act(() => {
      useConnectionStore.getState().setLatency(42);
    });
    render(<StatusBar />);
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("無延遲時顯示 --", () => {
    render(<StatusBar />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("顯示 agentCount", () => {
    act(() => {
      useConnectionStore.getState().setAgentCount(3);
    });
    render(<StatusBar />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("錯誤訊息會顯示於 bar", () => {
    act(() => {
      useConnectionStore.getState().setError("timeout");
    });
    render(<StatusBar />);
    expect(screen.getByText("timeout")).toBeInTheDocument();
  });

  it("sidecarVersion 設定後顯示版本", () => {
    act(() => {
      useSystemStore.getState().setSidecarVersion("1.2.3");
    });
    render(<StatusBar />);
    expect(screen.getByText("sidecar v1.2.3")).toBeInTheDocument();
  });

  it("en locale 下顯示英文標籤", () => {
    useLocaleStore.getState().setLocale("en");
    act(() => {
      useConnectionStore.getState().setStatus("connected");
      useConnectionStore.getState().setServerUrl("https://x");
    });
    render(<StatusBar />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("點擊中斷連線呼叫 disconnect_server 並 reset store", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(undefined);
    act(() => {
      useConnectionStore.getState().setStatus("connected");
      useConnectionStore.getState().setServerUrl("https://x");
    });
    render(<StatusBar />);
    fireEvent.click(screen.getByRole("button", { name: "中斷連線" }));
    // 等 async 完成
    await new Promise((r) => setTimeout(r, 10));
    expect(invoke).toHaveBeenCalledWith("disconnect_server");
    expect(useConnectionStore.getState().status).toBe("disconnected");
  });
});
