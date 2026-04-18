import { useState } from "react";
import { connect as connectServer, loginServer } from "../tauri-api";
import { useConnectionStore } from "../stores/connectionStore";
import { useTranslation } from "../i18n";

type AuthMode = "apikey" | "password";

const styles = {
  container: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1e1e2e",
  },
  card: {
    width: 380,
    padding: "32px",
    background: "#313244",
    border: "2px solid #45475a",
    borderRadius: 0,
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#cdd6f4",
    margin: "0 0 8px 0",
    fontFamily: "monospace",
  },
  subtitle: {
    fontSize: "12px",
    color: "#a6adc8",
    margin: "0 0 24px 0",
    fontFamily: "monospace",
  },
  label: {
    display: "block",
    fontSize: "12px",
    color: "#a6adc8",
    marginBottom: "4px",
    fontFamily: "monospace",
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    background: "#1e1e2e",
    border: "2px solid #45475a",
    borderRadius: 0,
    color: "#cdd6f4",
    fontSize: "14px",
    fontFamily: "monospace",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  fieldGroup: {
    marginBottom: "16px",
  },
  modeToggle: {
    display: "flex",
    gap: "0px",
    marginBottom: "20px",
  },
  modeButton: (active: boolean) => ({
    flex: 1,
    padding: "6px 12px",
    background: active ? "#89b4fa" : "#1e1e2e",
    color: active ? "#1e1e2e" : "#a6adc8",
    border: "2px solid #45475a",
    borderRadius: 0,
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "monospace",
    fontWeight: active ? 700 : 400,
  }),
  connectButton: {
    width: "100%",
    padding: "10px 16px",
    background: "#89b4fa",
    color: "#1e1e2e",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "14px",
    fontFamily: "monospace",
    marginTop: "8px",
  },
  connectButtonDisabled: {
    width: "100%",
    padding: "10px 16px",
    background: "#45475a",
    color: "#6c7086",
    border: "none",
    borderRadius: 0,
    cursor: "not-allowed",
    fontWeight: 700,
    fontSize: "14px",
    fontFamily: "monospace",
    marginTop: "8px",
  },
  error: {
    padding: "8px 12px",
    background: "#1e1e2e",
    border: "2px solid #f38ba8",
    borderRadius: 0,
    color: "#f38ba8",
    fontSize: "12px",
    fontFamily: "monospace",
    marginTop: "12px",
    wordBreak: "break-word" as const,
  },
  spinner: {
    display: "inline-block",
    marginRight: "8px",
  },
  secretRow: {
    position: "relative" as const,
  },
  toggleButton: {
    position: "absolute" as const,
    right: "6px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    color: "#a6adc8",
    fontSize: "11px",
    fontFamily: "monospace",
    cursor: "pointer",
    padding: "2px 6px",
  },
} as const;

export function LoginView() {
  const { serverUrl: savedUrl, setServerUrl, setToken, setStatus, setError } =
    useConnectionStore();
  const t = useTranslation();

  const [serverUrl, setServerUrlLocal] = useState(
    savedUrl || "https://localhost:3000"
  );
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("apikey");
  const [loading, setLoading] = useState(false);
  const [error, setErrorLocal] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const canConnect =
    serverUrl.trim() !== "" &&
    (authMode === "apikey"
      ? apiKey.trim() !== ""
      : username.trim() !== "" && password.trim() !== "");

  const handleConnect = async () => {
    if (!canConnect) return;
    setLoading(true);
    setErrorLocal(null);
    setStatus("connecting");
    setError(null);

    try {
      let token: string;

      if (authMode === "apikey") {
        token = apiKey.trim();
      } else {
        const resp = await loginServer(
          serverUrl.trim(),
          username.trim(),
          password,
        );
        token = resp.token;
      }

      await connectServer(serverUrl.trim(), token);
      setServerUrl(serverUrl.trim());
      setToken(token);
      setStatus("connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorLocal(msg);
      setStatus("disconnected");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canConnect && !loading) {
      handleConnect();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Pixel Agents</h1>
        <p style={styles.subtitle}>{t("login.subtitle")}</p>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>{t("login.serverUrl")}</label>
          <input
            style={styles.input}
            type="text"
            placeholder="https://your-server:3000"
            value={serverUrl}
            onChange={(e) => setServerUrlLocal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
        </div>

        <div style={styles.modeToggle}>
          <button
            style={styles.modeButton(authMode === "apikey")}
            onClick={() => setAuthMode("apikey")}
            disabled={loading}
          >
            {t("login.modeApiKey")}
          </button>
          <button
            style={styles.modeButton(authMode === "password")}
            onClick={() => setAuthMode("password")}
            disabled={loading}
          >
            {t("login.modePassword")}
          </button>
        </div>

        {authMode === "apikey" ? (
          <div style={styles.fieldGroup}>
            <label style={styles.label}>{t("login.apiKey")}</label>
            <div style={styles.secretRow}>
              <input
                style={{ ...styles.input, paddingRight: "56px" }}
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <button
                type="button"
                style={styles.toggleButton}
                onClick={() => setShowApiKey((v) => !v)}
                tabIndex={-1}
                aria-label={showApiKey ? t("login.hide") : t("login.show")}
              >
                {showApiKey ? t("login.hide") : t("login.show")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>{t("login.username")}</label>
              <input
                style={styles.input}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>{t("login.password")}</label>
              <div style={styles.secretRow}>
                <input
                  style={{ ...styles.input, paddingRight: "56px" }}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                />
                <button
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? t("login.hide") : t("login.show")}
                >
                  {showPassword ? t("login.hide") : t("login.show")}
                </button>
              </div>
            </div>
          </>
        )}

        <button
          style={
            canConnect && !loading
              ? styles.connectButton
              : styles.connectButtonDisabled
          }
          onClick={handleConnect}
          disabled={!canConnect || loading}
        >
          {loading ? (
            <>
              <span style={styles.spinner}>&#9696;</span>
              {t("login.connecting")}
            </>
          ) : (
            t("login.connect")
          )}
        </button>

        {error && <div style={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
