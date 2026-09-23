import { describe, expect, it } from "vitest";
import { recordEncounter } from "../lib/encounters";
import { createSeedData } from "../lib/seed";
import { requireCalendarDate } from "../lib/calendar";

const now = new Date("2026-09-10T01:00:00Z");
describe("community encounters", () => {
  it("saves where a conversation happened, what was shared and when", () => {
    const before = createSeedData();
    const after = recordEncounter(before, { context: "community_meal", outcome: "conversation", placeLabel: "  Friday supper ", needs: ["prayer", "food", "prayer"], occurredAt: "2026-09-09T23:00:00Z" }, "volunteer", "device", now);
    expect(after.visits[0]).toMatchObject({ placeLabel: "Friday supper", needs: ["food", "prayer"], recordedAt: "2026-09-09T23:00:00.000Z" });
  });
  it("keeps a linked person's prayer request private and an anonymous one with the shared note", () => {
    const before = createSeedData(); const person = before.residents[0];
    const linked = recordEncounter(before, { residentId: person.id, context: "service", outcome: "conversation", prayerRequest: "Her mother's surgery" }, "volunteer", "device", now);
    expect(linked.visits[0].objectiveNote).toBeUndefined();
    expect(linked.personNotes[0]).toMatchObject({ residentId: person.id, kind: "prayer", body: "Her mother's surgery" });
    const anonymous = recordEncounter(before, { context: "service", outcome: "conversation", objectiveNote: "Talked by the grill", prayerRequest: "New job" }, "volunteer", "device", now);
    expect(anonymous.visits[0].objectiveNote).toBe("Talked by the grill\nPrayer: New job");
  });
  it("rejects a place name at the door, unknown needs and future times", () => {
    const before = createSeedData(); const property = before.properties[0];
    expect(() => recordEncounter(before, { propertyId: property.id, outcome: "conversation", placeLabel: "Porch" }, "a", "d", now)).toThrow("home, not a place");
    expect(() => recordEncounter(before, { context: "service", outcome: "conversation", needs: ["money" as never] }, "a", "d", now)).toThrow("needs");
    expect(() => recordEncounter(before, { context: "service", outcome: "conversation", occurredAt: "2026-09-11T01:00:00Z" }, "a", "d", now)).toThrow("already happened");
  });
  it("records an anonymous meal without creating a household or a person", () => {
    const before = createSeedData();
    const after = recordEncounter(before, { context: "community_meal", outcome: "conversation" }, "volunteer", "device", now);
    expect(after.visits[0]).toMatchObject({ context: "community_meal", propertyId: undefined, residentId: undefined });
    expect(after.properties).toEqual(before.properties);
    expect(after.residents).toEqual(before.residents);
  });
  it("keeps person notes protected and never silently drops a conversation note", () => {
    const before = createSeedData(); const person = before.residents[0];
    const after = recordEncounter(before, { residentId: person.id, context: "referral", outcome: "conversation", objectiveNote: "Private requested care" }, "volunteer", "device", now);
    expect(after.visits[0].objectiveNote).toBeUndefined();
    expect(after.personNotes[0]).toMatchObject({ residentId: person.id, body: "Private requested care" });
  });
  it("assigns an anonymous requested next step and keeps its explicit outing", () => {
    const before = createSeedData();
    const after = recordEncounter(before, { eventId: before.events[0].id, context: "service", outcome: "follow_up", objectiveNote: "Bring requested volunteer information", followUpDate: "2026-09-10" }, "volunteer", "device", now);
    expect(after.followUps.at(-1)).toMatchObject({ assignedVolunteerId: "volunteer", dueAt: "2026-09-10", eventId: before.events[0].id, propertyId: undefined, channel: "other" });
  });
  it("keeps a community encounter address-free while its person's task follows their saved location", () => {
    const before = createSeedData(); const person = before.residents[0];
    const after = recordEncounter(before, { residentId: person.id, context: "community_meal", outcome: "follow_up", objectiveNote: "Requested check-in", followUpDate: "2026-09-10" }, person.assignedVolunteerId, "device", now);
    expect(after.visits[0].propertyId).toBeUndefined();
    expect(after.followUps.at(-1)).toMatchObject({ residentId: person.id, propertyId: person.propertyId, assignedVolunteerId: person.assignedVolunteerId });
  });
  it("rejects missing entities, impossible dates, and ambiguous anonymous next steps before acknowledgement", () => {
    const before = createSeedData();
    expect(() => recordEncounter(before, { propertyId: "missing", outcome: "conversation" }, "a", "d", now)).toThrow("no longer");
    expect(() => recordEncounter(before, { outcome: "do_not_visit" }, "a", "d", now)).toThrow("location");
    expect(() => recordEncounter(before, { outcome: "follow_up" }, "a", "d", now)).toThrow("description");
    expect(() => requireCalendarDate("2026-02-30")).toThrow("valid calendar");
    expect(() => requireCalendarDate("2026-09-10T00:00:00Z")).toThrow("valid calendar");
  });
});
