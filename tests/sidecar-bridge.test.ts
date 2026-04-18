import { describe, it, expect, vi, beforeEach } from "vitest";

// Socket.IO client 需要 mock — Bridge 會嘗試建立 socket 連線
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    io: { on: vi.fn() },
    get connected() {
      return false;
    },
  })),
}));

// fs.watch 會嘗試開啟真實檔案；大部分測試避免走到這條路徑。
// 不 mock fs 避免影響其他使用 fs 的測試。

import { Bridge } from "../sidecar/src/bridge";
import type { IpcEvent } from "../sidecar/src/ipcProtocol";

describe("Bridge 生命週期", () => {
  let events: IpcEvent[] = [];
  let bridge: Bridge;

  beforeEach(() => {
    events = [];
    bridge = new Bridge((evt) => events.push(evt));
  });

  it("初始狀態 connected=false、agents 為空", () => {
    const status = bridge.getStatus();
    expect(status.connected).toBe(false);
    expect(status.agents).toEqual([]);
  });

  it("未呼叫 connect 前 updateScanInterval 不拋錯", () => {
    expect(() => bridge.updateScanInterval(2000)).not.toThrow();
  });

  it("未呼叫 connect 前 updateExcludedProjects 不拋錯", () => {
    expect(() => bridge.updateExcludedProjects(["skip-me"])).not.toThrow();
  });

  it("disconnect 不拋錯且清空狀態", () => {
    bridge.disconnect();
    const status = bridge.getStatus();
    expect(status.connected).toBe(false);
    expect(status.agents).toEqual([]);
  });

  it("destroy 呼叫後仍可 getStatus（不崩潰）", () => {
    bridge.destroy();
    expect(() => bridge.getStatus()).not.toThrow();
  });

  it("未連線時 terminal* 方法不拋錯", () => {
    expect(() => bridge.terminalInput("s1", "x")).not.toThrow();
    expect(() => bridge.terminalResize("s1", 80, 24)).not.toThrow();
    expect(() => bridge.terminalDetach("s1")).not.toThrow();
  });
});
