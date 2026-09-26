"use client";

import { CloudOff, Mail, PlugZap, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { NeighborWalkApp } from "../app/NeighborWalkApp";
import { isMobileApp } from "../lib/mobile";
import { authErrorMessage, validAuthEmail } from "../lib/auth";
import { authServiceUnreachable, authStorageKey, getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase";
import { isProductionApp } from "../lib/environment";
import { authenticatedAppPath, safeAppPath } from "../lib/auth-navigation";
import { pendingInvitationKind, pendingInvitation, rememberBrowserInvitation } from "../lib/invitations";
import { preparedOfflineIdentity, WORKSPACE_CACHE_KEY, type PreparedIdentity } from "../lib/offline-identity";
import { PhoneSignIn } from "./PhoneSignIn";
import { JoinInvitation } from "./JoinInvitation";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { signInWithGoogleNative } from "../mobile/google-auth";
import { AppleSignInButton } from "./AppleSignInButton";
import { signInWithApple } from "../mobile/apple-auth";
import { MobileInvitation } from "./MobileInvitation";
import { cancelDeviceReminders } from "../mobile/notifications";
import { unregisterRemotePush } from "../mobile/push-notifications";
import { actionFailed } from "../mobile/haptics";
import { EntryBrand, EntryLoading, EntryNotice, EntryScreen, EntryTitle } from "./EntryScreens";

export function NeighborWalkRoot() {
  const router = useRouter();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();
  const localAuthPreview = isMobileApp && !isProductionApp && pathname === "/login";
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
  const email = session?.user.email || session?.user.phone || "";
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
        if (!data.session && isMobileApp) {
          void cancelDeviceReminders().catch(() => {});
          void unregisterRemotePush().catch(() => {});
        }
        setLoading(false);
      }
    }).catch(() => { if (active) { setConnectionError("Sign-in could not be checked. Reconnect and try again. Your device records have not been cleared."); setLoading(false); } });
    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (active) {
        setSession(nextSession);
        if (nextSession) { setConnectionError(""); setOfflineCandidate(null); setOfflineUser((current) => current?.id === nextSession.user.id ? current : null); }
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        if (event === "SIGNED_OUT") {
          setPasswordRecovery(false);
          setOfflineUser(null);
          setOfflineCandidate(null);
          if (isMobileApp) {
            void cancelDeviceReminders().catch(() => {});
            void unregisterRemotePush().catch(() => {});
          }
        }
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

  if (!configured && !localAuthPreview) return <WorkspaceUnavailable />;
  if (!offlineUser && !session && offlineCandidate && !passwordRecovery) return <OfflineWorkspace onOpen={() => {
    const candidate = !pendingInvitation(window.sessionStorage) ? preparedOfflineIdentity(window.localStorage, authStorageKey()) : null;
    if (candidate?.id === offlineCandidate.id) { setOfflineUser(candidate); setConnectionError(""); setLoading(false); }
    else { setOfflineCandidate(null); setConnectionError("This device now needs an online sign-in and membership check. Saved work has not been cleared."); }
  }} />;
  if (connectionError && !offlineUser) return <ConnectionProblem error={connectionError} />;
  if (loading && !offlineUser) return <ConnectionLoading />;
  if (!workspaceUser) return <SignInScreen />;
  if (passwordRecovery && session) return <PasswordRecovery email={session.user.email ?? "your account"} onSave={async (password) => { await updatePassword(password); setPasswordRecovery(false); }} />;
  if (session && pendingInvitationKind(window.sessionStorage) === "join") return <JoinInvitation token={pendingInvitation(window.sessionStorage)!} account={session.user.email ?? session.user.phone ?? "your account"} />;
  if (["/login", "/invite"].includes(pathname)) return <ConnectionLoading />;

  return (
    <NeighborWalkApp
      key={workspaceUser.id}
      supabaseUser={workspaceUser}
      onUpdatePassword={updatePassword}
      onSignOut={async () => {
        const client = getSupabaseBrowserClient();
        if (isMobileApp) await unregisterRemotePush().catch(() => false);
        if (client) { const { error } = await client.auth.signOut({ scope: "local" }); if (error) throw new Error(authErrorMessage(error)); }
      }}
    />
  );
}

