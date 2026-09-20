import { mobileInvitationPath } from "../lib/invitations";
/** Accept only our registered callback, never a URL supplied by an arbitrary site. */
export function authLinkPath(value: string): string | null {
  const invitation = mobileInvitationPath(value);
  if (invitation) return invitation;
  try {
    const url = new URL(value);
    if (url.protocol !== "neighborwalk:" || url.hostname !== "auth" || !["", "/"].includes(url.pathname)) return null;
    if (url.username || url.password || url.port) return null;
    const query = new URLSearchParams(url.search);
    const hash = new URLSearchParams(url.hash.slice(1));
    if (!query.has("code") && !hash.has("access_token") && !hash.has("error_description") && !hash.has("invite")) return null;
    return "/login" + url.search + url.hash;
  } catch { return null; }
}
export async function receiveAuthLink(value: string) {
  const path = ["neighborwalk://sample", "neighborwalk://sample/"].includes(value) ? "/demo" : authLinkPath(value);
  if (!path) return;
  // Capacitor retains the cold-launch URL across webview reloads. Consume it
  // before reloading, or an email callback would reopen itself indefinitely.
  // Keep only a fingerprint, never another copy of the authentication tokens.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sessionStorage.getItem("neighborwalk-consumed-link") === fingerprint) return;
  sessionStorage.setItem("neighborwalk-consumed-link", fingerprint);
  window.location.replace(path);
}
