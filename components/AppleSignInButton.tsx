"use client";
import styles from "./Invitations.module.css";

export function AppleSignInButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return <button type="button" className={styles.apple} disabled={busy} onClick={onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="24" fill="currentColor"><path d="M17.1 12.4c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3-1.7-1.3-.2-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.7-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.7 1.1 8.9.7 1 1.5 2.1 2.7 2.1 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 1.9-1 2.6-2 .8-1.2 1.2-2.3 1.2-2.4-.1 0-2.3-.9-2.3-4.1ZM15 6.2c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.7 1.3-.6.6-1.1 1.7-1 2.7 1 .1 2.1-.5 2.8-1.1Z" /></svg>
    {busy ? "Opening Apple…" : "Continue with Apple"}
  </button>;
}
