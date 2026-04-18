import { describe, it, expect } from "vitest";
import { zhTW } from "../src/i18n/locales/zh-TW";
import { en } from "../src/i18n/locales/en";

describe("i18n 字典結構", () => {
  it("英文字典覆蓋繁中所有 top-level namespace", () => {
    const zhKeys = Object.keys(zhTW).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("每個 namespace 內的 key 集合一致（避免漏翻譯）", () => {
    for (const ns of Object.keys(zhTW) as Array<keyof typeof zhTW>) {
      const zhKeys = Object.keys(zhTW[ns]).sort();
      const enKeys = Object.keys(en[ns] ?? {}).sort();
      expect(enKeys, `namespace: ${String(ns)}`).toEqual(zhKeys);
    }
  });

  it("所有英文翻譯都是非空字串", () => {
    for (const ns of Object.keys(en) as Array<keyof typeof en>) {
      for (const [key, value] of Object.entries(en[ns])) {
        expect(typeof value, `${String(ns)}.${key}`).toBe("string");
        expect((value as string).length, `${String(ns)}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("帶 {n} 參數的條目在兩種語言都保留佔位符", () => {
    const paramKeys = [
      "agents.timeSecondsAgo",
      "agents.timeMinutesAgo",
      "agents.timeHoursAgo",
    ];
    for (const path of paramKeys) {
      const [ns, k] = path.split(".") as [keyof typeof zhTW, string];
      expect((zhTW[ns] as Record<string, string>)[k]).toContain("{n}");
      expect((en[ns] as Record<string, string>)[k]).toContain("{n}");
    }
  });

  it("terminal.exited 使用 {code} 佔位符", () => {
    expect(zhTW.terminal.exited).toContain("{code}");
    expect(en.terminal.exited).toContain("{code}");
  });
});
