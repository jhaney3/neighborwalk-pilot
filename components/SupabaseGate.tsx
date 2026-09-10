"use client";

import { Check, KeyRound, Mail, MapPinned, Navigation, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { NeighborWalkApp } from "../app/NeighborWalkApp";
import { authErrorMessage, validAuthEmail } from "../lib/auth";
import { authServiceUnreachable, authStorageKey, getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase";
import { isProductionApp } from "../lib/environment";
import { authenticatedAppPath, safeAppPath } from "../lib/auth-navigation";
import { pendingInvitation, rememberBrowserInvitation } from "../lib/invitations";
import { preparedOfflineIdentity, WORKSPACE_CACHE_KEY, type PreparedIdentity } from "../lib/offline-identity";

export function NeighborWalkRoot() {
  const router = useRouter();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [connectionError, setConnectionError] = useState("");
  const [offlineCandidate, setOfflineCandidate] = useState<PreparedIdentity | null>(null);
  const [offlineUser, setOfflineUser] = useState<PreparedIdentity | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
  });
  const userId = session?.user.id;
  const email = session?.user.email ?? "";
  const fullName = session?.user.user_metadata?.full_name;
  const displayName = session?.user.user_metadata?.name;
  const name = typeof fullName === "string" ? fullName : typeof displayName === "string" ? displayName : undefined;
  // Keep the selected cache identity stable while a same-account token refresh
  // completes, so reconnecting does not replace a store with a write in flight.
  const workspaceUser = useMemo(() => offlineUser ?? (userId ? { id: userId, email, name } : null), [offlineUser, userId, email, name]);

  useEffect(() => {
    if (!loading && !connectionError && session && !passwordRecovery && ["/login", "/invite"].includes(pathname)) router.replace(authenticatedAppPath(window.location.search));
  }, [loading, connectionError, session, passwordRecovery, pathname, router]);

  useEffect(() => {
    if (!configured) return;
    try { rememberBrowserInvitation(); }
    catch (error) {
      queueMicrotask(() => { setConnectionError(error instanceof Error ? error.message : "This browser could not preserve the invitation. Keep the original link and try again after signing in."); setLoading(false); });
      return;
    }
    let client;
    try { client = getSupabaseBrowserClient(); }
    catch (error) { queueMicrotask(() => { setConnectionError(error instanceof Error ? error.message : "The workspace connection is unavailable."); setLoading(false); }); return; }
    if (!client) return;
    let active = true;
    const prepared = () => !pendingInvitation(window.sessionStorage) ? preparedOfflineIdentity(window.localStorage, authStorageKey()) : null;
    const checkOffline = async () => {
      if (!window.location.pathname.startsWith("/app/") || !prepared()) return;
      const unavailable = await authServiceUnreachable();
      if (active) setOfflineCandidate(unavailable ? prepared() : null);
    };
    const offlineTimer = window.setTimeout(() => { void checkOffline().catch(() => {}); }, 1500);
    const checkStoredAccess = (event: StorageEvent) => {
      if (event.key && ![authStorageKey(), WORKSPACE_CACHE_KEY].includes(event.key)) return;
      const candidate = prepared();
      setOfflineCandidate((current) => current?.id === candidate?.id ? candidate : null);
      setOfflineUser((current) => current?.id === candidate?.id ? current : null);
      if (!candidate) setSession(null);
    };
    window.addEventListener("storage", checkStoredAccess);
    void client.auth.getSession().then(({ data, error }) => {
      if (active) {
        setConnectionError(error ? authErrorMessage(error) : "");
        setSession(data.session);
        setLoading(false);
      }
    }).catch(() => { if (active) { setConnectionError("Sign-in could not be checked. Reconnect and try again. Your device records have not been cleared."); setLoading(false); } });
    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (active) {
        setSession(nextSession);
        if (nextSession) { setConnectionError(""); setOfflineCandidate(null); setOfflineUser((current) => current?.id === nextSession.user.id ? current : null); }
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        if (event === "SIGNED_OUT") { setPasswordRecovery(false); setOfflineUser(null); setOfflineCandidate(null); }
        setLoading(false);
      }
    });
    return () => {
      active = false;
      window.clearTimeout(offlineTimer);
      window.removeEventListener("storage", checkStoredAccess);
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
  if (!offlineUser && !session && offlineCandidate && !passwordRecovery) return <main className="auth-shell"><section className="auth-card"><h1>Your prepared workspace is available</h1><p>The sign-in service cannot be reached. This device was checked with your church less than 24 hours ago. You can explicitly reopen its saved records; this is not a new sign-in.</p><p>New work stays on this device until your account and church permissions can be checked online. Signing out or a known access removal disables this option.</p><button className="button primary" onClick={() => {
    const candidate = !pendingInvitation(window.sessionStorage) ? preparedOfflineIdentity(window.localStorage, authStorageKey()) : null;
    if (candidate?.id === offlineCandidate.id) { setOfflineUser(candidate); setConnectionError(""); setLoading(false); }
    else { setOfflineCandidate(null); setConnectionError("This device now needs an online sign-in and membership check. Saved work has not been cleared."); }
  }}>Open prepared offline workspace</button><button className="button quiet" onClick={() => window.location.reload()}>Retry online sign-in</button></section></main>;
  if (connectionError && !offlineUser) return <main className="auth-shell"><section className="auth-card"><h1>Check your connection or invitation</h1><p role="alert">{connectionError}</p><p>Nothing was cleared. If an email link opened in another tab, sign in there, then reopen your original church invitation.</p><button className="button quiet" onClick={() => window.location.reload()}>Try again</button><Link className="button quiet" href="/login">Open sign-in</Link><Link href="/help">Sign-in help</Link></section></main>;
  if (loading && !offlineUser) return <ConnectionLoading />;
  if (!workspaceUser) return <SignInScreen />;
  if (passwordRecovery && session) return <PasswordRecovery email={session.user.email ?? "your account"} onSave={async (password) => { await updatePassword(password); setPasswordRecovery(false); }} />;
  if (["/login", "/invite"].includes(pathname)) return <ConnectionLoading />;

  return (
    <NeighborWalkApp
      key={workspaceUser.id}
      supabaseUser={workspaceUser}
      onUpdatePassword={updatePassword}
      onSignOut={async () => {
        const client = getSupabaseBrowserClient();
        if (client) { const { error } = await client.auth.signOut({ scope: "local" }); if (error) throw new Error(authErrorMessage(error)); }
      }}
    />
  );
}

function authRedirectUrl() {
  const url = new URL("/login", window.location.origin);
  const next = window.location.pathname.startsWith("/app/") ? safeAppPath(window.location.pathname + window.location.search) : authenticatedAppPath(window.location.search);
  if (next !== "/app/today") url.searchParams.set("next", next);
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
    try {
      const client = getSupabaseBrowserClient();
      if (!client) setError("The church workspace connection is not available.");
      return client;
    } catch (error) { setError(authErrorMessage(error)); return null; }
  };
  const begin = (nextAction: Exclude<AuthAction, null>) => {
    setAction(nextAction);
    setError("");
    setConfirmation(null);
  };
  const runAuthAction = async (nextAction: Exclude<AuthAction, null>, operation: () => Promise<void>) => {
    begin(nextAction);
    try { await operation(); }
    catch (error) { setError(authErrorMessage(error)); }
    finally { setAction(null); }
  };

  const signInWithGoogle = async () => {
    const client = clientOrError();
    if (!client) return;
    await runAuthAction("google", async () => {
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: authRedirectUrl() } });
      if (error) throw error;
    });
  };

  const submitPassword = async () => {
    if (!requireEmail()) return;
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    const client = clientOrError();
    if (!client) return;
    await runAuthAction(mode === "signin" ? "password" : "signup", async () => {
      if (mode === "signin") {
        const { error } = await client.auth.signInWithPassword({ email: normalizedEmail(), password });
        if (error) throw error;
        return;
      }
      const { data, error } = await client.auth.signUp({ email: normalizedEmail(), password, options: { emailRedirectTo: authRedirectUrl() } });
      if (error) throw error;
      if (!data.session) setConfirmation({ title: "Confirm your account", detail: `Open the confirmation email sent to ${normalizedEmail()}.` });
    });
  };

  const sendReset = async () => {
    if (!requireEmail()) return;
    const client = clientOrError();
    if (!client) return;
    await runAuthAction("reset", async () => {
      const { error } = await client.auth.resetPasswordForEmail(normalizedEmail(), { redirectTo: authRedirectUrl() });
      if (error) throw error;
      setConfirmation({ title: "Check your inbox", detail: `A password reset link was requested for ${normalizedEmail()}.` });
    });
  };

  const sendLink = async () => {
    if (!requireEmail()) return;
    const client = clientOrError();
    if (!client) return;
    await runAuthAction("link", async () => {
      const { error } = await client.auth.signInWithOtp({ email: normalizedEmail(), options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl() } });
      if (error) throw error;
      setConfirmation({ title: "Check your inbox", detail: `Open the one-time sign-in link requested for ${normalizedEmail()}.` });
    });
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
