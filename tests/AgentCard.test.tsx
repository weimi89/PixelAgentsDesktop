/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AgentCard } from "../src/components/AgentCard";
import { useAgentStore } from "../src/stores/agentStore";
import { useLocaleStore } from "../src/i18n";

describe("AgentCard", () => {
  beforeEach(() => {
    useAgentStore.getState().clearAgents();
    useLocaleStore.getState().setLocale("zh-TW");
  });

  it("不存在的 sessionId 渲染為 null", () => {
    const { container } = render(<AgentCard sessionId="nope" />);
    expect(container.firstChild).toBeNull();
  });

  it("顯示專案名稱與截斷的 session id", () => {
    act(() => {
      useAgentStore.getState().addAgent("abcdefgh12345678", {
        sessionId: "abcdefgh12345678",
        projectName: "my-project",
        tools: [],
        status: "idle",
        lastActivity: 0,
      });
    });
    render(<AgentCard sessionId="abcdefgh12345678" />);
    expect(screen.getByText("my-project")).toBeInTheDocument();
    // 長 id 應被截斷為前 8 + "..."
    expect(screen.getByText("abcdefgh...")).toBeInTheDocument();
  });

  it("active 狀態時 status dot 顏色為綠色", () => {
    act(() => {
      useAgentStore.getState().addAgent("s1", {
        sessionId: "s1",
        projectName: "p",
        tools: [],
        status: "active",
        lastActivity: 0,
      });
    });
    const { container } = render(<AgentCard sessionId="s1" />);
    // 綠色 #a6e3a1；happy-dom 對 hex/RGB 的處理可能不同，兩者都試
    const styles = Array.from(container.querySelectorAll("div")).map(
      (el) => el.getAttribute("style") ?? "",
    );
    const hasGreenDot = styles.some(
      (s) =>
        s.includes("#a6e3a1") ||
        s.toLowerCase().includes("rgb(166, 227, 161)"),
    );
    expect(hasGreenDot).toBe(true);
  });

  it("有工具時顯示工具 badge", () => {
    act(() => {
      useAgentStore.getState().addAgent("s1", {
        sessionId: "s1",
        projectName: "p",
        tools: [
          { toolId: "t1", toolName: "Read", toolStatus: "running", startedAt: Date.now() },
        ],
        status: "active",
        lastActivity: Date.now(),
      });
    });
    render(<AgentCard sessionId="s1" />);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("lastActivity > 0 時顯示「最後活動:」", () => {
    act(() => {
      useAgentStore.getState().addAgent("s1", {
        sessionId: "s1",
        projectName: "p",
        tools: [],
        status: "idle",
        lastActivity: Date.now(),
      });
    });
    render(<AgentCard sessionId="s1" />);
    expect(screen.getByText(/最後活動/)).toBeInTheDocument();
  });

  it("en locale 顯示 英文「Last activity:」", () => {
    useLocaleStore.getState().setLocale("en");
    act(() => {
      useAgentStore.getState().addAgent("s1", {
        sessionId: "s1",
        projectName: "p",
        tools: [],
        status: "idle",
        lastActivity: Date.now(),
      });
    });
    render(<AgentCard sessionId="s1" />);
    expect(screen.getByText(/Last activity/)).toBeInTheDocument();
  });
});
