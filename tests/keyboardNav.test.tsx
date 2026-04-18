/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
// 避免載入真實 TerminalPanel（含 xterm）
vi.mock("../src/components/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel-stub">terminal</div>,
}));
// Virtuoso 同樣簡化
vi.mock("react-virtuoso", () => ({
  Virtuoso: () => <div />,
}));

import { MainView } from "../src/components/MainView";
import { useLocaleStore } from "../src/i18n";
import { useConnectionStore } from "../src/stores/connectionStore";

describe("MainView 鍵盤可操作性", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLocale("zh-TW");
    useConnectionStore.getState().reset();
    useConnectionStore.getState().setStatus("connected");
  });

  it("tab 列上每個 button 都有正確的 role/aria-selected", () => {
    render(<MainView />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    // 預設第一個 tab selected
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });

  it("點擊 tab 切換 aria-selected", async () => {
    const user = userEvent.setup();
    render(<MainView />);
    const tabs = screen.getAllByRole("tab");
    await user.click(tabs[2]!); // 日誌
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });

  it("tabpanel 由對應 tab 的 aria-controls 指向", () => {
    render(<MainView />);
    const tabs = screen.getAllByRole("tab");
    const selectedTab = tabs.find(
      (t) => t.getAttribute("aria-selected") === "true",
    );
    const controlsId = selectedTab?.getAttribute("aria-controls");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", controlsId);
  });

  it("非 selected tab 的 tabIndex 為 -1 以符合 roving tabindex 模式", () => {
    render(<MainView />);
    const tabs = screen.getAllByRole("tab");
    const selected = tabs.filter(
      (t) => t.getAttribute("aria-selected") === "true",
    );
    const unselected = tabs.filter(
      (t) => t.getAttribute("aria-selected") === "false",
    );
    expect(selected[0]).toHaveAttribute("tabindex", "0");
    for (const u of unselected) {
      expect(u).toHaveAttribute("tabindex", "-1");
    }
  });

  it("Cmd+2 快捷鍵切換到終端機分頁", () => {
    render(<MainView />);
    fireEvent.keyDown(window, { key: "2", metaKey: true });
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  });
});
