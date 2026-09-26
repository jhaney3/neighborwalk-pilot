"use client";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { mobileInvitationPath } from "../lib/invitations";
import { EntryDisclosure } from "./EntryScreens";

export function MobileInvitation() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  return <EntryDisclosure icon={<Link2 size={19} aria-hidden="true" />} title="Have a church invitation?" detail="Paste the link your leader sent">
    <p className="sheet-copy">Sign in with Apple, Google or your email to accept it.</p>
    <form className="entry-form" onSubmit={(event) => {
      event.preventDefault();
      try {
        const path = mobileInvitationPath(link.trim());
        if (!path) throw new Error();
        window.location.replace(path);
      } catch { setError("Paste a complete SendMe invitation link from your leader."); }
    }}><label className="entry-field"><span className="mono-meta">Invitation link</span><input className="sheet-input" type="url" autoCapitalize="none" autoCorrect="off" enterKeyHint="go" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" required /></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button-ink wide" type="submit">Use invitation</button>
    </form>
  </EntryDisclosure>;
}
