/**
 * # ErrorBoundary — 頂層錯誤邊界
 *
 * React 16+ 的 `componentDidCatch` 機制，捕捉子元件 render / lifecycle
 * 拋出的錯誤。顯示可讀的錯誤畫面取代白屏。
 *
 * ## class 元件限制
 *
 * React Hooks 無法在 class 元件使用。翻譯字典與主題色票改以
 * `useLocaleStore.getState()` / `useThemeStore.getState()` 在 render 時
 * 直接取靜態值 — 不對語言/主題切換做響應式更新（錯誤畫面出現頻率極低，
 * 權衡之下可接受）。
 *
 * ## crash 持久化
 *
 * `componentDidCatch` 呼叫 [[reportCrash]] 把錯誤訊息 + stack +
 * componentStack 寫到 `~/.pixel-agents/crashes/`；包含 diagnostics 快照
 * 供事後分析。失敗不影響 UI 顯示。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocaleStore } from "../i18n";
import { zhTW } from "../i18n/locales/zh-TW";
import { en } from "../i18n/locales/en";
import { ja } from "../i18n/locales/ja";
import { reportCrash } from "../tauri-api";
import { useThemeStore, DARK_THEME, LIGHT_THEME, type ThemeColors } from "../theme";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function makeStyles(c: ThemeColors) {
  return {
    container: {
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      height: "100vh",
      background: c.bg,
      color: c.text,
      fontFamily: "monospace",
      padding: "24px",
      gap: "16px",
    },
    title: { fontSize: "18px", fontWeight: 700, color: c.error, margin: 0 },
    message: {
      color: c.textDim,
      fontSize: "13px",
      maxWidth: "600px",
      textAlign: "center" as const,
    },
    stack: {
      fontSize: "11px",
      color: c.textMuted,
      background: c.bgSurface,
      border: `2px solid ${c.bgElevated}`,
      padding: "12px",
      maxWidth: "760px",
      maxHeight: "280px",
      overflow: "auto" as const,
      whiteSpace: "pre-wrap" as const,
      wordBreak: "break-word" as const,
    },
    button: {
      padding: "8px 20px",
      background: c.accent,
      color: c.bg,
      border: "none",
      borderRadius: 0,
      cursor: "pointer",
      fontWeight: 700,
      fontSize: "13px",
      fontFamily: "monospace",
    },
  } as const;
}

/**
 * 頂層錯誤邊界。任何子元件 render / lifecycle 拋出錯誤時顯示備援 UI，
 * 讓使用者可以重新載入而非看到白屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 輸出到 stderr；Tauri 側 tracing subscriber 會寫入系統日誌
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
    // 持久化到磁碟以便使用者稍後回報；失敗不影響 UI 顯示
    void reportCrash("react-uncaught", error.message, {
      name: error.name,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private handleReload = (): void => {
    // 先清 error 讓元件樹重建；如果問題來自初始化，整頁 reload 是保底
    this.setState({ error: null });
    setTimeout(() => {
      if (this.state.error) window.location.reload();
    }, 50);
  };

  override render(): ReactNode {
    if (this.state.error) {
      // ErrorBoundary 是 class 元件，無法用 hook。直接讀當前 locale / theme 的
      // 靜態值即可；不對語言切換做響應式更新（錯誤畫面出現頻率極低）。
      const locale = useLocaleStore.getState().locale;
      const dict = locale === "en" ? en : locale === "ja" ? ja : zhTW;
      const resolved = useThemeStore.getState().resolved;
      const styles = makeStyles(resolved === "light" ? LIGHT_THEME : DARK_THEME);
      return (
        <div style={styles.container}>
          <h1 style={styles.title}>{dict.errors.uncaughtTitle}</h1>
          <p style={styles.message}>{dict.errors.uncaughtMessage}</p>
          <pre style={styles.stack}>
            {this.state.error.name}: {this.state.error.message}
            {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
          </pre>
          <button style={styles.button} onClick={this.handleReload}>
            {dict.errors.reload}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
