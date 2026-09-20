"use client";
import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Copy, Mail, MessageCircle, Share2, UserPlus } from "lucide-react";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { invitationLink } from "../lib/invitations";
import styles from "./Invitations.module.css";

type Pending = { id: string; contactKind: string; contact: string; name: string; role: string; expiresAt: string };
const errorMessage = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Please check your connection and try again.";
export function LeaderInvitations({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const [kind, setKind] = useState<"email" | "phone">("phone");
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("volunteer");
  const [pending, setPending] = useState<Pending[]>([]);
  const [ready, setReady] = useState<{ link: string; contact: string; kind: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const origin = process.env.NEXT_PUBLIC_INVITE_ORIGIN;
  const load = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Connect to manage invitations.");
    const { data, error } = await client.rpc("list_shared_invitations");
    if (error) throw error;
    setPending(data as Pending[]);
  }, []);
  useEffect(() => { void Promise.resolve().then(load).catch((failure) => setError(errorMessage(failure))); }, [load]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const create = async () => {
    if (!origin || new URL(origin).protocol !== "https:") throw new Error("The operator needs to connect the invitation website before links can be shared.");
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Reconnect to invite someone.");
    const normalized = kind === "email" ? contact.trim().toLowerCase() : contact.replace(/[\s().-]/g, "");
    if (kind === "phone" && !/^\+[1-9]\d{6,14}$/.test(normalized)) throw new Error("Include the country code, for example +1 615 555 0123.");
    const { data, error } = await client.rpc("create_shared_invitation", { contact_kind: kind, contact_value: normalized, recipient_name: name.trim(), invitation_role: role });
    if (error) throw error;
    const result = data as { token: string };
    setReady({ link: invitationLink(origin, result.token, "join"), contact: normalized, kind, name: name.trim() });
    setContact(""); setName("");
    setMessage("Invitation ready. Choose how to share it below.");
    await load(); await onChanged();
  };
  const text = ready ? `${ready.name ? `Hi ${ready.name}! ` : ""}Join our church on NeighborWalk. Open this link and sign in with Apple, Google, or your email. This invitation works once and expires in 7 days.\n${ready.link}` : "";
  const share = async () => {
    if (!ready) return;
    if (Capacitor.isNativePlatform()) await Share.share({ title: "Join us on NeighborWalk", text, dialogTitle: "Share invitation" });
    else if (navigator.share) await navigator.share({ title: "Join us on NeighborWalk", text });
    else { await navigator.clipboard.writeText(text); setMessage("Invitation copied. Paste it into a message."); }
  };
  return <div className={`member-invite-card ${styles.card}`}>
    <div className="member-card-heading"><span><UserPlus size={18} /></span><div><strong>Bring someone along</strong><small>A personal invitation to your church workspace.</small></div></div>
    <form className={styles.card} onSubmit={(event) => { event.preventDefault(); void run(create); }}>
      <div className={styles.segment} aria-label="Invite by"><button type="button" aria-pressed={kind === "phone"} onClick={() => { setKind("phone"); setContact(""); }}>Phone</button><button type="button" aria-pressed={kind === "email"} onClick={() => { setKind("email"); setContact(""); }}>Email</button></div>
      <label className="form-field"><span>Name <small>(optional)</small></span><input autoComplete="off" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Who’s joining you?" /></label>
      <label className="form-field"><span>{kind === "phone" ? "Phone number with country code" : "Email address"}</span><input required type={kind === "phone" ? "tel" : "email"} inputMode={kind === "phone" ? "tel" : "email"} autoComplete="off" maxLength={320} value={contact} onChange={(event) => setContact(event.target.value)} placeholder={kind === "phone" ? "+1 615 555 0123" : "friend@example.com"} /></label>
      <label className="form-field"><span>Access level</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="volunteer">Volunteer — field tools</option><option value="leader">Leader — church administration</option></select></label>
      <p className={styles.note}>Anyone signed in with this link can join as a {role}, even with a different email. Share it privately with one person. Creating another invitation for this contact replaces their previous link.</p>
      <button className="button primary" disabled={busy || !contact.trim()}>Create invitation</button>
    </form>
    {ready && <div className={styles.card}><strong>Ready for {ready.name || ready.contact}</strong><div className={styles.actions}>
      <button className="button primary" disabled={busy} onClick={() => void run(share)}><Share2 size={17} /> Share</button>
      <a className="button quiet" href={ready.kind === "phone" ? `sms:${ready.contact}&body=${encodeURIComponent(text)}` : `mailto:${encodeURIComponent(ready.contact)}?subject=Join%20us%20on%20NeighborWalk&body=${encodeURIComponent(text)}`}>{ready.kind === "phone" ? <MessageCircle size={17} /> : <Mail size={17} />}{ready.kind === "phone" ? "Messages" : "Mail"}</a>
      <button className="button quiet" onClick={() => void run(async () => { await navigator.clipboard.writeText(text); setMessage("Invitation copied."); })}><Copy size={16} /> Copy</button>
    </div><input aria-label="Invitation link" readOnly value={ready.link} onFocus={(event) => event.currentTarget.select()} /><p className={styles.note}>Your message app handles sending. This screen cannot confirm delivery. Copy the link now; it is only shown here once.</p></div>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="inline-error">{error}</p>}
    <div className={styles.pending}><strong>Pending invitations</strong>{pending.map((invite) => <div className={styles.row} key={invite.id}><p><strong>{invite.name || invite.contact}</strong><small>{invite.name && `${invite.contact} · `}{invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}</small></p><button className="button quiet" disabled={busy} onClick={() => void run(async () => {
      const client = getSupabaseBrowserClient(); if (!client) throw new Error("Reconnect to revoke this invitation.");
      const { error } = await client.rpc("revoke_shared_invitation", { invitation_id: invite.id }); if (error) throw error;
      setReady(null); await load(); await onChanged(); setMessage("Invitation revoked.");
    })}>Revoke</button></div>)}{!pending.length && <p className={styles.note}>No pending shared invitations.</p>}<button className="button quiet" disabled={busy} onClick={() => void run(load)}>Refresh invitations</button></div>
  </div>;
}
