import { describe, it, expect } from "vitest";
import {
  isSessionPayload,
  isAgentStartedPayload,
  isToolStartPayload,
  isConnectionStatusPayload,
  isLatencyPayload,
  isErrorPayload,
} from "../src/lib/validators";

describe("validators", () => {
  it("isSessionPayload 拒絕 null/非物件", () => {
    expect(isSessionPayload(null)).toBe(false);
    expect(isSessionPayload(undefined)).toBe(false);
    expect(isSessionPayload("string")).toBe(false);
    expect(isSessionPayload(42)).toBe(false);
    expect(isSessionPayload([])).toBe(false);
  });

  it("isSessionPayload 要求 sessionId 是字串", () => {
    expect(isSessionPayload({})).toBe(false);
    expect(isSessionPayload({ sessionId: 123 })).toBe(false);
    expect(isSessionPayload({ sessionId: "abc" })).toBe(true);
  });

  it("isAgentStartedPayload 要求 projectName", () => {
    expect(isAgentStartedPayload({ sessionId: "a" })).toBe(false);
    expect(isAgentStartedPayload({ sessionId: "a", projectName: "proj" })).toBe(true);
    expect(isAgentStartedPayload({ sessionId: "a", projectName: 5 })).toBe(false);
  });

  it("isToolStartPayload 接受缺 toolId 但要求 toolName", () => {
    expect(
      isToolStartPayload({ sessionId: "a", toolName: "Read" }),
    ).toBe(true);
    expect(
      isToolStartPayload({ sessionId: "a", toolId: "t1", toolName: "Read" }),
    ).toBe(true);
    expect(isToolStartPayload({ sessionId: "a" })).toBe(false);
  });

  it("isConnectionStatusPayload 只需 connected: boolean", () => {
    expect(isConnectionStatusPayload({ connected: true })).toBe(true);
    expect(isConnectionStatusPayload({ connected: false, reason: "x" })).toBe(true);
    expect(isConnectionStatusPayload({ connected: "yes" })).toBe(false);
  });

  it("isLatencyPayload 要求 ms 是有限數字", () => {
    expect(isLatencyPayload({ ms: 42 })).toBe(true);
    expect(isLatencyPayload({ ms: Infinity })).toBe(false);
    expect(isLatencyPayload({ ms: "42" })).toBe(false);
    expect(isLatencyPayload({})).toBe(false);
  });

  it("isErrorPayload 要求 message 是字串", () => {
    expect(isErrorPayload({ message: "boom" })).toBe(true);
    expect(isErrorPayload({ message: null })).toBe(false);
    expect(isErrorPayload({})).toBe(false);
  });
});
