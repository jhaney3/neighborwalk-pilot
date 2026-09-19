import { describe, expect, it } from "vitest";
import { isCommunityOuting } from "../components/OutreachView";

describe("community walk provenance", () => {
  const eventId = "walk-community-check";

  it("allows the propertyless recorder only when the walk has no assignment history or saved targets", () => {
    expect(isCommunityOuting(eventId, [], [])).toBe(true);
    expect(isCommunityOuting(eventId, [{ eventId, status: "cancelled" }], [])).toBe(false);
    expect(isCommunityOuting(eventId, [{ eventId, status: "declined" }], [])).toBe(false);
    expect(isCommunityOuting(eventId, [], [{ eventId }])).toBe(false);
    expect(isCommunityOuting(eventId, [{ eventId: "another-walk" }], [{ eventId: "another-walk" }])).toBe(true);
  });
});
