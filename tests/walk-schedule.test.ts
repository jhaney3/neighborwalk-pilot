import { describe, expect, it } from "vitest";
import { addLocalMinutes, clockLabel, durationLabel, localMinutesBetween, walkDayChoices } from "../lib/walk-schedule";

describe("walkDayChoices", () => {
  it("offers tomorrow and the coming weekend without duplicates", () => {
    // Thursday Sep 24, 2026 in Chicago.
    expect(walkDayChoices("America/Chicago", new Date("2026-09-24T15:00:00Z"))).toEqual([
      { label: "Tomorrow", date: "2026-09-25" },
      { label: "Sat 26", date: "2026-09-26" },
      { label: "Sun 27", date: "2026-09-27" },
    ]);
    // Friday: tomorrow is Saturday, so Saturday isn't repeated.
    expect(walkDayChoices("America/Chicago", new Date("2026-09-25T15:00:00Z")).map((choice) => choice.label)).toEqual(["Tomorrow", "Sun 27"]);
    // Saturday: the next weekend.
    expect(walkDayChoices("America/Chicago", new Date("2026-09-26T15:00:00Z")).map((choice) => choice.date)).toEqual(["2026-09-27", "2026-10-03", "2026-10-04"]);
  });
});

describe("local time arithmetic", () => {
  it("adds and measures minutes on church-local values", () => {
    expect(addLocalMinutes("2026-09-26T09:30", 120)).toBe("2026-09-26T11:30");
    expect(addLocalMinutes("2026-09-26T23:30", 90)).toBe("2026-09-27T01:00");
    expect(localMinutesBetween("2026-09-26T09:30", "2026-09-26T11:00")).toBe(90);
  });

  it("formats clock times and durations", () => {
    expect(clockLabel("09:30")).toBe("9:30 AM");
    expect(clockLabel("18:00")).toBe("6:00 PM");
    expect(clockLabel("12:05")).toBe("12:05 PM");
    expect(durationLabel(60)).toBe("1 hr");
    expect(durationLabel(90)).toBe("1.5 hrs");
    expect(durationLabel(120)).toBe("2 hrs");
  });
});
