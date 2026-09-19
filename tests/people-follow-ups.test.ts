import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { followUpContactCue, followUpDateBlock, groupFollowUpsByPerson } from "../lib/people-follow-ups";

describe("groupFollowUpsByPerson", () => {
  it("groups named tasks by person and sorts groups and tasks by earliest due date", () => {
    const data = createSeedData();
    const [firstPerson, secondPerson] = data.residents;
    const task = data.followUps[0];
    const tasks = [
      { ...task, id: "later", residentId: firstPerson.id, dueAt: "2026-09-20" },
      { ...task, id: "earliest", residentId: secondPerson.id, dueAt: "2026-09-13" },
      { ...task, id: "first-person-early", residentId: firstPerson.id, dueAt: "2026-09-15" },
    ];

    const groups = groupFollowUpsByPerson(tasks, data);

    expect(groups.map((group) => group.person?.id)).toEqual([secondPerson.id, firstPerson.id]);
    expect(groups[1].tasks.map((followUp) => followUp.id)).toEqual(["first-person-early", "later"]);
  });

  it("keeps address-only tasks as unnamed display groups without creating a person", () => {
    const data = createSeedData();
    const property = data.properties[0];
    const task = { ...data.followUps[0], id: "address-only", residentId: undefined, propertyId: property.id };

    const [group] = groupFollowUpsByPerson([task], data);

    expect(group.label).toBe("Name not known");
    expect(group.address).toContain(property.address);
    expect(group.person).toBeUndefined();
    expect(data.residents).toHaveLength(createSeedData().residents.length);
  });
});

describe("followUpDateBlock", () => {
  it("keeps date-only and timestamp due dates on the church calendar day", () => {
    expect(followUpDateBlock("2026-09-11", "America/Chicago")).toEqual({
      date: "2026-09-11",
      day: "11",
      month: "Sep",
      weekday: "Friday",
    });
    expect(followUpDateBlock("2026-09-12T03:00:00.000Z", "America/Chicago")).toEqual({
      date: "2026-09-11",
      day: "11",
      month: "Sep",
      weekday: "Friday",
    });
  });
});

describe("followUpContactCue", () => {
  it("shows the person's current preference with the matching contact detail", () => {
    const data = createSeedData();
    const person = data.residents.find((resident) => resident.preferredContact === "text")!;
    const task = { ...data.followUps[0], channel: "visit" as const };

    expect(followUpContactCue(task, person)).toEqual({
      kind: "text",
      label: "Text",
      detail: "(555) 010-0142",
      keepDetailTogether: true,
    });
  });

  it("falls back to a readable task channel and location when no preference is recorded", () => {
    const data = createSeedData();
    const person = data.residents.find((resident) => resident.preferredContact === "none")!;
    const property = data.properties.find((candidate) => candidate.id === person.propertyId)!;
    const task = { ...data.followUps[0], channel: "visit" as const };

    expect(followUpContactCue(task, person, property)).toEqual({ kind: "visit", label: "In person", detail: property.address });
    expect(followUpContactCue({ ...task, channel: "other" })).toEqual({ kind: "other", label: "Contact not set" });
  });
});
