import { describe, expect, it } from "vitest";
import { addContactRestriction, contactRestricted, liftContactRestriction } from "../lib/contact-restrictions";
import { personTimeline } from "../lib/person-timeline";
import { createSeedData } from "../lib/seed";
describe("contact restrictions and permitted history", () => {
  it("keeps a pause separate from contact restrictions and blocks only the requested channel", () => {
    const data = createSeedData(); const person = data.residents[0]; person.status = "paused";
    expect(contactRestricted(data, person.id, "email")).toBe(false);
    const restricted = addContactRestriction(data, { residentId: person.id, channel: "email", reason: "Neighbor requested no email" });
    expect(contactRestricted(restricted, person.id, "email")).toBe(true);
    expect(contactRestricted(restricted, person.id, "call")).toBe(false);
    const corrected = liftContactRestriction(restricted, restricted.restrictions!.at(-1)!.id, "Neighbor corrected the request");
    expect(contactRestricted(corrected, person.id, "email")).toBe(false);
    expect(corrected.followUps).toEqual(restricted.followUps);
    expect(corrected.restrictions!.at(-1)!.correctionReason).toBeDefined();
  });
  it("does not pull another person's history from the same address", () => {
    const data = createSeedData(); const person = data.residents[0];
    data.visits = [{ ...data.visits[0], id: "private-elsewhere", propertyId: person.propertyId, residentId: "other-person", objectiveNote: "Must not appear" }];
    expect(JSON.stringify(personTimeline(data, person.id))).not.toContain("Must not appear");
    expect(personTimeline(data, "unavailable-person")).toEqual([]);
  });
});
