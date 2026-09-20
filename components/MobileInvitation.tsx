"use client";
import { useState } from "react";
import { mobileInvitationPath } from "../lib/invitations";

export function MobileInvitation() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  return <details className="auth-email-fallback"><summary>Have a church invitation?</summary>
    <p>Paste the invitation link your leader sent. Sign in with Apple, Google, or your email to accept a shared invitation.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const path = mobileInvitationPath(link.trim());
        if (!path) throw new Error();
        window.location.replace(path);
      } catch { setError("Paste a complete NeighborWalk invitation link from your leader."); }
    }}><label className="form-field"><span>Invitation link</span><input type="url" autoCapitalize="none" autoCorrect="off" value={link} onChange={(event) => setLink(event.target.value)} required /></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button quiet auth-submit" type="submit">Use invitation</button>
    </form>
  </details>;
}