function authRedirectUrl() {
  const url = isMobileApp ? new URL("neighborwalk://auth") : new URL("/login", window.location.origin);
  const next = window.location.pathname.startsWith("/app/") ? safeAppPath(window.location.pathname + window.location.search) : authenticatedAppPath(window.location.search);
  if (next !== "/app/today") url.searchParams.set("next", next);
  return url.toString();
}

type AuthAction = "apple" | "google" | "password" | "signup" | "reset" | "link" | null;

export function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [action, setAction] = useState<AuthAction>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string } | null>(null);
  const [error, setError] = useState("");
  const emailField = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLDivElement>(null);
  // A link or reset starts lower down the screen; bring its answer into view.
  useEffect(() => { if (error || confirmation) status.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [error, confirmation]);

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
    emailField.current?.focus();
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
    catch (error) { actionFailed(); setError(authErrorMessage(error)); }
    finally { setAction(null); }
  };

  const signInWithGoogle = async () => {
    if (isMobileApp) { await runAuthAction("google", signInWithGoogleNative); return; }
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
  const signingIn = mode === "signin";
  const switchMode = (next: "signin" | "signup") => { setMode(next); setError(""); setConfirmation(null); };
  const providers = isMobileApp || isProductionApp;
  return (
    <EntryScreen labelledBy="signin-title" className="entry-signin">
      <EntryBrand />
      <EntryTitle id="signin-title" meta="Your church workspace">{signingIn ? "Sign in" : "Create account"}</EntryTitle>
      {providers && <div className="entry-providers">
        {isMobileApp
          ? <><AppleSignInButton busy={busy} onClick={() => void runAuthAction("apple", signInWithApple)} /><GoogleSignInButton disabled={busy} loading={action === "google"} onClick={() => void signInWithGoogle()} /></>
          : <button type="button" className="button auth-submit auth-google" disabled={busy} onClick={() => void signInWithGoogle()}><span className="google-mark" aria-hidden="true">G</span>{action === "google" ? "Opening Google…" : "Continue with Google"}</button>}
        <p className="entry-divider mono-meta" aria-hidden="true"><span>or with email</span></p>
      </div>}
      <form className="entry-form" onSubmit={(event) => { event.preventDefault(); void submitPassword(); }}>
        <label className="entry-field"><span className="mono-meta">Email address</span><input ref={emailField} className="sheet-input" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" enterKeyHint="next" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@yourchurch.org" /></label>
        <label className="entry-field"><span className="mono-meta">Password</span><input className="sheet-input" type="password" minLength={8} autoComplete={signingIn ? "current-password" : "new-password"} enterKeyHint="go" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={signingIn ? undefined : "At least 8 characters"} /></label>
        <div ref={status} className="entry-status">
          {error && <p className="inline-error" role="alert">{error}</p>}
          {confirmation && <div className="offset-card entry-confirmation" role="status"><p className="mono-meta">{confirmation.title}</p><p>{confirmation.detail}</p></div>}
        </div>
        <button className="button-ink wide" disabled={busy}>{action === "password" || action === "signup" ? "Please wait…" : signingIn ? "Sign in" : "Create account"}</button>
      </form>
      <div className="entry-links">
        {signingIn
          ? <><button type="button" disabled={busy} onClick={() => void sendReset()}>Forgot password?</button><button type="button" disabled={busy} onClick={() => switchMode("signup")}>Create an account</button></>
          : <button type="button" disabled={busy} onClick={() => switchMode("signin")}>Back to sign in</button>}
      </div>
      {!signingIn && <p className="sheet-copy entry-hint">We’ll send one email to confirm your account. After that, you sign in with your password.</p>}
      <section className="settings-group" aria-labelledby="signin-more">
        <h2 className="mono-meta sheet-label" id="signin-more">More ways in</h2>
        <div className="grouped-rows">
          <button type="button" className="grouped-row" disabled={busy} onClick={() => void sendLink()}>
            <Mail size={19} aria-hidden="true" />
            <span className="grouped-row-text"><strong>{action === "link" ? "Sending…" : "Email me a sign-in link"}</strong><small>No password needed</small></span>
          </button>
          {isMobileApp && process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED === "true" && <PhoneSignIn />}
          {isMobileApp && <MobileInvitation />}
        </div>
      </section>
      <nav className="entry-footer mono-meta" aria-label="Sign-in support"><Link href="/help">Help</Link>{isMobileApp && <Link href="/demo">Explore the demo</Link>}<Link href="/privacy">Privacy</Link></nav>
    </EntryScreen>
  );
}

