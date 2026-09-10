"use client";

import { Check, KeyRound, Mail, MapPinned, Navigation, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { NeighborWalkApp } from "../app/NeighborWalkApp";
import { authErrorMessage, validAuthEmail } from "../lib/auth";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase";
import { isProductionApp } from "../lib/environment";
import { authenticatedAppPath } from "../lib/auth-navigation";

export function NeighborWalkRoot() {
  const router = useRouter();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [passwordRecovery, setPasswordRecovery] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
  });
  const userId = session?.user.id;
  const email = session?.user.email ?? "";
  const fullName = session?.user.user_metadata?.full_name;
  const displayName = session?.user.user_metadata?.name;
  const name = typeof fullName === "string" ? fullName : typeof displayName === "string" ? displayName : undefined;
  const workspaceUser = useMemo(() => userId ? { id: userId, email, name } : null, [userId, email, name]);

  useEffect(() => {
    if (!loading && session && !passwordRecovery && pathname === "/login") router.replace(authenticatedAppPath(window.location.search));
  }, [loading, session, passwordRecovery, pathname, router]);

  useEffect(() => {
    if (!configured) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (active) {
        setSession(nextSession);
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        if (event === "SIGNED_OUT") setPasswordRecovery(false);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  const updatePassword = async (password: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("The church workspace connection is not available.");
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(authErrorMessage(error));
  };

  if (!configured) return <main className="app-loading"><h1>Workspace connection unavailable</h1><p>Ask the operator to finish connecting this deployment. Real church records will not be replaced with sample data.</p><Link className="button quiet" href="/demo">Explore the separate sample workspace</Link></main>;
  if (loading) return <ConnectionLoading />;
  if (!session) return <SignInScreen />;
  if (passwordRecovery) return <PasswordRecovery email={session.user.email ?? "your account"} onSave={async (password) => { await updatePassword(password); setPasswordRecovery(false); }} />;
  if (pathname === "/login") return <ConnectionLoading />;

  return (
    <NeighborWalkApp
      key={session.user.id}
      supabaseUser={workspaceUser}
      onUpdatePassword={updatePassword}
      onSignOut={async () => {
        const client = getSupabaseBrowserClient();
        if (client) { const { error } = await client.auth.signOut(); if (error) throw new Error(authErrorMessage(error)); }
      }}
    />
  );
}

function authRedirectUrl() {
  const url = new URL("/login", window.location.origin);
  const invitation = new URL(window.location.href).searchParams.get("invite");
  if (invitation) url.searchParams.set("invite", invitation);
  return url.toString();
}

type AuthAction = "google" | "password" | "signup" | "reset" | "link" | null;

function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [action, setAction] = useState<AuthAction>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const authError = url.searchParams.get("error_description") ?? hashParams.get("error_description");
    if (!authError) return;
    const errorTimer = window.setTimeout(() => setError(authErrorMessage(authError)), 0);
    for (const key of ["error", "error_code", "error_description"]) url.searchParams.delete(key);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    return () => window.clearTimeout(errorTimer);
  }, []);

  const normalizedEmail = () => email.trim().toLowerCase();
  const requireEmail = () => {
    if (validAuthEmail(email)) return true;
    setError("Enter a valid email address.");
    return false;
  };
  const clientOrError = () => {
    const client = getSupabaseBrowserClient();
    if (!client) setError("The church workspace connection is not available.");
    return client;
  };
  const begin = (nextAction: Exclude<AuthAction, null>) => {
    setAction(nextAction);
    setError("");
    setConfirmation(null);
  };

  const signInWithGoogle = async () => {
    const client = clientOrError();
    if (!client) return;
    begin("google");
    const { error: signInError } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: authRedirectUrl() } });
    if (signInError) {
      setAction(null);
      setError(authErrorMessage(signInError));
    }
  };

  const submitPassword = async () => {
    if (!requireEmail()) return;
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    const client = clientOrError();
    if (!client) return;
    begin(mode === "signin" ? "password" : "signup");
    if (mode === "signin") {
      const { error: signInError } = await client.auth.signInWithPassword({ email: normalizedEmail(), password });
      setAction(null);
      if (signInError) setError(authErrorMessage(signInError));
      return;
    }
    const { data, error: signUpError } = await client.auth.signUp({ email: normalizedEmail(), password, options: { emailRedirectTo: authRedirectUrl() } });
    setAction(null);
    if (signUpError) {
      setError(authErrorMessage(signUpError));
      return;
    }
    if (!data.session) setConfirmation({ title: "Confirm your account", detail: `Open the confirmation email sent to ${normalizedEmail()}.` });
  };

  const sendReset = async () => {
    if (!requireEmail()) return;
    const client = clientOrError();
    if (!client) return;
    begin("reset");
    const { error: resetError } = await client.auth.resetPasswordForEmail(normalizedEmail(), { redirectTo: authRedirectUrl() });
    setAction(null);
    if (resetError) {
      setError(authErrorMessage(resetError));
      return;
    }
    setConfirmation({ title: "Check your inbox", detail: `A password reset link was requested for ${normalizedEmail()}.` });
  };

  const sendLink = async () => {
    if (!requireEmail()) return;
    const client = clientOrError();
    if (!client) return;
    begin("link");
    const { error: signInError } = await client.auth.signInWithOtp({ email: normalizedEmail(), options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl() } });
    setAction(null);
    if (signInError) {
      setError(authErrorMessage(signInError));
      return;
    }
    setConfirmation({ title: "Check your inbox", detail: `Open the one-time sign-in link requested for ${normalizedEmail()}.` });
  };

  const busy = action !== null;
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="signin-title">
        <div className="auth-route" aria-hidden="true"><span><Navigation size={18} /></span><i /><span><MapPinned size={18} /></span></div>
        <p className="eyebrow">NeighborWalk church workspace</p>
        <h1 id="signin-title">Pick up where care left off.</h1>
        <p className="auth-intro">{isProductionApp ? "Google is the quickest way in. Password sign-in is also available and does not send an email each time." : "Use your test account here. This workspace has its own data and sign-in."}</p>
        <div className="auth-form">
          {isProductionApp && <><button type="button" className="button auth-submit auth-google" disabled={busy} onClick={() => void signInWithGoogle()}><span className="google-mark" aria-hidden="true">G</span>{action === "google" ? "Opening Google…" : "Continue with Google"}</button><div className="auth-divider"><span>or use your password</span></div></>}
          <form className="auth-credentials" onSubmit={(event) => { event.preventDefault(); void submitPassword(); }}>
            <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@yourchurch.org" /></label>
            <label className="form-field"><span>Password</span><input type="password" minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button className="button primary auth-submit" disabled={busy}>{action === "password" || action === "signup" ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
          </form>
          <div className="auth-secondary-actions">
            {mode === "signin" ? <><button type="button" disabled={busy} onClick={() => void sendReset()}>Forgot password?</button><button type="button" disabled={busy} onClick={() => { setMode("signup"); setError(""); setConfirmation(null); }}>Create an account</button></> : <button type="button" disabled={busy} onClick={() => { setMode("signin"); setError(""); setConfirmation(null); }}>Back to sign in</button>}
          </div>
          {mode === "signup" && <p className="auth-hint">Account confirmation uses one email. After that, routine password sign-ins do not.</p>}
          {confirmation && <div className="auth-confirmation" role="status"><Check size={20} /><div><strong>{confirmation.title}</strong><span>{confirmation.detail}</span></div></div>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <details className="auth-email-fallback"><summary>Use a one-time email link instead</summary><p>This fallback sends an email and may be unavailable when the project email limit is reached.</p><button type="button" className="button quiet auth-submit" disabled={busy} onClick={() => void sendLink()}><Mail size={16} />{action === "link" ? "Sending…" : "Send one-time link"}</button></details>
        </div>
        <div className="auth-privacy"><ShieldCheck size={16} /><span>People records are visible to their owner, church leaders and explicitly shared teammates. Pending handoff recipients and some historical creators may also have access, as shown on the profile.</span></div>
        <p><Link href="/help">Sign-in help</Link> · <Link href="/">About NeighborWalk</Link> · <Link href="/privacy">Privacy</Link></p>
      </section>
    </main>
  );
}

function PasswordRecovery({ email, onSave }: { email: string; onSave: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (password.length < 8) return setError("Use a password with at least 8 characters.");
    if (password !== confirmation) return setError("The passwords do not match.");
    setSaving(true);
    setError("");
    try {
      await onSave(password);
    } catch (saveError) {
      setError(authErrorMessage(saveError));
      setSaving(false);
    }
  };
  return <main className="auth-shell"><section className="auth-card auth-recovery" aria-labelledby="recovery-title"><div className="auth-route" aria-hidden="true"><span><KeyRound size={18} /></span><i /><span><MapPinned size={18} /></span></div><p className="eyebrow">Account recovery</p><h1 id="recovery-title">Choose a new password.</h1><p className="auth-intro">Set a password for {email}. Future sign-ins will not need an email link.</p><form className="auth-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><label className="form-field"><span>New password</span><input type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="form-field"><span>Confirm password</span><input type="password" minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button primary auth-submit" disabled={saving}>{saving ? "Saving…" : "Save password and continue"}</button></form></section></main>;
}

function ConnectionLoading() {
  return <main className="app-loading" role="status"><div className="loading-mark"><Navigation size={23} /></div><strong>Opening your church workspace</strong><span>Checking your secure session…</span></main>;
}
