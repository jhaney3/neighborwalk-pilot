import { describe, expect, it } from "vitest";
import { walkCalendarFile } from "../lib/walk-calendar";

describe("walkCalendarFile", () => {
  it("builds one event in UTC with escaped text", () => {
    const file = walkCalendarFile({ id: "walk_1", name: "Saturday outreach, north", startsAt: "2026-09-26T14:30:00.000Z", endsAt: "2026-09-26T16:30:00.000Z", meetingPoint: "Welcome table; north entrance", purpose: "Listen well" }, "Grace Harbor", new Date("2026-09-24T12:00:00.000Z"));
    expect(file.split("\r\n")).toEqual([
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NeighborWalk//Walk//EN", "BEGIN:VEVENT",
      "UID:walk_1@neighborwalk.app", "DTSTAMP:20260924T120000Z", "DTSTART:20260926T143000Z", "DTEND:20260926T163000Z",
      "SUMMARY:Saturday outreach\\, north", "LOCATION:Welcome table\\; north entrance", "DESCRIPTION:Grace Harbor — Listen well",
      "END:VEVENT", "END:VCALENDAR", "",
    ]);
  });
});
