import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocaleStore } from "../i18n";
import { zhTW } from "../i18n/locales/zh-TW";
import { en } from "../i18n/locales/en";
import { reportCrash } from "../tauri-api";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    height: "100vh",
    background: "#1e1e2e",
    color: "#cdd6f4",
    fontFamily: "monospace",
    padding: "24px",
    gap: "16px",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#f38ba8",
    margin: 0,
  },
  message: {
    color: "#a6adc8",
    fontSize: "13px",
    maxWidth: "600px",
    textAlign: "center" as const,
  },
  stack: {
    fontSize: "11px",
    color: "#6c7086",
    background: "#181825",
    border: "2px solid #313244",
    padding: "12px",
    maxWidth: "760px",
    maxHeight: "280px",
    overflow: "auto" as const,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  button: {
    padding: "8px 20px",
    background: "#89b4fa",
    color: "#1e1e2e",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px",
    fontFamily: "monospace",
  },
} as const;

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
      // ErrorBoundary 是 class 元件，無法用 hook。直接讀當前 locale
      // 對應的字典即可；不對語言切換做響應式更新（錯誤畫面出現頻率極低）。
      const locale = useLocaleStore.getState().locale;
      const dict = locale === "en" ? en : zhTW;
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
