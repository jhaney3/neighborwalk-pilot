import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { checkInCompletion, followUpInList, groupFollowUpsByWhen, relativeDueLabel, snoozeChoices } from "../lib/follow-up-groups";
import type { FollowUp } from "../lib/domain";

const TODAY = "2026-09-24"; // a Thursday

function task(id: string, dueAt: string, overrides: Partial<FollowUp> = {}): FollowUp {
  return { id, churchId: "c", dueAt, status: "scheduled", history: [], createdAt: "2026-09-20T12:00:00.000Z", assignedVolunteerId: "volunteer_erica", acceptance: "accepted", ...overrides };
}

describe("relativeDueLabel", () => {
  it("uses words near today, weekdays within a week, dates beyond", () => {
    expect(relativeDueLabel("2026-09-24", TODAY)).toBe("Today");
    expect(relativeDueLabel("2026-09-23", TODAY)).toBe("Yesterday");
    expect(relativeDueLabel("2026-09-25", TODAY)).toBe("Tomorrow");
    expect(relativeDueLabel("2026-09-22", TODAY)).toBe("Tue");
    expect(relativeDueLabel("2026-09-29", TODAY)).toBe("Tue");
    expect(relativeDueLabel("2026-10-08", TODAY)).toBe("Oct 8");
  });
});

describe("groupFollowUpsByWhen", () => {
  it("groups by when, in due order, skipping empty groups", () => {
    const groups = groupFollowUpsByWhen([
      task("later", "2026-10-09"),
      task("week", "2026-09-26"),
      task("overdue", "2026-09-22"),
      task("today", "2026-09-24"),
    ], "America/Chicago", TODAY);
    expect(groups.map((group) => [group.label, group.tasks.map((item) => item.id)])).toEqual([
      ["Overdue", ["overdue"]], ["Today", ["today"]], ["This week", ["week"]], ["Later", ["later"]],
    ]);
    expect(groupFollowUpsByWhen([task("week", "2026-09-30")], "America/Chicago", TODAY).map((group) => group.key)).toEqual(["week"]);
  });
});

describe("followUpInList", () => {
  it("keeps declined follow-ups out of Mine and puts them in the Open queue", () => {
    const data = createSeedData();
    const declined = task("d", TODAY, { acceptance: "declined" });
    const unowned = task("u", TODAY, { assignedVolunteerId: "someone_gone" });
    const mine = task("m", TODAY);
    expect(followUpInList(mine, "mine", data, "volunteer_erica")).toBe(true);
    expect(followUpInList(declined, "mine", data, "volunteer_erica")).toBe(false);
    expect(followUpInList(declined, "open", data, "volunteer_erica")).toBe(true);
    expect(followUpInList(unowned, "open", data, "volunteer_erica")).toBe(true);
    expect(followUpInList(mine, "open", data, "volunteer_erica")).toBe(false);
  });
});

describe("snoozeChoices", () => {
  it("offers tomorrow, the day of your next walk and next week", () => {
    const data = createSeedData();
    data.church.timezone = "America/Chicago";
    data.events = [{ ...data.events[0], id: "walk", status: "ready", startsAt: "2026-09-26T14:30:00.000Z", endsAt: "2026-09-26T17:00:00.000Z" }];
    data.outingParticipants = [{ id: "p", churchId: data.church.id, eventId: "walk", volunteerId: "volunteer_erica", status: "going" }];
    expect(snoozeChoices(data, "volunteer_erica", new Date("2026-09-24T15:00:00.000Z"))).toEqual([
      { label: "Tomorrow", date: "2026-09-25" },
      { label: "Before the next walk", date: "2026-09-26" },
      { label: "Next week", date: "2026-10-01" },
    ]);
    expect(snoozeChoices(data, "volunteer_maya", new Date("2026-09-24T15:00:00.000Z")).map((choice) => choice.label)).toEqual(["Tomorrow", "Next week"]);
  });
});

describe("checkInCompletion", () => {
  it("records the outcome and chains the same next step unless all set", () => {
    const original = task("t", TODAY, { note: "Check in after the appointment", assignedTeamId: "team" });
    expect(checkInCompletion(original, "unreached", "2026-10-01", " Phone went to voicemail ")).toEqual({
      completionNote: "Couldn’t reach them — Phone went to voicemail",
      nextFollowUp: { dueAt: "2026-10-01", note: "Check in after the appointment", assignedTeamId: "team" },
    });
    expect(checkInCompletion(original, "all_set", "2026-10-01").nextFollowUp).toBeUndefined();
    expect(checkInCompletion(original, "talked", null)).toEqual({ completionNote: "Talked with them", nextFollowUp: undefined });
  });
});
