import { useEffect } from "react";

export interface ShortcutBinding {
  /** 是否需要 Cmd (macOS) / Ctrl (win/linux) */
  mod?: boolean;
  /** Shift 鍵 */
  shift?: boolean;
  /** Alt/Option 鍵 */
  alt?: boolean;
  /** 主要按鍵（小寫字母或 e.key 的值） */
  key: string;
  /** 觸發時執行的動作 */
  action: (e: KeyboardEvent) => void;
  /** 人類可讀的描述，供「鍵盤快捷鍵」說明使用 */
  description?: string;
}

/**
 * 註冊全域鍵盤快捷鍵。
 *
 * 以 `Meta` (macOS Cmd) 或 `Control` (其他) 作為 mod 鍵；
 * 當焦點在 input/textarea 且按鍵非 mod 組合時不觸發，避免干擾輸入。
 */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 輸入元素中未按 mod 鍵的純字母不攔截
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true;

      for (const b of bindings) {
        const needsMod = !!b.mod;
        const modPressed = e.metaKey || e.ctrlKey;
        if (needsMod && !modPressed) continue;
        if (!needsMod && modPressed) continue;
        if (!!b.shift !== e.shiftKey) continue;
        if (!!b.alt !== e.altKey) continue;
        if (e.key.toLowerCase() !== b.key.toLowerCase()) continue;

        // 在可編輯欄位中，仍允許 mod 組合（如 Cmd+1 切 tab）
        if (inEditable && !needsMod) continue;

        e.preventDefault();
        b.action(e);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bindings]);
}
