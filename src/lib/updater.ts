// 對 @tauri-apps/plugin-updater 的輕量包裝。
//
// 如果 tauri.conf.json 的 plugins.updater.endpoints 為空，check() 會在
// plugin 內部直接 Err；我們把它轉成特定錯誤型別，UI 可顯示友善訊息
// 「此版本未設定更新伺服器」而非原始錯誤訊息。

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
