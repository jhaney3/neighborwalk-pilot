import { storageKey } from "./environment";

export const INVITATION_STORAGE_KEY = storageKey("neighborwalk-pending-invitation");
const lifetime = 7 * 24 * 60 * 60 * 1000;
type InvitationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type InvitationKind = "invite" | "join";

export function invitationLink(origin: string, token: string, kind: InvitationKind = "invite") {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("The invitation token is invalid.");
  const url = new URL("/invite", origin);
  // Fragments are not sent in HTTP requests or Referer headers.
  url.hash = kind + "=" + token;
  return url.toString();
}

export function captureInvitation(url: URL, storage: InvitationStorage, now = Date.now()): string | null {
  const hash = new URLSearchParams(url.hash.slice(1));
  const join = hash.get("join");
  const legacy = hash.get("invite") ?? url.searchParams.get("invite");
  if (join !== null && legacy !== null) throw new Error("This invitation link is invalid.");
  const token = join ?? legacy;
  if (token === null) return null;
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("This invitation link is invalid. Ask your leader for a new link.");
  // Only scrub the address after preserving the token. A storage failure must
  // leave the original usable link intact, not silently discard the invitation.
  storage.setItem(INVITATION_STORAGE_KEY, JSON.stringify({ token, capturedAt: now, kind: join !== null ? "join" : "invite" }));
  url.searchParams.delete("invite");
  hash.delete("invite");
  hash.delete("join");
  url.hash = hash.toString();
  return url.pathname + url.search + url.hash;
}

export function pendingInvitation(storage: InvitationStorage, now = Date.now()): string | null {
  const value = storage.getItem(INVITATION_STORAGE_KEY);
  if (!value) return null;
  try {
    const record = JSON.parse(value);
    if (/^[a-f0-9]{64}$/i.test(record.token) && Number.isFinite(record.capturedAt) && record.capturedAt <= now && now - record.capturedAt < lifetime) return record.token;
  } catch { /* An invalid invitation is not an authorization source. */ }
  storage.removeItem(INVITATION_STORAGE_KEY);
  return null;
}

export function rememberBrowserInvitation() {
  const path = captureInvitation(new URL(window.location.href), window.sessionStorage);
  if (path) window.history.replaceState(null, "", path);
}

export function clearPendingInvitation() {
  window.sessionStorage.removeItem(INVITATION_STORAGE_KEY);
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete("invite");
  hash.delete("join");
  url.hash = hash.toString();
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export function pendingInvitationKind(storage: InvitationStorage): InvitationKind | null {
  if (!pendingInvitation(storage)) return null;
  try {
    return JSON.parse(storage.getItem(INVITATION_STORAGE_KEY)!).kind === "join" ? "join" : "invite";
  } catch {
    return null;
  }
}

export function invitationMessage(recipientName: string, link: string) {
  return `${recipientName.trim() ? `Hi ${recipientName.trim()}! ` : ""}Join our church on SendMe. Open this private link and sign in with Apple, Google, or your email. This invitation works once and expires in 7 days.\n${link}`;
}

export function invitationDraftHref(kind: "email" | "phone", contact: string, message: string) {
  if (kind === "email") return `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent("Join us on SendMe")}&body=${encodeURIComponent(message)}`;
  return `sms:${contact}?body=${encodeURIComponent(message)}`;
}
