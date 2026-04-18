/**
 * # i18n — 輕量自製翻譯層
 *
 * 不引入 `react-i18next`（對此應用過重）。以 `zh-TW.ts` 為主字典定義
 * 結構，`en.ts` / `ja.ts` 以 `DeepString<typeof zhTW>` 型別強制結構相同；
 * 漏翻譯會在 `tests/i18n.test.ts` 測試失敗。
 *
 * ## 用法
 *
 * ```tsx
 * const t = useTranslation();
 * return <h1>{t("login.subtitle")}</h1>;
 * return <p>{t("agents.timeSecondsAgo", { n: 5 })}</p>;  // 插值
 * ```
 *
 * 非 React context（例如 `App.tsx` 的 `handleSidecarEvent` 全域函式）
 * 應直接 `useLocaleStore.getState().locale` 取對應字典。
 *
 * ## fallback
 *
 * 若當前語言的 key 缺失會 fallback 回繁中字典；兩邊都沒才返回 key 本身
 * 並 `console.warn`。
 */

import { create } from "zustand";
import { zhTW, type Dictionary } from "./locales/zh-TW";
import { en } from "./locales/en";
import { ja } from "./locales/ja";

export type LocaleCode = "zh-TW" | "en" | "ja";

const DICTIONARIES: Record<LocaleCode, Dictionary> = {
  "zh-TW": zhTW,
  en: en,
  ja: ja,
};

/** 從「a.b.c」路徑取巢狀值 */
function getByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    return v === undefined ? `{${key}}` : String(v);
  });
}

interface LocaleState {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectInitialLocale(),
  setLocale: (locale) => set({ locale }),
}));

function detectInitialLocale(): LocaleCode {
  if (typeof navigator !== "undefined") {
    const lang = navigator.language || "";
    const lower = lang.toLowerCase();
    if (lower.startsWith("zh")) return "zh-TW";
    if (lower.startsWith("ja")) return "ja";
    if (lower.startsWith("en")) return "en";
  }
  return "zh-TW";
}

/**
 * 取得翻譯字串。
 *
 * 用法：
 *   const t = useTranslation();
 *   t("login.subtitle");
 *   t("terminal.exited", { code: 1 });
 *
 * 若 key 未定義會返回 key 本身（方便 debug），並在主控台 warn。
 */
export function useTranslation(): (key: string, params?: Record<string, string | number>) => string {
  const locale = useLocaleStore((s) => s.locale);
  const dict = DICTIONARIES[locale];

  return (key: string, params?: Record<string, string | number>): string => {
    const raw = getByPath(dict, key);
    if (typeof raw !== "string") {
      // 嘗試 fallback 到繁中
      const fallback = getByPath(zhTW, key);
      if (typeof fallback === "string") {
        return interpolate(fallback, params);
      }
      console.warn(`[i18n] missing key: ${key} (locale=${locale})`);
      return key;
    }
    return interpolate(raw, params);
  };
}
