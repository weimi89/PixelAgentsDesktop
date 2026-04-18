import { describe, it, expect } from "vitest";
import { zhTW } from "../src/i18n/locales/zh-TW";
import { en } from "../src/i18n/locales/en";
import { ja } from "../src/i18n/locales/ja";

const dicts = { "zh-TW": zhTW, en, ja };

describe("i18n 字典結構", () => {
  it("所有語言字典 top-level namespace 一致", () => {
    const zhKeys = Object.keys(zhTW).sort();
    for (const [name, d] of Object.entries(dicts)) {
      expect(Object.keys(d).sort(), name).toEqual(zhKeys);
    }
  });

  it("每個 namespace 內的 key 集合在所有語言一致（避免漏翻譯）", () => {
    for (const ns of Object.keys(zhTW) as Array<keyof typeof zhTW>) {
      const zhKeys = Object.keys(zhTW[ns]).sort();
      for (const [name, d] of Object.entries(dicts)) {
        expect(Object.keys(d[ns] ?? {}).sort(), `${name}.${String(ns)}`).toEqual(zhKeys);
      }
    }
  });

  it("所有翻譯值都是非空字串", () => {
    for (const [name, d] of Object.entries(dicts)) {
      for (const ns of Object.keys(d) as Array<keyof typeof zhTW>) {
        for (const [key, value] of Object.entries(d[ns])) {
          expect(typeof value, `${name}.${String(ns)}.${key}`).toBe("string");
          expect((value as string).length, `${name}.${String(ns)}.${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("帶 {n} 參數的條目在所有語言都保留佔位符", () => {
    const paramKeys = [
      "agents.timeSecondsAgo",
      "agents.timeMinutesAgo",
      "agents.timeHoursAgo",
    ];
    for (const path of paramKeys) {
      const [ns, k] = path.split(".") as [keyof typeof zhTW, string];
      for (const [name, d] of Object.entries(dicts)) {
        expect(
          (d[ns] as Record<string, string>)[k],
          `${name}.${path}`,
        ).toContain("{n}");
      }
    }
  });

  it("terminal.exited / updater.available 使用 {code}/{version} 佔位符", () => {
    for (const [name, d] of Object.entries(dicts)) {
      expect(d.terminal.exited, `${name}.terminal.exited`).toContain("{code}");
      expect(d.updater.available, `${name}.updater.available`).toContain("{version}");
    }
  });
});
