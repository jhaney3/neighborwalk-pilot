"use client";

import styles from "./Invitations.module.css";

export function AppleSignInButton({ disabled, loading, onClick }: { disabled: boolean; loading: boolean; onClick: () => void }) {
  return <button type="button" className={`${styles.provider} ${styles.apple}`} disabled={disabled} onClick={onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="22" fill="currentColor"><path d="M17.1 12.4c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3-1.7-1.3-.2-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.7-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.7 1.1 8.9.7 1 1.5 2.1 2.7 2.1 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 1.9-1 2.6-2 .8-1.2 1.2-2.3 1.2-2.4-.1 0-2.3-.9-2.3-4.1ZM15 6.2c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.7 1.3-.6.6-1.1 1.7-1 2.7 1 .1 2.1-.5 2.8-1.1Z" /></svg>
    {loading ? "Opening Apple…" : "Continue with Apple"}
  </button>;
}

export function GoogleSignInButton({ disabled, loading, onClick }: { disabled: boolean; loading: boolean; onClick: () => void }) {
  return <button type="button" className={styles.provider} disabled={disabled} onClick={onClick}>
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>
    {loading ? "Opening Google…" : "Continue with Google"}
  </button>;
}
