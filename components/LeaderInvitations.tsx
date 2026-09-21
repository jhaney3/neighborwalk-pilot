"use client";

import { Copy, Mail, MessageCircle, Share2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { invitationDraftHref, invitationLink, invitationMessage } from "../lib/invitations";
import { getSupabaseBrowserClient } from "../lib/supabase";
import styles from "./Invitations.module.css";

type ContactKind = "email" | "phone";
type PendingInvitation = { id: string; contactKind: ContactKind; contact: string; name: string; role: string; expiresAt: string };
type ReadyInvitation = { link: string; contact: string; kind: ContactKind; name: string };

function readableError(error: unknown) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : "Please check your connection and try again.";
}

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error("Copy was blocked. Select the invitation link and copy it manually.");
  await navigator.clipboard.writeText(value);
}

export function LeaderInvitations({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const [kind, setKind] = useState<ContactKind>("email");
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"volunteer" | "leader">("volunteer");
  const [pending, setPending] = useState<PendingInvitation[]>([]);
  const [ready, setReady] = useState<ReadyInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Connect to manage invitations.");
    const { data, error: loadError } = await client.rpc("list_shared_invitations");
    if (loadError) throw loadError;
    setPending(data as unknown as PendingInvitation[]);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load).catch((failure) => setError(readableError(failure)));
  }, [load]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Reconnect to invite someone.");
    const normalized = kind === "email" ? contact.trim().toLowerCase() : contact.replace(/[\s().-]/g, "");
    if (kind === "email" && !/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("Enter a valid email address.");
    if (kind === "phone" && !/^\+[1-9]\d{6,14}$/.test(normalized)) throw new Error("Include the country code, for example +1 615 555 0123.");
    const { data, error: createError } = await client.rpc("create_shared_invitation", {
      contact_kind: kind,
      contact_value: normalized,
      recipient_name: name.trim(),
      invitation_role: role,
    });
    if (createError) throw createError;
    const result = data as { token?: string } | null;
    if (!result?.token) throw new Error("The invitation link was not created.");
    setReady({ link: invitationLink(window.location.origin, result.token, "join"), contact: normalized, kind, name: name.trim() });
    setContact("");
    setName("");
    setMessage("Invitation ready. Choose how to share it below.");
    await load();
    await onChanged();
  };

  const share = async () => {
    if (!ready) return;
    const text = invitationMessage(ready.name, ready.link);
    if (navigator.share) {
      await navigator.share({ title: "Join us on NeighborWalk", text: text.slice(0, -ready.link.length).trim(), url: ready.link });
      setMessage("Invitation shared. Your device’s share app handles delivery.");
      return;
    }
    await copyText(text);
    setMessage("Invitation copied. Paste it into a private message.");
  };

  const readyMessage = ready ? invitationMessage(ready.name, ready.link) : "";

  return <div className={`member-invite-card ${styles.card}`}>
    <div className="member-card-heading"><span><UserPlus size={18} /></span><div><strong>Invite a member</strong><small>Create a private, single-use invitation.</small></div></div>
    <form className={styles.card} onSubmit={(event) => { event.preventDefault(); void run(create); }}>
      <div className={styles.segment} role="group" aria-label="Invite by">
        <button type="button" aria-pressed={kind === "email"} onClick={() => { setKind("email"); setContact(""); }}>Email</button>
        <button type="button" aria-pressed={kind === "phone"} onClick={() => { setKind("phone"); setContact(""); }}>Phone</button>
      </div>
      <label className="form-field"><span>Name <small>(optional)</small></span><input autoComplete="off" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Who’s joining you?" /></label>
      <label className="form-field"><span>{kind === "phone" ? "Phone number with country code" : "Email address"}</span><input required type={kind === "phone" ? "tel" : "email"} inputMode={kind === "phone" ? "tel" : "email"} autoComplete="off" maxLength={320} value={contact} onChange={(event) => setContact(event.target.value)} placeholder={kind === "phone" ? "+1 615 555 0123" : "friend@example.com"} /></label>
      <label className="form-field"><span>Access level</span><select value={role} onChange={(event) => setRole(event.target.value as "volunteer" | "leader")}><option value="volunteer">Volunteer — field tools only</option><option value="leader">Leader — members, territories, and settings</option></select></label>
      <p className={styles.note}>Anyone signed in with this link can join as a {role}, even with a different verified email. Share it privately with one person. Creating another invitation for this contact replaces their previous link.</p>
      <button className="button primary" disabled={busy || !contact.trim()}>Create invitation</button>
    </form>

    {ready && <div className={styles.ready}>
      <strong>Ready for {ready.name || ready.contact}</strong>
      <div className={styles.actions}>
        <button type="button" className="button primary" disabled={busy} onClick={() => void run(share)}><Share2 size={17} /> Share</button>
        <a className="button quiet" href={invitationDraftHref(ready.kind, ready.contact, readyMessage)}>{ready.kind === "phone" ? <MessageCircle size={17} /> : <Mail size={17} />}{ready.kind === "phone" ? "Messages" : "Mail"}</a>
        <button type="button" className="button quiet" disabled={busy} onClick={() => void run(async () => { await copyText(readyMessage); setMessage("Invitation copied."); })}><Copy size={16} /> Copy</button>
      </div>
      <input aria-label="Invitation link" readOnly value={ready.link} onFocus={(event) => event.currentTarget.select()} />
      <p className={styles.note}>Your chosen app handles sending; NeighborWalk cannot confirm delivery. Copy the link now because its secret is only shown here once.</p>
    </div>}

    {message && <p className="member-message" role="status">{message}</p>}
    {error && <p className="member-message error" role="alert">{error}</p>}
    <div className={styles.pending}>
      <strong>Pending shared invitations</strong>
      {pending.map((invitation) => <div className={styles.row} key={invitation.id}><p><strong>{invitation.name || invitation.contact}</strong><small>{invitation.name ? `${invitation.contact} · ` : ""}{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></p><button type="button" className="button quiet" disabled={busy} onClick={() => void run(async () => {
        const client = getSupabaseBrowserClient();
        if (!client) throw new Error("Reconnect to revoke this invitation.");
        const { data, error: revokeError } = await client.rpc("revoke_shared_invitation", { invitation_id: invitation.id });
        if (revokeError) throw revokeError;
        if (!data) throw new Error("That invitation is no longer pending.");
        setReady(null);
        await load();
        await onChanged();
        setMessage("Invitation revoked.");
      })}>Revoke</button></div>)}
      {!pending.length && <p className={styles.note}>No pending shared invitations.</p>}
      <button type="button" className="button quiet" disabled={busy} onClick={() => void run(load)}>Refresh invitations</button>
    </div>
  </div>;
}
