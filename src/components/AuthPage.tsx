import { useState } from "react";
import { ArrowRight, BriefcaseBusiness, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import type { FormEvent } from "react";
import { apiRequest, type Session } from "../lib/api";

type Props = {
  onAuthenticated: (session: Session) => Promise<void>;
  notice?: string;
};

export default function AuthPage({ onAuthenticated, notice }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (challengeToken) {
        const session = await apiRequest<Session>("/auth/mfa/verify", {
          method: "POST",
          body: JSON.stringify({ challengeToken, code: verificationCode }),
        });
        await onAuthenticated(session);
        return;
      }
      const session = await apiRequest<Session | { mfaRequired: true; challengeToken: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if ("mfaRequired" in session) {
        setChallengeToken(session.challengeToken);
        setVerificationCode("");
        return;
      }
      await onAuthenticated(session);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-decoration auth-decoration-one" />
      <div className="auth-decoration auth-decoration-two" />
      <section className="auth-card">
        <div className="auth-app-brand">
          <span className="auth-brand-mark"><BriefcaseBusiness size={19} /></span>
          <span>smartinvoice<strong>PRO</strong></span>
        </div>
        <div className="auth-card-heading">
          <span className="auth-card-icon">{challengeToken ? <ShieldCheck size={18} /> : <LockKeyhole size={18} />}</span>
          <div>
            <h1>{challengeToken ? "Verify your identity" : "Sign in"}</h1>
            <p>{challengeToken ? "Enter your authenticator or recovery code." : "Use the account created for you by your administrator."}</p>
          </div>
        </div>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form onSubmit={submit} className="auth-form">
          {challengeToken ? (
            <label className="field">
              <span>Verification code</span>
              <input autoFocus required autoComplete="one-time-code" inputMode="text" maxLength={20} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="000000" />
            </label>
          ) : <>
            <label className="field">
              <span>Email address</span>
              <div className="auth-input-wrap"><Mail size={15} /><input autoFocus type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" /></div>
            </label>
            <label className="field">
              <span>Password</span>
              <div className="auth-input-wrap">
                <LockKeyhole size={15} />
                <input type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
                <button type="button" className="password-visibility" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </label>
          </>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary auth-submit" disabled={submitting}>
            {submitting ? "Please wait…" : challengeToken ? "Verify and sign in" : "Sign in to workspace"}<ArrowRight size={16} />
          </button>
        </form>
        {challengeToken && <button className="text-button auth-back" onClick={() => { setChallengeToken(""); setError(""); }}>Use a different sign-in</button>}
        {!challengeToken && <p className="auth-admin-note"><ShieldCheck size={14} /> User accounts are managed by the platform administrator.</p>}
      </section>
    </main>
  );
}
