import { useState } from "react";
import { ArrowRight, BriefcaseBusiness, Check, Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { apiRequest, type Session } from "../lib/api";

type Props = {
  onAuthenticated: (session: Session) => Promise<void>;
  onUseDemo: () => void;
  notice?: string;
};

export default function AuthPage({ onAuthenticated, onUseDemo, notice }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [businessName, setBusinessName] = useState("");
  const [fullName, setFullName] = useState("");
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
      const session = await apiRequest<Session | { mfaRequired: true; challengeToken: string }>(`/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        body: JSON.stringify(mode === "login"
          ? { email, password }
          : { businessName, fullName, email, password }),
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
      <div className="auth-layout">
        <section className="auth-story">
          <div className="auth-brand"><span className="auth-brand-mark"><BriefcaseBusiness size={19} /></span><span>smartinvoice<strong>PRO</strong></span></div>
          <div className="auth-story-copy">
            <span className="eyebrow"><span className="live-dot" /> MADE FOR YOUR BUSINESS</span>
            <h1>More clarity.<br /><span>Less chasing.</span></h1>
            <p>Create professional invoices, keep track of payments, and know exactly where your business stands.</p>
            <div className="auth-benefits">
              <span><i><Check size={12} /></i> Invoices that look as good as your work</span>
              <span><i><Check size={12} /></i> See what’s paid and what’s still due</span>
              <span><i><Check size={12} /></i> Your business records, all in one place</span>
            </div>
          </div>
          <div className="auth-footnote"><Sparkles size={14} /> Thoughtfully made for the way you work.</div>
        </section>
        <section className="auth-card">
          <div className="auth-card-heading"><span className="auth-card-icon">{mode === "login" ? <LockKeyhole size={18} /> : <Sparkles size={18} />}</span><div><h2>{mode === "login" ? "Welcome back" : "Start your workspace"}</h2><p>{mode === "login" ? "Sign in to pick up where you left off." : "Create your business account in a few steps."}</p></div></div>
          <div className="auth-tabs"><button className={mode === "login" && !challengeToken ? "auth-tab active" : "auth-tab"} onClick={() => { setMode("login"); setChallengeToken(""); setError(""); }}>Sign in</button><button className={mode === "register" ? "auth-tab active" : "auth-tab"} disabled={Boolean(challengeToken)} onClick={() => { setMode("register"); setError(""); }}>Create account</button></div>
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <form onSubmit={submit} className="auth-form">
            {challengeToken ? <>
              <p className="auth-mfa-prompt">Enter the 6-digit code from your authenticator app, or a one-time recovery code.</p>
              <label className="field"><span>Verification code</span><input autoFocus required autoComplete="one-time-code" inputMode="text" maxLength={20} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="000000" /></label>
            </> : mode === "register" && <>
              <label className="field"><span>Your business name</span><input autoFocus required minLength={2} maxLength={160} value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="e.g. Lumina Studio" /></label>
              <label className="field"><span>Your full name</span><input required minLength={2} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Evans Kimani" /></label>
            </>}
            {!challengeToken && <>
              <label className="field"><span>Email address</span><div className="auth-input-wrap"><Mail size={15} /><input autoFocus={mode === "login"} type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" /></div></label>
              <label className="field"><span>Password</span><div className="auth-input-wrap"><LockKeyhole size={15} /><input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 4 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 4 characters" : "Your password"} /><button type="button" className="password-visibility" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
            </>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="button button-primary auth-submit" disabled={submitting}>{submitting ? "Please wait…" : challengeToken ? "Verify and sign in" : mode === "login" ? "Sign in to workspace" : "Create business workspace"}<ArrowRight size={16} /></button>
          </form>
          {challengeToken ? <button className="text-button auth-back" onClick={() => { setChallengeToken(""); setError(""); }}>Use a different sign-in</button> : <>
            <div className="auth-divider"><span /> OR <span /></div>
            <button className="button button-quiet demo-button" onClick={onUseDemo}>Explore the local demo</button>
            <p className="auth-privacy">Your business workspace is private. Accounts and invoice records are kept separate for each business.</p>
          </>}
        </section>
      </div>
      <footer className="auth-footer"><span>© {new Date().getFullYear()} Smart Invoice Pro</span><span>Secure business invoicing</span></footer>
    </main>
  );
}
