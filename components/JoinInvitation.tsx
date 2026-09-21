"use client";

import { useEffect, useState } from "react";
import { clearPendingInvitation } from "../lib/invitations";
import { getSupabaseBrowserClient } from "../lib/supabase";

type Preview = { joined: boolean; churchName: string; role?: string; expiresAt?: string };

function readableError(error: unknown) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : "The invitation could not be opened. Check your connection and try again.";
}

export function JoinInvitation({ token, account }: { token: string; account: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const finish = () => {
    clearPendingInvitation();
    window.location.replace("/app/today");
  };

  useEffect(() => {
    let active = true;
    const client = getSupabaseBrowserClient();
    if (!client) {
      queueMicrotask(() => setError("Reconnect to open this invitation."));
      return;
    }
    void Promise.resolve(client.rpc("shared_invitation", { invitation_token: token })).then(({ data, error: previewError }) => {
      if (!active) return;
      if (previewError) setError(readableError(previewError));
      else setPreview(data as Preview);
    }).catch((previewError: unknown) => {
      if (active) setError(readableError(previewError));
    });
    return () => { active = false; };
  }, [token]);

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Reconnect to join your church.");
      const { error: joinError } = await client.rpc("shared_invitation", { invitation_token: token, accept_invitation: true });
      if (joinError) throw joinError;
      finish();
    } catch (failure) {
      setError(readableError(failure));
      setBusy(false);
    }
  };

  return <main className="auth-shell"><section className="auth-card" aria-labelledby="invitation-title">
    <p className="eyebrow">You’re invited</p>
    <h1 id="invitation-title">{preview?.churchName ?? "Your church invitation"}</h1>
    <p className="auth-intro">Signed in as {account}. Your sign-in email can differ from the address your leader used, including Apple’s Hide My Email.</p>
    {preview && <div className="auth-form">
      <p>{preview.joined ? "You’ve joined this workspace." : `Review and join as a ${preview.role}. This private invitation can be used once.`}</p>
      <button className="button primary auth-submit" disabled={busy} onClick={() => preview.joined ? finish() : void join()}>{busy ? "Joining…" : preview.joined ? "Open workspace" : "Join church"}</button>
    </div>}
    {!preview && !error && <p role="status">Checking invitation…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {error && <button className="button quiet auth-submit" onClick={() => window.location.reload()}>Try again</button>}
    <button className="button quiet auth-submit" disabled={busy} onClick={finish}>Leave invitation</button>
  </section></main>;
}
