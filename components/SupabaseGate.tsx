"use client";

import { Check, Mail, MapPinned, Navigation, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { NeighborWalkApp } from "../app/NeighborWalkApp";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase";

export function NeighborWalkRoot() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);

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
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  if (!configured) return <NeighborWalkApp />;
  if (loading) return <ConnectionLoading />;
  if (!session) return <EmailSignIn />;

  return (
    <NeighborWalkApp
      supabaseUser={{
        id: session.user.id,
        email: session.user.email ?? "",
        name: typeof session.user.user_metadata?.full_name === "string"
          ? session.user.user_metadata.full_name
          : typeof session.user.user_metadata?.name === "string"
            ? session.user.user_metadata.name
            : undefined,
      }}
      onSignOut={async () => {
        const client = getSupabaseBrowserClient();
        if (client) await client.auth.signOut();
      }}
    />
  );
}

function authRedirectUrl() {
  const url = new URL(window.location.origin);
  const invitation = new URL(window.location.href).searchParams.get("invite");
  if (invitation) url.searchParams.set("invite", invitation);
  return url.toString();
}

function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const authError = url.searchParams.get("error_description") ?? hashParams.get("error_description");
    if (!authError) return;
    const errorTimer = window.setTimeout(() => setError(authError), 0);
    for (const key of ["error", "error_code", "error_description"]) url.searchParams.delete(key);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    return () => window.clearTimeout(errorTimer);
  }, []);

  const signInWithGoogle = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("The church workspace connection is not available.");
      return;
    }
    setSigningInWithGoogle(true);
    setError("");
    const { error: signInError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl(),
      },
    });
    if (signInError) {
      setSigningInWithGoogle(false);
      setError(signInError.message);
    }
  };

  const sendLink = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("The church workspace connection is not available.");
      return;
    }
    setSending(true);
    setError("");
    const { error: signInError } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: authRedirectUrl(),
      },
    });
    setSending(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    setSent(true);
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="signin-title">
        <div className="auth-route" aria-hidden="true">
          <span><Navigation size={18} /></span><i /><span><MapPinned size={18} /></span>
        </div>
        <p className="eyebrow">NeighborWalk church workspace</p>
        <h1 id="signin-title">Keep every doorstep accounted for.</h1>
        <p className="auth-intro">Sign in securely to share territories, visit outcomes, and follow-up reminders with your church team.</p>
        {sent ? (
          <div className="auth-confirmation" role="status">
            <Check size={20} />
            <div><strong>Check your inbox</strong><span>Open the NeighborWalk sign-in link sent to {email.trim()}.</span></div>
          </div>
        ) : (
          <div className="auth-form">
            <button className="button auth-submit auth-google" disabled={signingInWithGoogle || sending} onClick={() => void signInWithGoogle()}><span className="google-mark" aria-hidden="true">G</span>{signingInWithGoogle ? "Opening Google…" : "Continue with Google"}</button>
            <div className="auth-divider"><span>or use an email link</span></div>
            <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@yourchurch.org" onKeyDown={(event) => { if (event.key === "Enter") void sendLink(); }} /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="button quiet auth-submit" disabled={sending || signingInWithGoogle} onClick={() => void sendLink()}><Mail size={16} />{sending ? "Sending…" : "Email me a sign-in link"}</button>
          </div>
        )}
        <div className="auth-privacy"><ShieldCheck size={16} /><span>Canvassing records are available only to signed-in members of the same church workspace.</span></div>
      </section>
    </main>
  );
}

function ConnectionLoading() {
  return <main className="app-loading" role="status"><div className="loading-mark"><Navigation size={23} /></div><strong>Opening your church workspace</strong><span>Checking your secure session…</span></main>;
}
