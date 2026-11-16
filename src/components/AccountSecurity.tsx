import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

type MfaStatus = { enabled: boolean };
type MfaSetup = { secret: string; otpauthUri: string };
type MfaEnabled = { enabled: true; recoveryCodes: string[] };

export default function AccountSecurity({ email }: { email: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<MfaStatus>("/auth/mfa/status")
      .then((status) => { if (active) setEnabled(status.enabled); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load account security.");
      });
    return () => { active = false; };
  }, []);

  async function beginSetup() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<MfaSetup>("/auth/mfa/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setSetup(result);
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start MFA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function enableMfa() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<MfaEnabled>("/auth/mfa/enable", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setEnabled(result.enabled);
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode("");
      setNotice("MFA is enabled. Save these recovery codes now; they will not be shown again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not enable MFA.");
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/auth/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ password, code }),
      });
      setEnabled(false);
      setPassword("");
      setCode("");
      setRecoveryCodes([]);
      setNotice("MFA has been disabled.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disable MFA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-section" id="account-security">
      <div className="panel-heading">
        <div><h2>Account security</h2><p>Protect sign-ins to {email} with an authenticator app.</p></div>
      </div>
      {enabled === null ? <p className="security-status">Checking multi-factor authentication status…</p> : (
        <div className="security-content">
          <div className="security-status">
            <strong>Multi-factor authentication</strong>
            <span className={enabled ? "security-enabled" : "security-disabled"}>{enabled ? "Enabled" : "Not enabled"}</span>
          </div>
          {recoveryCodes.length > 0 && (
            <div className="security-recovery">
              <p>{notice}</p>
              <ul>{recoveryCodes.map((recoveryCode) => <li key={recoveryCode}>{recoveryCode}</li>)}</ul>
              <button className="button button-quiet" onClick={() => setRecoveryCodes([])}>I saved these codes</button>
            </div>
          )}
          {!enabled && !setup && recoveryCodes.length === 0 && (
            <div className="security-form">
              <label className="field"><span>Confirm your password to set up MFA</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <button className="button button-primary" disabled={busy || !password} onClick={() => void beginSetup()}>{busy ? "Starting…" : "Set up MFA"}</button>
            </div>
          )}
          {!enabled && setup && (
            <div className="security-form">
              <p className="security-instructions">Add this key to your authenticator app for <strong>{email}</strong>. If your app supports setup links, use the link below.</p>
              <label className="field"><span>Setup key</span><input readOnly value={setup.secret} /></label>
              <a className="security-uri" href={setup.otpauthUri}>Open in authenticator app</a>
              <label className="field"><span>Enter the 6-digit code from your app</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
              <div className="security-actions">
                <button className="button button-primary" disabled={busy || code.length !== 6} onClick={() => void enableMfa()}>{busy ? "Verifying…" : "Verify and enable"}</button>
                <button className="button button-quiet" disabled={busy} onClick={() => { setSetup(null); setCode(""); setError(""); }}>Cancel</button>
              </div>
            </div>
          )}
          {enabled && (
            <div className="security-form">
              <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <label className="field"><span>Authenticator or recovery code</span><input autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label>
              <button className="button button-danger-outline" disabled={busy || !password || code.length < 6} onClick={() => void disableMfa()}>{busy ? "Disabling…" : "Disable MFA"}</button>
            </div>
          )}
        </div>
      )}
      {notice && recoveryCodes.length === 0 && <p className="security-notice" role="status">{notice}</p>}
      {error && <p className="security-error" role="alert">{error}</p>}
    </section>
  );
}
