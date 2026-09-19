import { describe, expect, it } from "vitest";
import { captureInvitation, invitationLink, INVITATION_STORAGE_KEY, pendingInvitation } from "../lib/invitations";
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
