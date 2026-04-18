/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.useFakeTimers();

import { NoticeBanner } from "../src/components/NoticeBanner";
import { useSystemStore } from "../src/stores/systemStore";
import { useLocaleStore } from "../src/i18n";

describe("NoticeBanner", () => {
  beforeEach(() => {
    useSystemStore.getState().clearNotice();
    useLocaleStore.getState().setLocale("zh-TW");
  });

  it("無 notice 時不渲染任何內容", () => {
    const { container } = render(<NoticeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("顯示 info 訊息並有 role=status", () => {
    act(() => {
      useSystemStore.getState().setNotice({ level: "info", message: "Hello" });
    });
    render(<NoticeBanner />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Hello");
  });

  it("error 訊息使用 role=alert 並為 assertive", () => {
    act(() => {
      useSystemStore.getState().setNotice({
        level: "error",
        message: "Something broke",
      });
    });
    render(<NoticeBanner />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("點擊關閉按鈕清除通知", () => {
    act(() => {
      useSystemStore.getState().setNotice({ level: "info", message: "x" });
    });
    render(<NoticeBanner />);
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(useSystemStore.getState().notice).toBeNull();
  });

  it("非 fatal 通知 8 秒後自動消失", () => {
    act(() => {
      useSystemStore.getState().setNotice({ level: "warn", message: "transient" });
    });
    render(<NoticeBanner />);
    expect(screen.getByText("transient")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(8100);
    });
    expect(useSystemStore.getState().notice).toBeNull();
  });

  it("fatal 通知不自動消失", () => {
    act(() => {
      useSystemStore.getState().setNotice({
        level: "error",
        message: "fatal error",
        fatal: true,
      });
    });
    render(<NoticeBanner />);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(useSystemStore.getState().notice).not.toBeNull();
  });
});
