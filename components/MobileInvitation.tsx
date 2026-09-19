"use client";
import { useState } from "react";
import { appServiceOrigin } from "../lib/mobile";

export function MobileInvitation() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  return <details className="auth-email-fallback"><summary>Have a church invitation?</summary>
    <p>Paste the invitation link your leader sent. Then sign in with the invited email address.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const url = new URL(link.trim());
        const token = new URLSearchParams(url.hash.slice(1)).get("invite") ?? url.searchParams.get("invite");
        if (url.origin !== appServiceOrigin || url.pathname !== "/invite" || !token || !/^[a-f0-9]{64}$/i.test(token)) throw new Error();
        window.location.replace("/invite#invite=" + token);
      } catch { setError("Paste a complete NeighborWalk invitation link from your leader."); }
    }}><label className="form-field"><span>Invitation link</span><input type="url" autoCapitalize="none" autoCorrect="off" value={link} onChange={(event) => setLink(event.target.value)} required /></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button quiet auth-submit" type="submit">Use invitation</button>
    </form>
  </details>;
}
