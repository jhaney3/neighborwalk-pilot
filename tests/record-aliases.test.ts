import { describe, expect, it } from "vitest";
import { indexCurrentRecords, recordFamilyIds } from "../lib/record-aliases";
import { createSeedData } from "../lib/seed";
import { contactRestricted, liftContactRestriction } from "../lib/contact-restrictions";
import { personTimeline } from "../lib/person-timeline";
import { projectOutreachWorkspace } from "../lib/outreach-projection";
import { exportCsv, previewCsv } from "../lib/csv-exchange";
import { neighborWalkDataSchema, visitsForProperty } from "../lib/domain";

function combinedFixture() {
  const data = createSeedData();
  const person = data.residents[0]; const location = data.properties[0];
  data.residents = [person, { ...person, id: "old-person", name: "Historical duplicate", phone: "555-0101", mergedIntoId: person.id, mergedAt: "2026-09-10T12:00:00Z", status: "archived" }];
  data.properties = [location, { ...location, id: "old-place", mergedIntoId: location.id, mergedAt: "2026-09-10T12:00:00Z" }];
  data.personNotes = [{ ...data.personNotes[0], id: "original-note", residentId: "old-person", body: "Original permitted history" }];
  data.visits = [{ ...data.visits[0], id: "original-encounter", residentId: "old-person", propertyId: "old-place", outcome: "conversation", objectiveNote: "Original encounter" },
    { ...data.visits[0], id: "someone-else", residentId: "other-person", propertyId: "old-place", outcome: "conversation", objectiveNote: "Different person at same place" }];
  data.followUps = [];
  return { data, person, location };
}
describe("preserved duplicate records", () => {
  it("resolves old links, handles chains, and rejects unavailable targets or cycles", () => {
    const records = [{ id: "a", mergedIntoId: "b" }, { id: "b", mergedIntoId: "c" }, { id: "c" }, { id: "d", mergedIntoId: "missing" }, { id: "e", mergedIntoId: "f" }, { id: "f", mergedIntoId: "e" }];
    const index = indexCurrentRecords(records);
    expect(index.get("a")?.id).toBe("c");
    expect([...recordFamilyIds(records, "b")]).toEqual(["a", "b", "c"]);
    expect(index.has("d")).toBe(false); expect(index.has("e")).toBe(false);
    expect(recordFamilyIds(records, "missing").size).toBe(0);
  });
  it("retains original profile metadata in validated device data", () => {
    const { data } = combinedFixture();
    expect(neighborWalkDataSchema.parse(data).residents[1]).toMatchObject({ id: "old-person", mergedIntoId: data.residents[0].id, phone: "555-0101" });
  });
  it("combines only permitted person history without rewriting original record links", () => {
    const { data, person } = combinedFixture(); const original = structuredClone(data);
    const entries = personTimeline(data, person.id);
    expect(entries.filter((entry) => entry.body === "Original permitted history")).toHaveLength(1);
    expect(entries.filter((entry) => entry.body === "Original encounter")).toHaveLength(1);
    expect(entries.some((entry) => entry.body === "Different person at same place")).toBe(false);
    expect(personTimeline(data, "old-person")).toEqual(entries);
    expect(data).toEqual(original);
    data.residents = data.residents.filter((p) => p.id !== person.id);
    expect(personTimeline(data, "old-person")).toEqual([]);
  });
  it("counts combined location history once and resolves old address links", () => {
    const { data, location } = combinedFixture();
    const projected = projectOutreachWorkspace(data);
    expect(projected.properties[0].visitCount).toBe(2);
    expect(projected.properties[1].visitCount).toBe(0);
    expect(visitsForProperty(data, location.id)).toEqual(visitsForProperty(data, "old-place"));
    expect(projected.visits).toEqual(data.visits);
  });
  it("does not bypass canonical restrictions through old links or lift two requests at once", () => {
    const { data, person, location } = combinedFixture();
    data.restrictions = ["one", "two"].map((id) => ({ id, churchId: data.church.id, residentId: person.id, channel: "email", active: true, reason: "Independent no-email request", createdAt: "2026-09-10T12:00:00Z" }));
    expect(contactRestricted(data, "old-person", "email")).toBe(true);
    expect(contactRestricted(data, "old-person", "call")).toBe(false);
    const lifted = liftContactRestriction(data, "one", "First request corrected after review");
    expect(contactRestricted(lifted, "old-person", "email")).toBe(true);
    data.restrictions.push({ id: "place", churchId: data.church.id, propertyId: location.id, channel: "visit", active: true, reason: "No visits", createdAt: "2026-09-10T12:00:00Z" });
    expect(contactRestricted(data, undefined, "visit", "old-place")).toBe(true);
    expect(contactRestricted(data, "missing-person", "email")).toBe(true);
  });
  it("exports current profiles but still checks original names and phones for import duplicates", () => {
    const { data } = combinedFixture();
    expect(exportCsv(data, "people")).not.toContain("old-person");
    expect(exportCsv(data, "locations")).not.toContain("old-place");
    expect(previewCsv("name,phone\nHistorical duplicate,555-0101", "people", data).rows[0].problems.length).toBeGreaterThan(0);
  });
});
