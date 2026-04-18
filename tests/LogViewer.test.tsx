/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Virtuoso 在 happy-dom 中不會測量 ResizeObserver，mock 成簡單的 list 渲染
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data.map((item, i) => (
        <div key={i}>{itemContent(i, item)}</div>
      ))}
    </div>
  ),
}));

import { LogViewer } from "../src/components/LogViewer";
import { useLogStore } from "../src/stores/logStore";
import { useAgentStore } from "../src/stores/agentStore";
import { useLocaleStore } from "../src/i18n";

describe("LogViewer", () => {
  beforeEach(() => {
    useLogStore.getState().clearLogs();
    useAgentStore.getState().clearAgents();
    useLocaleStore.getState().setLocale("zh-TW");
  });

  it("無日誌時顯示空提示", () => {
    render(<LogViewer />);
    expect(screen.getByText("無日誌記錄")).toBeInTheDocument();
  });

  it("日誌存在時渲染每一筆", () => {
    act(() => {
      useLogStore.getState().addLog({
        timestamp: Date.now(),
        level: "info",
        source: "test",
        message: "Hello world",
      });
    });
    render(<LogViewer />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("[test]")).toBeInTheDocument();
  });

  it("按等級篩選只顯示符合條目", async () => {
    const user = userEvent.setup();
    act(() => {
      useLogStore.getState().addLog({
        timestamp: 1,
        level: "info",
        source: "s",
        message: "info-line",
      });
      useLogStore.getState().addLog({
        timestamp: 2,
        level: "error",
        source: "s",
        message: "error-line",
      });
    });
    render(<LogViewer />);

    // 預設顯示兩者
    expect(screen.getByText("info-line")).toBeInTheDocument();
    expect(screen.getByText("error-line")).toBeInTheDocument();

    // 篩選為 error
    const levelSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    await user.selectOptions(levelSelect, "error");
    expect(screen.queryByText("info-line")).not.toBeInTheDocument();
    expect(screen.getByText("error-line")).toBeInTheDocument();
  });

  it("來源篩選支援子字串不分大小寫", async () => {
    const user = userEvent.setup();
    act(() => {
      useLogStore.getState().addLog({
        timestamp: 1,
        level: "info",
        source: "Connection",
        message: "c-line",
      });
      useLogStore.getState().addLog({
        timestamp: 2,
        level: "info",
        source: "agent",
        message: "a-line",
      });
    });
    render(<LogViewer />);
    const input = screen.getByPlaceholderText("篩選來源...");
    await user.type(input, "conn");
    expect(screen.getByText("c-line")).toBeInTheDocument();
    expect(screen.queryByText("a-line")).not.toBeInTheDocument();
  });

  it("清除日誌按鈕重置 store", async () => {
    const user = userEvent.setup();
    act(() => {
      useLogStore.getState().addLog({
        timestamp: 1,
        level: "info",
        source: "s",
        message: "x",
      });
    });
    render(<LogViewer />);
    expect(useLogStore.getState().count).toBe(1);
    await user.click(screen.getByRole("button", { name: "清除日誌" }));
    expect(useLogStore.getState().count).toBe(0);
  });

  it("清除篩選按鈕重置所有篩選", async () => {
    const user = userEvent.setup();
    act(() => {
      useLogStore.getState().addLog({
        timestamp: 1,
        level: "info",
        source: "s",
        message: "line",
      });
    });
    render(<LogViewer />);
    // 設定一個篩選
    const input = screen.getByPlaceholderText("篩選來源...") as HTMLInputElement;
    await user.type(input, "xxx");
    expect(input.value).toBe("xxx");
    // 清除
    await user.click(screen.getByRole("button", { name: "清除篩選" }));
    expect(input.value).toBe("");
  });

  it("代理下拉選單列出所有已知 agent", () => {
    act(() => {
      useAgentStore.getState().addAgent("s1", {
        sessionId: "s1",
        projectName: "proj-a",
        tools: [],
        status: "idle",
        lastActivity: 0,
      });
      useAgentStore.getState().addAgent("s2", {
        sessionId: "s2",
        projectName: "proj-b",
        tools: [],
        status: "idle",
        lastActivity: 0,
      });
      useLogStore.getState().addLog({
        timestamp: 1,
        level: "info",
        source: "s",
        message: "x",
      });
    });
    render(<LogViewer />);
    expect(screen.getByText("proj-a")).toBeInTheDocument();
    expect(screen.getByText("proj-b")).toBeInTheDocument();
  });

  it("匯出按鈕使用 URL.createObjectURL 並觸發 <a>.click", async () => {
    const user = userEvent.setup();
    // happy-dom 可能不完整支援 Blob URL；改 stub
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    act(() => {
      useLogStore.getState().addLog({
        timestamp: 1,
        level: "info",
        source: "s",
        message: "x",
      });
    });
    render(<LogViewer />);
    await user.click(screen.getByRole("button", { name: "匯出" }));
    expect(createUrl).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalled();
  });
});
