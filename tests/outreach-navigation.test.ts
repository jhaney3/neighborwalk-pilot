import { describe, expect, it } from "vitest";
import { appHref, appRoute, validAppSegments } from "../lib/app-routes";
import { churchDateTimeToIso, localDateTimeValue } from "../lib/calendar";

describe("addressable church workflows", () => {
  it("round trips stable routes and fieldwork context", () => {
    for (const view of ["today", "outreach", "people", "followups", "map", "more", "leader", "settings"] as const) {
      expect(appRoute(appHref(view)).view).toBe(view);
    }
    expect(appRoute("/app/people/person_123")).toEqual({ view: "people", id: "person_123" });
    expect(appRoute("/app/outreach/outing_123/field")).toEqual({ view: "map", fieldOutingId: "outing_123" });
    expect(appRoute("/app/locations/location_123").fieldOutingId).toBeUndefined();
  });
  it("does not treat arbitrary nested paths as app sections", () => {
    expect(validAppSegments(["outreach", "outing_123", "field"])).toBe(true);
    for (const path of [["unknown"], ["settings", "secret"], ["people", ".."], ["outreach", "one", "field", "extra"]]) {
      expect(validAppSegments(path)).toBe(false);
    }
  });
});

describe("church-local outing times", () => {
  it("keeps the church wall clock regardless of this device timezone", () => {
    expect(churchDateTimeToIso("2026-09-12T09:00", "America/Chicago")).toBe("2026-09-12T14:00:00.000Z");
    expect(churchDateTimeToIso("2026-01-12T09:00", "America/Chicago")).toBe("2026-01-12T15:00:00.000Z");
    expect(localDateTimeValue("2026-09-12T14:00:00Z", "America/Chicago")).toBe("2026-09-12T09:00");
  });
  it("rejects DST gaps and repeated hours explicitly", () => {
    expect(() => churchDateTimeToIso("2026-03-08T02:30", "America/Chicago")).toThrow("does not exist");
    expect(() => churchDateTimeToIso("2026-11-01T01:30", "America/Chicago")).toThrow("repeats");
    expect(churchDateTimeToIso("2026-11-01T02:30", "America/Chicago")).toBe("2026-11-01T08:30:00.000Z");
  });
  it("supports non-hour offsets and rejects incomplete or invalid choices", () => {
    expect(churchDateTimeToIso("2026-09-12T09:00", "Asia/Kathmandu")).toBe("2026-09-12T03:15:00.000Z");
    expect(() => churchDateTimeToIso("", "America/Chicago")).toThrow();
    expect(() => churchDateTimeToIso("2026-02-30T09:00", "America/Chicago")).toThrow();
  });
});
