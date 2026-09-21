import { describe, expect, it } from "vitest";
import { captureInvitation, invitationDraftHref, invitationLink, invitationMessage, INVITATION_STORAGE_KEY, pendingInvitation, pendingInvitationKind } from "../lib/invitations";
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
describe("private invitation entry", () => {
  const token = "a".repeat(64);
  it("keeps new invitation secrets out of request paths and query strings", () => {
    const url = new URL(invitationLink("https://neighborwalk.test", token));
    expect(url.pathname).toBe("/invite"); expect(url.search).toBe(""); expect(url.hash).toBe("#invite=" + token);
  });
  it("preserves a token before scrubbing legacy URLs without discarding authentication callbacks", () => {
    const cache = storage();
    expect(captureInvitation(new URL("https://neighborwalk.test/login?invite=" + token + "&code=auth-code#type=recovery"), cache, 100)).toBe("/login?code=auth-code#type=recovery");
    expect(pendingInvitation(cache, 101)).toBe(token);
    expect(pendingInvitation(cache, 100 + 7 * 86400000)).toBeNull();
  });
  it("leaves the original URL intact if session storage cannot preserve it", () => {
    const url = new URL(invitationLink("https://neighborwalk.test", token));
    expect(() => captureInvitation(url, { ...storage(), setItem: () => { throw new Error("Storage blocked"); } })).toThrow("Storage blocked");
    expect(url.hash).toBe("#invite=" + token);
  });
  it("rejects malformed, corrupt and future-dated invitation state", () => {
    const cache = storage();
    expect(() => captureInvitation(new URL("https://neighborwalk.test/invite#invite=bad"), cache)).toThrow("invalid");
    cache.setItem(INVITATION_STORAGE_KEY, JSON.stringify({ token, capturedAt: 200 })); expect(pendingInvitation(cache, 100)).toBeNull();
    cache.setItem(INVITATION_STORAGE_KEY, "broken"); expect(pendingInvitation(cache)).toBeNull();
  });
});

describe("shared invitation links", () => {
  const token = "b".repeat(64);

  it("preserves the shared invitation type without exposing its token in a request", () => {
    const cache = storage();
    const now = Date.now();
    const url = new URL(invitationLink("https://neighborwalk.test", token, "join"));
    expect(url.search).toBe("");
    expect(url.hash).toBe("#join=" + token);
    expect(captureInvitation(url, cache, now)).toBe("/invite");
    expect(pendingInvitation(cache, now + 1)).toBe(token);
    expect(pendingInvitationKind(cache)).toBe("join");
  });

  it("keeps legacy email-bound invitations distinct and rejects ambiguous links", () => {
    const cache = storage();
    cache.setItem(INVITATION_STORAGE_KEY, JSON.stringify({ token, capturedAt: Date.now() }));
    expect(pendingInvitationKind(cache)).toBe("invite");
    expect(() => captureInvitation(new URL(`https://neighborwalk.test/invite#join=${token}&invite=${token}`), cache)).toThrow("invalid");
  });

  it("builds addressed email and text drafts around the private link", () => {
    const link = invitationLink("https://neighborwalk.test", token, "join");
    const message = invitationMessage("Sam", link);
    expect(message).toContain("Hi Sam!");
    expect(message).toContain(link);
    expect(invitationDraftHref("email", "sam@example.com", message)).toMatch(/^mailto:sam%40example\.com\?subject=/);
    expect(invitationDraftHref("phone", "+16155550123", message)).toMatch(/^sms:\+16155550123\?body=/);
  });
});
