import { describe, it, expect } from "vitest";
import { parseJsonlLine } from "../sidecar/src/parser";

const SESSION = "sess-123";

describe("parseJsonlLine", () => {
  it("malformed JSON 回傳空陣列而不拋錯", () => {
    expect(parseJsonlLine(SESSION, "not-json")).toEqual([]);
    expect(parseJsonlLine(SESSION, "{unterminated")).toEqual([]);
  });

  it("空字串或空白不產生事件", () => {
    expect(parseJsonlLine(SESSION, "")).toEqual([]);
  });

  it("assistant 訊息帶 model 欄位時發出 modelDetected", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        content: [{ type: "text" }],
      },
    });
    const events = parseJsonlLine(SESSION, line);
    expect(events.some((e) => e.type === "modelDetected" && e.model === "claude-opus-4-7")).toBe(true);
  });

  it("assistant 訊息含 thinking block 發出 agentThinking", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude",
        content: [{ type: "thinking" }],
      },
    });
    const events = parseJsonlLine(SESSION, line);
    expect(events.some((e) => e.type === "agentThinking")).toBe(true);
  });

  it("assistant 訊息的 tool_use 發出 toolStart 並包含 toolId/toolName", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude",
        content: [
          {
            type: "tool_use",
            id: "tool-abc",
            name: "Read",
            input: { file_path: "/tmp/foo" },
          },
        ],
      },
    });
    const events = parseJsonlLine(SESSION, line);
    const toolStart = events.find((e) => e.type === "toolStart");
    expect(toolStart).toBeDefined();
    if (toolStart && toolStart.type === "toolStart") {
      expect(toolStart.toolId).toBe("tool-abc");
      expect(toolStart.toolName).toBe("Read");
    }
  });

  it("user 訊息含 tool_result 發出 toolDone", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-abc",
          },
        ],
      },
    });
    const events = parseJsonlLine(SESSION, line);
    expect(
      events.some((e) => e.type === "toolDone" && e.toolId === "tool-abc"),
    ).toBe(true);
  });

  it("compact_boundary 系統事件發出 agentEmote compress", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "compact_boundary",
    });
    const events = parseJsonlLine(SESSION, line);
    expect(
      events.some((e) => e.type === "agentEmote" && e.emoteType === "compress"),
    ).toBe(true);
  });

  it("turn_duration 系統事件發出 turnComplete", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "turn_duration",
    });
    const events = parseJsonlLine(SESSION, line);
    expect(events.some((e) => e.type === "turnComplete")).toBe(true);
  });
});
