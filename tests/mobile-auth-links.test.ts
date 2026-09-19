import { describe, expect, it, vi } from "vitest";
import { authLinkPath, receiveAuthLink } from "../mobile/auth-links";
import { isAppPath } from "../mobile/navigation";

describe("iOS app route boundary", () => {
  it("accepts workspace details without including the marketing routes", () => {
    for (const route of ["/app/today", "/app/outreach/walk-123/field", "/app/people/person-123", "/login", "/invite", "/demo"]) expect(isAppPath(route)).toBe(true);
    for (const route of ["/", "/pricing", "/privacy", "/about", "/app/fake", "/app/people/id/extra", "//evil.test/app/today"]) expect(isAppPath(route)).toBe(false);
  });
});

describe("iOS authentication callback", () => {
  it("consumes a cold-launch link once across document reloads without storing tokens", async () => {
    const values = new Map<string, string>();
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
    try {
      const callback = "neighborwalk://auth#access_token=secret-token&type=recovery";
      await receiveAuthLink(callback);
      await receiveAuthLink(callback);
      expect(replace).toHaveBeenCalledExactlyOnceWith("/login#access_token=secret-token&type=recovery");
      expect([...values.values()][0]).toMatch(/^[a-f0-9]{64}$/);
      expect([...values.values()][0]).not.toContain("secret-token");
    } finally { vi.unstubAllGlobals(); }
  });
  it("preserves recovery parameters for the auth client", () => {
    expect(authLinkPath("neighborwalk://auth#access_token=token&refresh_token=refresh&type=recovery")).toBe("/login#access_token=token&refresh_token=refresh&type=recovery");
    expect(authLinkPath("neighborwalk://auth?code=one-time-code")).toBe("/login?code=one-time-code");
  });
  it("rejects untrusted hosts, paths, credentials, schemes and arbitrary navigation", () => {
    for (const value of ["https://evil.test?code=a", "neighborwalk://evil?code=a", "neighborwalk://auth/extra?code=a", "neighborwalk://user@auth?code=a", "neighborwalk://auth:80?code=a", "neighborwalk://auth?next=https://evil.test", "not a URL"]) expect(authLinkPath(value)).toBeNull();
  });
});
