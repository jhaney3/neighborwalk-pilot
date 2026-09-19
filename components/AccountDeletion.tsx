"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { Modal } from "./ui";

export function AccountDeletion() {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ request_id: string; requested_at: string } | null>(null);
  const submit = async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !confirmed) return;
    setBusy(true); setError("");
    try {
      const { data, error: failure } = await client.rpc("request_account_deletion");
      if (failure) throw failure;
      const result = data as { request_id?: string; requested_at?: string } | null;
      if (!result?.request_id || !result.requested_at) throw new Error("The deletion request was not confirmed. Please try again.");
      setReceipt({ request_id: result.request_id, requested_at: result.requested_at });
    } catch { setError("Your deletion request could not be confirmed. Reconnect and try again. Your account has not been deleted."); }
    finally { setBusy(false); }
  };
  return <>
    <button className="button danger" onClick={() => setOpen(true)}><Trash2 size={16} /> Delete account</button>
    {open && <Modal title={receipt ? "Deletion requested" : "Delete your account?"} description={receipt ? "Your request has been securely recorded." : "This permanently removes your account and associated personal data. It cannot be undone once completed."} onClose={() => { if (!busy) setOpen(false); }}>
      {receipt ? <div role="status"><p>Your account and associated personal data will be deleted within 30 days. You’ll receive confirmation at your account email when it is complete.</p><p>Request reference: <code>{receipt.request_id}</code></p><button className="button primary" onClick={() => setOpen(false)}>Done</button></div> : <>
        <p>Deletion is processed within 30 days. Your account stays available until processing is complete. We’ll email you when it is finished. Records that must legally be retained will be explained in that confirmation.</p>
        <p>Share any pending fieldwork first. Deleting your account does not uninstall this app or automatically erase offline copies on your devices.</p>
        <label className="toggle-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I want to permanently delete my account and associated personal data.</span></label>
        {error && <p role="alert" className="inline-error">{error}</p>}
        <div className="modal-actions"><button className="button quiet" disabled={busy} onClick={() => setOpen(false)}>Keep account</button><button className="button danger" disabled={!confirmed || busy} onClick={() => void submit()}>{busy ? "Submitting…" : "Request account deletion"}</button></div>
      </>}
    </Modal>}
  </>;
}
