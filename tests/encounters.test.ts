import { describe, expect, it } from "vitest";
import { recordEncounter } from "../lib/encounters";
import { createSeedData } from "../lib/seed";
import { requireCalendarDate } from "../lib/calendar";

const now = new Date("2026-09-10T01:00:00Z");
describe("community encounters", () => {
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
  it("rejects missing entities, impossible dates, and ambiguous anonymous next steps before acknowledgement", () => {
    const before = createSeedData();
    expect(() => recordEncounter(before, { propertyId: "missing", outcome: "conversation" }, "a", "d", now)).toThrow("no longer");
    expect(() => recordEncounter(before, { outcome: "do_not_visit" }, "a", "d", now)).toThrow("location");
    expect(() => recordEncounter(before, { outcome: "follow_up" }, "a", "d", now)).toThrow("description");
    expect(() => requireCalendarDate("2026-02-30")).toThrow("valid calendar");
    expect(() => requireCalendarDate("2026-09-10T00:00:00Z")).toThrow("valid calendar");
  });
});
