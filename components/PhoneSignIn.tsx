"use client";
import { Smartphone } from "lucide-react";
import { useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { actionFailed } from "../mobile/haptics";
import { EntryDisclosure } from "./EntryScreens";

export function PhoneSignIn() {
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const send = async () => {
    const normalized = phone.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{6,14}$/.test(normalized)) throw new Error("Include your country code, for example +1 615 555 0123.");
    if (Date.now() < retryAt) throw new Error("Please wait a minute before requesting another code.");
    const client = getSupabaseBrowserClient(); if (!client) throw new Error("Reconnect to sign in.");
    const { error } = await client.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: true } });
    if (error) throw error;
    setSentTo(normalized); setCode(""); setRetryAt(Date.now() + 60000);
  };
  const verify = async () => {
    const client = getSupabaseBrowserClient(); if (!client) throw new Error("Reconnect to sign in.");
    const { error } = await client.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: "sms" });
    if (error) throw error;
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (failure) { actionFailed(); setError(failure instanceof Error ? failure.message : "Sign-in could not finish. Please retry."); } finally { setBusy(false); }
  };
  return <EntryDisclosure icon={<Smartphone size={19} aria-hidden="true" />} title="Sign in with your phone number" detail="We’ll text you a code">
    <p className="sheet-copy">This creates an account if you’re new. Message and data rates may apply.</p>
    <form className="entry-form" onSubmit={(event) => { event.preventDefault(); void run(sentTo ? verify : send); }}>
      {!sentTo
        ? <label className="entry-field"><span className="mono-meta">Phone number with country code</span><input className="sheet-input" required type="tel" autoComplete="tel" enterKeyHint="send" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 615 555 0123" /></label>
        : <><p className="mono-meta entry-sent" role="status">Code sent to {sentTo}.</p><label className="entry-field"><span className="mono-meta">Verification code</span><input className="sheet-input" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} enterKeyHint="go" value={code} onChange={(event) => setCode(event.target.value)} /></label></>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button-ink wide" disabled={busy}>{busy ? "Please wait…" : sentTo ? "Verify and continue" : "Text me a code"}</button>
      {sentTo && <div className="entry-links"><button type="button" disabled={busy} onClick={() => void run(send)}>Send another code</button><button type="button" disabled={busy} onClick={() => { setSentTo(""); setCode(""); }}>Use another number</button></div>}
    </form>
  </EntryDisclosure>;
}
