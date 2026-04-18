import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AgentTracker } from "../sidecar/src/agentTracker";
import type { AgentNodeEvent } from "../shared/protocol";

describe("AgentTracker", () => {
  let tmpDir: string;
  let jsonlFile: string;
  let events: AgentNodeEvent[];
  let tracker: AgentTracker;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-tracker-test-"));
    jsonlFile = path.join(tmpDir, "session.jsonl");
    events = [];
    tracker = new AgentTracker((evt) => events.push(evt));
  });

  afterEach(async () => {
    tracker.destroy();
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignored */
    }
  });

  it("startTracking 發出 agentStarted 事件", () => {
    fs.writeFileSync(jsonlFile, "");
    tracker.startTracking("s1", jsonlFile, tmpDir, "my-project");
    expect(events.some((e) => e.type === "agentStarted" && e.sessionId === "s1")).toBe(true);
  });

  it("同一 sessionId 多次 startTracking 只追蹤一次", () => {
    fs.writeFileSync(jsonlFile, "");
    tracker.startTracking("s1", jsonlFile, tmpDir, "p");
    tracker.startTracking("s1", jsonlFile, tmpDir, "p");
    const starts = events.filter((e) => e.type === "agentStarted");
    expect(starts.length).toBe(1);
  });

  it("stopTracking 發出 agentStopped 事件", () => {
    fs.writeFileSync(jsonlFile, "");
    tracker.startTracking("s1", jsonlFile, tmpDir, "p");
    tracker.stopTracking("s1");
    expect(events.some((e) => e.type === "agentStopped")).toBe(true);
  });

  it("stopTracking 對不存在 sessionId 不拋錯", () => {
    expect(() => tracker.stopTracking("missing")).not.toThrow();
  });

  it("getTrackedSessions 返回目前追蹤的所有 id", () => {
    fs.writeFileSync(jsonlFile, "");
    tracker.startTracking("s1", jsonlFile, tmpDir, "p");
    expect(tracker.getTrackedSessions().has("s1")).toBe(true);
    tracker.stopTracking("s1");
    expect(tracker.getTrackedSessions().has("s1")).toBe(false);
  });

  it("getProjectDir 返回對應 session 的專案目錄", () => {
    fs.writeFileSync(jsonlFile, "");
    tracker.startTracking("s1", jsonlFile, tmpDir, "p");
    expect(tracker.getProjectDir("s1")).toBe(tmpDir);
    expect(tracker.getProjectDir("nope")).toBeUndefined();
  });

  it("大檔案首次追蹤時，歷史內容僅回放最後 256KB（不是全部）", async () => {
    // 寫入 300KB 的歷史（ASCII JSONL）+ 一行可解析的 assistant 訊息
    const filler = "x".repeat(300 * 1024);
    const validLine = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-test",
        content: [{ type: "text" }],
      },
    });
    fs.writeFileSync(jsonlFile, `${filler}\n${validLine}\n`);

    tracker.startTracking("s1", jsonlFile, tmpDir, "p");
    // 等檔案監視觸發或 polling
    await new Promise((r) => setTimeout(r, 2200));

    // 因為 fileOffset 從 size-256KB 開始，第一個 filler「行」會被視為部分行，
    // parseJsonlLine 遇到壞 JSON 會 skip，但 validLine 應能被解析並發出 modelDetected
    const hasModel = events.some(
      (e) => e.type === "modelDetected" && e.model === "claude-test",
    );
    expect(hasModel).toBe(true);
  }, 10000);

  it("destroy 清空所有 tracked sessions", () => {
    fs.writeFileSync(jsonlFile, "");
    tracker.startTracking("s1", jsonlFile, tmpDir, "p");
    tracker.destroy();
    expect(tracker.getTrackedSessions().size).toBe(0);
  });
});
