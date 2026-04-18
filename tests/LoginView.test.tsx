/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock Tauri invoke — 必須在 import LoginView 前 hoist
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import { LoginView } from "../src/components/LoginView";
import { useConnectionStore } from "../src/stores/connectionStore";
import { useLocaleStore } from "../src/i18n";

describe("LoginView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.getState().reset();
    useLocaleStore.getState().setLocale("zh-TW");
  });

  it("預設顯示 API 金鑰模式", () => {
    render(<LoginView />);
    expect(screen.getByLabelText("API 金鑰")).toBeInTheDocument();
    // 密碼模式不應可見
    expect(screen.queryByLabelText("使用者名稱")).not.toBeInTheDocument();
  });

  it("切換至密碼模式後顯示使用者名稱/密碼欄位", async () => {
    const user = userEvent.setup();
    render(<LoginView />);
    await user.click(screen.getByRole("radio", { name: "密碼" }));
    expect(screen.getByLabelText("使用者名稱")).toBeInTheDocument();
    expect(screen.getByLabelText("密碼")).toBeInTheDocument();
  });

  it("顯示/隱藏 API 金鑰切換改變 input type", async () => {
    const user = userEvent.setup();
    render(<LoginView />);
    const input = screen.getByLabelText("API 金鑰") as HTMLInputElement;
    expect(input.type).toBe("password");
    const toggle = screen.getByRole("button", { name: "顯示" });
    await user.click(toggle);
    expect(input.type).toBe("text");
  });

  it("空 API 金鑰時連線按鈕 disabled", () => {
    render(<LoginView />);
    const button = screen.getByRole("button", { name: "連線" });
    expect(button).toBeDisabled();
  });

  it("填入 API 金鑰後呼叫 invoke connect_server", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockResolvedValue({});
    render(<LoginView />);

    const apiKeyInput = screen.getByLabelText("API 金鑰");
    await user.type(apiKeyInput, "my-secret-key");

    const button = screen.getByRole("button", { name: "連線" });
    expect(button).toBeEnabled();
    await user.click(button);

    // connect_server 應以 apiKey 作為 token 送出
    expect(invoke).toHaveBeenCalledWith("connect_server", {
      serverUrl: "https://localhost:3000",
      token: "my-secret-key",
    });
  });

  it("連線失敗時顯示錯誤訊息", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockRejectedValue(new Error("Connection refused"));
    render(<LoginView />);
    await user.type(screen.getByLabelText("API 金鑰"), "key");
    await user.click(screen.getByRole("button", { name: "連線" }));
    // 等待非同步 catch 分支
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Connection refused");
  });

  it("語言切換至 en 後 UI 以英文呈現", () => {
    useLocaleStore.getState().setLocale("en");
    render(<LoginView />);
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("按 Enter 送出表單", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockResolvedValue({});
    render(<LoginView />);
    const apiKeyInput = screen.getByLabelText("API 金鑰");
    await user.type(apiKeyInput, "k{Enter}");
    // 表單 onSubmit 應觸發 connect
    expect(invoke).toHaveBeenCalled();
  });

  it("密碼模式：loginServer 成功後以返回的 token 呼叫 connect_server", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "login_server") {
        return { ok: true, token: "abc-token", username: "alice" };
      }
      if (cmd === "connect_server") return {};
      return null;
    });

    render(<LoginView />);
    await user.click(screen.getByRole("radio", { name: "密碼" }));
    await user.type(screen.getByLabelText("使用者名稱"), "alice");
    await user.type(screen.getByLabelText("密碼"), "pw");
    await user.click(screen.getByRole("button", { name: "連線" }));

    // Allow the async handler to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(invoke).toHaveBeenCalledWith("login_server", {
      serverUrl: "https://localhost:3000",
      username: "alice",
      password: "pw",
    });
    expect(invoke).toHaveBeenCalledWith("connect_server", {
      serverUrl: "https://localhost:3000",
      token: "abc-token",
    });
  });
});
