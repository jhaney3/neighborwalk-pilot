import { describe, expect, it } from "vitest";
import { authenticatedAppPath, legacyAppPath } from "../lib/auth-navigation";
import { publicSiteConfig } from "../lib/site-config";
import { offlineMembershipValid } from "../lib/offline-access";
describe("safe app entry points", () => {
  it("preserves old bookmarks and auth callbacks without external redirects", () => {
    expect(legacyAppPath("?view=followups", "")).toBe("/app/followups");
    expect(legacyAppPath("", "", true)).toBe("/app/today");
    expect(legacyAppPath("", "")).toBeNull();
    expect(legacyAppPath("", "#type=recovery&access_token=fictional")).toBe("/login#type=recovery&access_token=fictional");
    expect(authenticatedAppPath("?next=https://evil.test")).toBe("/app/today");
    expect(authenticatedAppPath("?next=//evil.test")).toBe("/app/today");
    expect(authenticatedAppPath("?next=/app/people/person_1")).toBe("/app/people/person_1");
    const invite = "a".repeat(64);
    expect(authenticatedAppPath("?invite=" + invite)).toBe("/app/today?invite=" + invite);
  });
  it("keeps pilot enrollment closed until required decisions are explicitly configured", () => {
    expect(publicSiteConfig({}).pilotOpen).toBe(false);
    expect(publicSiteConfig({ NEIGHBORWALK_PILOT_OPEN: "true" }).pilotOpen).toBe(false);
    expect(publicSiteConfig({ NEIGHBORWALK_OPERATOR_NAME: "Fictional operator", NEIGHBORWALK_SUPPORT_EMAIL: "test@example.test", NEIGHBORWALK_POLICIES_APPROVED: "true", NEIGHBORWALK_PILOT_OPEN: "true" }).pilotOpen).toBe(true);
  });
  it("bounds cached membership and rejects future or invalid verification times", () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    expect(offlineMembershipValid("2026-09-09T12:01:00Z", now)).toBe(true);
    expect(offlineMembershipValid("2026-09-09T12:00:00Z", now)).toBe(false);
    expect(offlineMembershipValid("2026-09-11T12:00:00Z", now)).toBe(false);
    expect(offlineMembershipValid(undefined, now)).toBe(false);
  });
});