export function PasswordRecovery({ email, onSave }: { email: string; onSave: (password: string) => Promise<void> }) {
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
      actionFailed();
      setError(authErrorMessage(saveError));
      setSaving(false);
    }
  };
  return <EntryScreen labelledBy="recovery-title">
    <EntryBrand />
    <EntryTitle id="recovery-title" meta={<>Account recovery · <span className="entry-account">{email}</span></>}>New password</EntryTitle>
    <p className="sheet-copy">Choose a password for next time. You won’t need an email link to sign in.</p>
    <form className="entry-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="entry-field"><span className="mono-meta">New password</span><input className="sheet-input" type="password" minLength={8} autoComplete="new-password" enterKeyHint="next" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
      <label className="entry-field"><span className="mono-meta">Confirm password</span><input className="sheet-input" type="password" minLength={8} autoComplete="new-password" enterKeyHint="done" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="button-ink wide" disabled={saving}>{saving ? "Saving…" : "Save password and continue"}</button>
    </form>
  </EntryScreen>;
}

export function ConnectionLoading() {
  return <EntryLoading status="Checking your sign-in…" />;
}

export function WorkspaceUnavailable() {
  return <EntryNotice id="unavailable-title" tone="problem" icon={<PlugZap size={22} />} title="Can’t connect yet"
    reassurance="Real church records won’t be replaced with sample data"
    actions={<Link className="button-outline wide" href="/demo">Explore the sample church</Link>}>
    <p>This copy of the app isn’t connected to a church service. Ask whoever set it up to finish connecting it.</p>
  </EntryNotice>;
}

export function OfflineWorkspace({ onOpen }: { onOpen: () => void }) {
  return <EntryNotice id="offline-title" icon={<WifiOff size={22} />} title="You’re offline"
    reassurance="New work stays on this phone until you’re back online"
    actions={<><button type="button" className="button-ink wide" onClick={onOpen}>Open saved records</button><button type="button" className="button-outline wide" onClick={() => window.location.reload()}>Try signing in again</button></>}>
    <p>Sign-in can’t be reached. This phone checked in with your church in the last 24 hours, so you can reopen the records saved here. This isn’t a new sign-in.</p>
    <p>Signing out, or losing access to your church, turns this off.</p>
  </EntryNotice>;
}

export function ConnectionProblem({ error }: { error: string }) {
  return <EntryNotice id="connection-title" tone="problem" icon={<CloudOff size={22} />} title="Can’t check your sign-in"
    reassurance="Nothing on this phone was cleared"
    actions={<><button type="button" className="button-ink wide" onClick={() => window.location.reload()}>Try again</button><Link className="button-outline wide" href="/login">Open sign-in</Link><Link className="entry-text-link" href="/help">Sign-in help</Link></>}>
    <p role="alert" className="inline-error">{error}</p>
    <p>If an email link opened somewhere else, sign in there, then open your church invitation again.</p>
  </EntryNotice>;
}
