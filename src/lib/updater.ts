/**
 * # Updater 包裝
 *
 * 把 `@tauri-apps/plugin-updater` 的 `check()` 錯誤分類為我們的
 * [[UpdateCheckResult]] 狀態機，UI 層（[[SettingsView]] 的
 * `UpdateStatus`）可以據此呈現對應訊息：
 *
 * - `notConfigured`：`tauri.conf.json` 的 `plugins.updater.endpoints`
 *   為空時 plugin 會拋錯，開發版 / 未簽章版很常見；顯示「此建置尚未設定
 *   更新伺服器」而不是嚇人的原始錯誤。
 * - `available`：返回帶 `download()` closure 的 result；UI 按下載按鈕時
 *   呼叫 `downloadAndInstall` + `relaunch`。
 *
 * ## 動態 import
 *
 * `@tauri-apps/plugin-updater` 與 `@tauri-apps/plugin-process` 以
 * `await import()` 載入，避免這兩個套件被打包進首屏 bundle。
 */

export type UpdateCheckResult =
  | { kind: "noUpdate" }
  | { kind: "available"; version: string; notes?: string; download: () => Promise<void> }
  | { kind: "notConfigured" }
  | { kind: "error"; message: string };

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "noUpdate" };
    return {
      kind: "available",
      version: update.version,
      notes: update.body,
      download: async () => {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 未設定 endpoint 時 plugin 會報錯誤訊息（多種可能字樣）
    if (
      msg.toLowerCase().includes("endpoint") ||
      msg.toLowerCase().includes("no updater")
    ) {
      return { kind: "notConfigured" };
    }
    return { kind: "error", message: msg };
  }
}
