import { describe, expect, it } from "vitest";
import { reviewedEncounter, lastRecordedContact } from "../lib/encounter-history";
import { personTimeline } from "../lib/person-timeline";
import { projectOutreachWorkspace } from "../lib/outreach-projection";
import { createSeedData } from "../lib/seed";
import type { Visit } from "../lib/domain";

const correction: NonNullable<Visit["corrections"]>[number] = { id: "review-one", actorId: "leader", createdAt: "2026-09-10T12:00:00Z", reason: "Fictional factual review", outcome: "no_answer", context: "door", voided: false };
describe("reviewed encounter history without rewriting original facts", () => {
  it("derives the latest reviewed state and retains the original and complete chain", () => {
    const original: Visit = { ...createSeedData().visits[0], outcome: "conversation", corrections: [correction, { ...correction, id: "review-two", outcome: "declined", voided: true }] };
    const before = structuredClone(original);
    expect(reviewedEncounter(original)).toMatchObject({ outcome: "declined", voided: true, corrections: before.corrections });
    expect(original).toEqual(before);
    expect(reviewedEncounter({ ...original, corrections: undefined })).toMatchObject({ outcome: "conversation", voided: false });
  });
  it("does not count voided encounters or rewrite independent restrictions, tasks or original records", () => {
    const data = createSeedData(); const property = data.properties[0];
    data.visits = [{ ...data.visits[0], propertyId: property.id, outcome: "conversation", corrections: [{ ...correction, voided: true }] }];
    data.restrictions = [{ id: "restriction", churchId: data.church.id, propertyId: property.id, channel: "visit", active: true, reason: "Fictional request", createdAt: correction.createdAt }];
    const before = structuredClone(data);
    const projected = projectOutreachWorkspace(data);
    expect(projected.properties[0]).toMatchObject({ currentOutcome: "do_not_visit", visitCount: 0, lastVisitedAt: undefined });
    expect(projected.followUps).toEqual(before.followUps); expect(projected.restrictions).toEqual(before.restrictions); expect(projected.visits).toEqual(before.visits); expect(data).toEqual(before);
  });
  it("shows each review in permitted history without borrowing a household member's details", () => {
    const data = createSeedData(); const person = data.residents[0];
    data.visits = [{ ...data.visits[0], residentId: person.id, outcome: "conversation", corrections: [correction] }, { ...data.visits[1], residentId: "other-person", propertyId: person.propertyId, corrections: [{ ...correction, reason: "Fictional PRIVATE OTHER history" }] }];
    const timeline = personTimeline(data, person.id);
    expect(timeline).toContainEqual(expect.objectContaining({ title: "Conversation corrected · No answer · door", body: correction.reason + " Tasks and restrictions unchanged." }));
    expect(JSON.stringify(timeline)).toContain("Original:"); expect(JSON.stringify(timeline)).not.toContain("PRIVATE OTHER");
    expect(personTimeline(data, "unavailable")).toEqual([]);
  });
  it("derives contact only from reviewed person-linked contacts across approved aliases", () => {
    const data = createSeedData(); const person = data.residents[0];
    data.residents.push({ ...person, id: "alias", mergedIntoId: person.id });
    data.visits = [
      { ...data.visits[0], id: "old-contact", residentId: "alias", outcome: "conversation", recordedAt: "2026-01-01T12:00:00Z" },
      { ...data.visits[0], id: "corrected", residentId: person.id, outcome: "conversation", recordedAt: "2026-02-01T12:00:00Z", corrections: [correction] },
      { ...data.visits[0], id: "voided", residentId: person.id, outcome: "conversation", recordedAt: "2026-03-01T12:00:00Z", corrections: [{ ...correction, outcome: "conversation", voided: true }] },
      { ...data.visits[0], id: "same-household", residentId: "other-person", propertyId: person.propertyId, outcome: "conversation", recordedAt: "2026-04-01T12:00:00Z" },
    ];
    const before = structuredClone(data);
    expect(lastRecordedContact(data, person.id)).toEqual({ at: "2026-01-01T12:00:00Z", source: "encounter" });
    expect(lastRecordedContact(data, "alias")).toEqual(lastRecordedContact(data, person.id));
    expect(lastRecordedContact(data, "unavailable")).toBeUndefined(); expect(data).toEqual(before);
    data.visits = [];
    expect(lastRecordedContact(data, person.id)).toEqual({ at: person.lastContactAt, source: "historical" });
    data.residents = data.residents.map((resident) => ({ ...resident, lastContactAt: undefined }));
    expect(lastRecordedContact(data, person.id)).toBeUndefined();
  });
});
