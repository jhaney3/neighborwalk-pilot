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

import { mobileInvitationPath, pendingInvitationKind } from "../lib/invitations";
describe("shared invitation links", () => {
  const token = "b".repeat(64);
  it("preserves the new invitation type through authentication without exposing it in requests", () => {
    const cache = storage();
    const url = new URL(invitationLink("https://neighborwalk-pilot.vercel.app", token, "join"));
    expect(url.search).toBe("");
    expect(captureInvitation(url, cache)).toBe("/invite");
    expect(pendingInvitation(cache)).toBe(token);
    expect(pendingInvitationKind(cache)).toBe("join");
  });
  it("does not reinterpret old invitations as bearer invitations", () => {
    const cache = storage();
    cache.setItem(INVITATION_STORAGE_KEY, JSON.stringify({ token, capturedAt: Date.now() }));
    expect(pendingInvitationKind(cache)).toBe("invite");
    expect(() => captureInvitation(new URL(`https://neighborwalk-pilot.vercel.app/invite#join=${token}&invite=${token}`),cache)).toThrow("invalid");
  });
  it("accepts only allowed invitation hosts and routes", () => {
    expect(mobileInvitationPath(`neighborwalk://invite#join=${token}`)).toBe(`/invite#join=${token}`);
    expect(mobileInvitationPath(`https://neighborwalk-pilot.vercel.app/invite#join=${token}`)).toBe(`/invite#join=${token}`);
    for(const url of [`https://evil.test/invite#join=${token}`,`neighborwalk://user@invite#join=${token}`,`neighborwalk://invite:80#join=${token}`,`neighborwalk://invite/extra#join=${token}`,`https://neighborwalk-pilot.vercel.app/invite#join=bad`]) expect(mobileInvitationPath(url)).toBeNull();
  });
});
