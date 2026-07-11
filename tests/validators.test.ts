import { describe, it, expect } from "vitest";
import {
  isSessionPayload,
  isAgentStartedPayload,
  isToolStartPayload,
  isConnectionStatusPayload,
  isLatencyPayload,
  isErrorPayload,
  validateSettingsImport,
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

  describe("validateSettingsImport（匯入嚴格驗證）", () => {
    const valid = {
      scanIntervalMs: 2000,
      excludedProjects: ["foo", "bar"],
      autoStart: true,
      startMinimized: false,
      telemetryEnabled: false,
    };

    it("接受完整且型別正確的設定檔並回傳正規化值", () => {
      const r = validateSettingsImport(valid);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.scanIntervalMs).toBe(2000);
        expect(r.value.excludedProjects).toEqual(["foo", "bar"]);
        expect(r.value.autoStart).toBe(true);
      }
    });

    it("拒絕非物件（null / 陣列 / 字串）", () => {
      expect(validateSettingsImport(null).ok).toBe(false);
      expect(validateSettingsImport([]).ok).toBe(false);
      expect(validateSettingsImport("x").ok).toBe(false);
    });

    it("拒絕空物件並列出缺少的欄位（不靜默回退預設）", () => {
      const r = validateSettingsImport({});
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.invalidFields).toContain("scanIntervalMs");
        expect(r.invalidFields).toContain("autoStart");
        expect(r.invalidFields).toContain("telemetryEnabled");
      }
    });

    it("拒絕欄位型別錯誤（例如 autoStart 為字串）", () => {
      const r = validateSettingsImport({ ...valid, autoStart: "yes" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.invalidFields).toEqual(["autoStart"]);
    });

    it("拒絕 excludedProjects 含非字串元素", () => {
      const r = validateSettingsImport({ ...valid, excludedProjects: ["ok", 123] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.invalidFields).toContain("excludedProjects");
    });

    it("型別正確但數值超範圍時仍接受，並由 parseDesktopSettings 夾限為預設", () => {
      const r = validateSettingsImport({ ...valid, scanIntervalMs: 999999999 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.scanIntervalMs).toBe(1000);
    });
  });
});
