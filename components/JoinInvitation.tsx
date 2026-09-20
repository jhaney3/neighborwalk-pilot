"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { clearPendingInvitation } from "../lib/invitations";

type Preview = { joined: boolean; churchName: string; role?: string };
export function JoinInvitation({ token, account }: { token: string; account: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const finish = () => { clearPendingInvitation(); window.location.replace("/app/today"); };
  useEffect(() => {
    let active = true;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    void client.rpc("shared_invitation", { invitation_token: token }).then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      else setPreview(data as Preview);
    });
    return () => { active = false; };
  }, [token]);
  const join = async () => {
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Reconnect to join your church.");
      const { error } = await client.rpc("shared_invitation", { invitation_token: token, accept_invitation: true });
      if (error) throw error;
      finish();
    } catch (failure) { setError(failure instanceof Error ? failure.message : (failure as { message?: string }).message ?? "Could not join. Please retry."); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell"><section className="auth-card">
    <p className="eyebrow">You’re invited</p><h1>{preview ? preview.churchName : "Your church invitation"}</h1>
    <p>Signed in as {account}. Your account email can differ from the address your leader invited, including Apple’s Hide My Email.</p>
    {preview && <><p>{preview.joined ? "You’ve joined this workspace." : `Join as a ${preview.role}. This invitation can be used once.`}</p>
      <button className="button primary auth-submit" disabled={busy} onClick={() => preview.joined ? finish() : void join()}>{busy ? "Joining…" : preview.joined ? "Open workspace" : "Join church"}</button></>}
    {!preview && !error && <p role="status">Checking invitation…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {error && <button className="button quiet" onClick={() => window.location.reload()}>Try again</button>}
    <button className="button quiet" disabled={busy} onClick={finish}>Leave invitation</button>
  </section></main>;
}
