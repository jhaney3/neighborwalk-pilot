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
      supabaseUser={{ id: session.user.id, email: session.user.email ?? "" }}
      onSignOut={async () => {
        const client = getSupabaseBrowserClient();
        if (client) await client.auth.signOut();
      }}
    />
  );
}

function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

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
        emailRedirectTo: `${window.location.origin}/`,
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
        <p className="auth-intro">Sign in with your email to securely share territories, visit outcomes, and follow-up reminders with your church team.</p>
        {sent ? (
          <div className="auth-confirmation" role="status">
            <Check size={20} />
            <div><strong>Check your inbox</strong><span>Open the NeighborWalk sign-in link sent to {email.trim()}.</span></div>
          </div>
        ) : (
          <div className="auth-form">
            <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@yourchurch.org" onKeyDown={(event) => { if (event.key === "Enter") void sendLink(); }} /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="button primary auth-submit" disabled={sending} onClick={() => void sendLink()}><Mail size={16} />{sending ? "Sending…" : "Email me a sign-in link"}</button>
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
