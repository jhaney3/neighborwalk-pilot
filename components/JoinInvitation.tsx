"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { clearPendingInvitation } from "../lib/invitations";
import { actionFailed } from "../mobile/haptics";
import { EntryBrand, EntryScreen, EntryTitle } from "./EntryScreens";

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
    } catch (failure) { actionFailed(); setError(failure instanceof Error ? failure.message : (failure as { message?: string }).message ?? "Could not join. Please retry."); }
    finally { setBusy(false); }
  };
  return <JoinInvitationView preview={preview} error={error} busy={busy} account={account} onJoin={() => preview?.joined ? finish() : void join()} onLeave={finish} />;
}

export function JoinInvitationView({ preview, error, busy, account, onJoin, onLeave }: { preview: Preview | null; error: string; busy: boolean; account: string; onJoin: () => void; onLeave: () => void }) {
  return <EntryScreen labelledBy="join-title">
    <EntryBrand />
    <EntryTitle id="join-title" meta={preview?.joined ? "You’ve joined" : preview?.role ? `You’re invited as a ${preview.role}` : "You’re invited"}>{preview ? preview.churchName : "Your church invitation"}</EntryTitle>
    <div className="offset-card entry-card">
      <p className="entry-account-line"><span className="mono-meta">Signed in as</span> <strong>{account}</strong></p>
      <p className="sheet-copy">This can differ from the address your leader invited, including Apple’s Hide My Email.</p>
    </div>
    {!preview && !error && <p className="mono-meta entry-waiting" role="status">Checking invitation…</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="entry-actions">
      {preview && <button type="button" className="button-ink wide" disabled={busy} onClick={onJoin}>{busy ? "Joining…" : preview.joined ? "Open workspace" : "Join church"}</button>}
      {error && <button type="button" className="button-outline wide" onClick={() => window.location.reload()}>Try again</button>}
      <button type="button" className="entry-text-link" disabled={busy} onClick={onLeave}>Leave invitation</button>
    </div>
    {preview && !preview.joined && <p className="mono-meta entry-footnote">This invitation works once</p>}
  </EntryScreen>;
}
