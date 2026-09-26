"use client";
import { useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { actionFailed } from "../mobile/haptics";

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
  return <details className="auth-email-fallback"><summary>Sign in with your phone number</summary><p>We’ll text a code to verify your number. This creates an account if you’re new. Message and data rates may apply.</p>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void run(sentTo ? verify : send); }}>
      {!sentTo ? <label className="form-field"><span>Phone number with country code</span><input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 615 555 0123" /></label> : <><p role="status">Code sent to {sentTo}.</p><label className="form-field"><span>Verification code</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={code} onChange={(event) => setCode(event.target.value)} /></label></>}
      <button className="button quiet auth-submit" disabled={busy}>{busy ? "Please wait…" : sentTo ? "Verify and continue" : "Text me a code"}</button>
      {sentTo && <><button type="button" className="button quiet" disabled={busy} onClick={() => void run(send)}>Send another code</button><button type="button" className="button quiet" disabled={busy} onClick={() => { setSentTo(""); setCode(""); }}>Use another number</button></>}
      {error && <p role="alert" className="auth-error">{error}</p>}
    </form>
  </details>;
}
