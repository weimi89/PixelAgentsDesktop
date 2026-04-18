import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseDesktopSettings,
  DESKTOP_SETTINGS_DEFAULTS,
} from "../src/lib/validators";

describe("parseDesktopSettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("null / 非物件輸入回傳預設值", () => {
    expect(parseDesktopSettings(null)).toEqual(DESKTOP_SETTINGS_DEFAULTS);
    expect(parseDesktopSettings(undefined)).toEqual(DESKTOP_SETTINGS_DEFAULTS);
    expect(parseDesktopSettings("str")).toEqual(DESKTOP_SETTINGS_DEFAULTS);
    expect(parseDesktopSettings(42)).toEqual(DESKTOP_SETTINGS_DEFAULTS);
    expect(parseDesktopSettings([])).toEqual(DESKTOP_SETTINGS_DEFAULTS);
  });

  it("完整有效輸入照搬", () => {
    const input = {
      scanIntervalMs: 2000,
      excludedProjects: ["a", "b"],
      autoStart: true,
      startMinimized: true,
      telemetryEnabled: true,
    };
    expect(parseDesktopSettings(input)).toEqual(input);
  });

  it("空物件取全預設", () => {
    expect(parseDesktopSettings({})).toEqual(DESKTOP_SETTINGS_DEFAULTS);
  });

  it("scanIntervalMs 超出範圍回退預設", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseDesktopSettings({ scanIntervalMs: 100 }).scanIntervalMs).toBe(
      DESKTOP_SETTINGS_DEFAULTS.scanIntervalMs,
    );
    expect(parseDesktopSettings({ scanIntervalMs: 999999 }).scanIntervalMs).toBe(
      DESKTOP_SETTINGS_DEFAULTS.scanIntervalMs,
    );
    expect(parseDesktopSettings({ scanIntervalMs: 500 }).scanIntervalMs).toBe(500);
    expect(parseDesktopSettings({ scanIntervalMs: 600000 }).scanIntervalMs).toBe(600000);
  });

  it("scanIntervalMs 型別錯誤回退預設", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseDesktopSettings({ scanIntervalMs: "2000" }).scanIntervalMs).toBe(
      DESKTOP_SETTINGS_DEFAULTS.scanIntervalMs,
    );
  });

  it("excludedProjects 過濾非字串元素", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseDesktopSettings({
      excludedProjects: ["ok", 42, null, "also-ok", true],
    });
    expect(parsed.excludedProjects).toEqual(["ok", "also-ok"]);
  });

  it("excludedProjects 非陣列回退預設", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseDesktopSettings({ excludedProjects: "not-array" });
    expect(parsed.excludedProjects).toEqual(DESKTOP_SETTINGS_DEFAULTS.excludedProjects);
  });

  it("autoStart / startMinimized 非 boolean 回退預設", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseDesktopSettings({
      autoStart: "yes",
      startMinimized: 1,
    });
    expect(parsed.autoStart).toBe(DESKTOP_SETTINGS_DEFAULTS.autoStart);
    expect(parsed.startMinimized).toBe(DESKTOP_SETTINGS_DEFAULTS.startMinimized);
  });

  it("忽略未知欄位", () => {
    const parsed = parseDesktopSettings({
      scanIntervalMs: 1500,
      legacyField: "should be ignored",
    } as unknown);
    expect(parsed).toEqual({
      ...DESKTOP_SETTINGS_DEFAULTS,
      scanIntervalMs: 1500,
    });
  });

  it("發現問題時呼叫 console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseDesktopSettings({ scanIntervalMs: "bad" });
    expect(warn).toHaveBeenCalled();
  });
});
