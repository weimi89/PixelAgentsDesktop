import { useState } from "react";
import { connect as connectServer, loginServer } from "../tauri-api";
import { useConnectionStore } from "../stores/connectionStore";
import { useTranslation } from "../i18n";
import { useThemeColors } from "../theme";

type AuthMode = "apikey" | "password";

function useStyles() {
  const c = useThemeColors();
  return {
    container: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: c.bg,
    },
    card: {
      width: 380,
      padding: "32px",
      background: c.bgElevated,
      border: `2px solid ${c.border}`,
      borderRadius: 0,
    },
    title: {
      fontSize: "20px",
      fontWeight: 700,
      color: c.text,
      margin: "0 0 8px 0",
      fontFamily: "monospace",
    },
    subtitle: {
      fontSize: "12px",
      color: c.textDim,
      margin: "0 0 24px 0",
      fontFamily: "monospace",
    },
    label: {
      display: "block",
      fontSize: "12px",
      color: c.textDim,
      marginBottom: "4px",
      fontFamily: "monospace",
    },
    input: {
      width: "100%",
      padding: "8px 12px",
      background: c.bg,
      border: `2px solid ${c.border}`,
      borderRadius: 0,
      color: c.text,
      fontSize: "14px",
      fontFamily: "monospace",
      outline: "none",
      boxSizing: "border-box" as const,
    },
    fieldGroup: { marginBottom: "16px" },
    modeToggle: { display: "flex", gap: "0px", marginBottom: "20px" },
    modeButton: (active: boolean) => ({
      flex: 1,
      padding: "6px 12px",
      background: active ? c.accent : c.bg,
      color: active ? c.bg : c.textDim,
      border: `2px solid ${c.border}`,
      borderRadius: 0,
      cursor: "pointer",
      fontSize: "12px",
      fontFamily: "monospace",
      fontWeight: active ? 700 : 400,
    }),
    connectButton: {
      width: "100%",
      padding: "10px 16px",
      background: c.accent,
      color: c.bg,
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
      background: c.border,
      color: c.textMuted,
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
      background: c.bg,
      border: `2px solid ${c.error}`,
      borderRadius: 0,
      color: c.error,
      fontSize: "12px",
      fontFamily: "monospace",
      marginTop: "12px",
      wordBreak: "break-word" as const,
    },
    spinner: { display: "inline-block", marginRight: "8px" },
    secretRow: { position: "relative" as const },
    toggleButton: {
      position: "absolute" as const,
      right: "6px",
      top: "50%",
      transform: "translateY(-50%)",
      background: "transparent",
      border: "none",
      color: c.textDim,
      fontSize: "11px",
      fontFamily: "monospace",
      cursor: "pointer",
      padding: "2px 6px",
    },
  } as const;
}

export function LoginView() {
  const { serverUrl: savedUrl, setServerUrl, setToken, setStatus, setError } =
    useConnectionStore();
  const t = useTranslation();
  const styles = useStyles();

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
      <form
        style={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          handleConnect();
        }}
        aria-labelledby="login-title"
      >
        <h1 id="login-title" style={styles.title}>Pixel Agents</h1>
        <p style={styles.subtitle}>{t("login.subtitle")}</p>

        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="login-server-url">{t("login.serverUrl")}</label>
          <input
            id="login-server-url"
            style={styles.input}
            type="url"
            placeholder="https://your-server:3000"
            value={serverUrl}
            onChange={(e) => setServerUrlLocal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoComplete="url"
            required
          />
        </div>

        <div style={styles.modeToggle} role="radiogroup" aria-label={t("login.subtitle")}>
          <button
            type="button"
            role="radio"
            aria-checked={authMode === "apikey"}
            style={styles.modeButton(authMode === "apikey")}
            onClick={() => setAuthMode("apikey")}
            disabled={loading}
          >
            {t("login.modeApiKey")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={authMode === "password"}
            style={styles.modeButton(authMode === "password")}
            onClick={() => setAuthMode("password")}
            disabled={loading}
          >
            {t("login.modePassword")}
          </button>
        </div>

        {authMode === "apikey" ? (
          <div style={styles.fieldGroup}>
            <label style={styles.label} htmlFor="login-api-key">{t("login.apiKey")}</label>
            <div style={styles.secretRow}>
              <input
                id="login-api-key"
                style={{ ...styles.input, paddingRight: "56px" }}
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoComplete="off"
                required
              />
              <button
                type="button"
                style={styles.toggleButton}
                onClick={() => setShowApiKey((v) => !v)}
                tabIndex={-1}
                aria-pressed={showApiKey}
                aria-label={showApiKey ? t("login.hide") : t("login.show")}
              >
                {showApiKey ? t("login.hide") : t("login.show")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="login-username">{t("login.username")}</label>
              <input
                id="login-username"
                style={styles.input}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoComplete="username"
                required
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="login-password">{t("login.password")}</label>
              <div style={styles.secretRow}>
                <input
                  id="login-password"
                  style={{ ...styles.input, paddingRight: "56px" }}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? t("login.hide") : t("login.show")}
                >
                  {showPassword ? t("login.hide") : t("login.show")}
                </button>
              </div>
            </div>
          </>
        )}

        <button
          type="submit"
          style={
            canConnect && !loading
              ? styles.connectButton
              : styles.connectButtonDisabled
          }
          disabled={!canConnect || loading}
          aria-busy={loading}
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

        {error && (
          <div style={styles.error} role="alert" aria-live="assertive">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
