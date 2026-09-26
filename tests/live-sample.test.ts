import { describe, expect, it } from "vitest";
import { neighborWalkDataSchema } from "../lib/domain";
import { routeVisitsTonight } from "../lib/pin-counts";
import { createLiveSample } from "../lib/seed";

describe("the live sample church", () => {
  const now = new Date("2026-09-25T15:00:00Z");
  const data = createLiveSample(now);

  it("is valid stored data", () => {
    expect(neighborWalkDataSchema.safeParse(data).success).toBe(true);
  });

  it("puts the live walk a little over an hour in, with every door already logged", () => {
    const walk = data.events.find((event) => event.status === "active")!;
    expect(now.getTime() - Date.parse(walk.startsAt)).toBe(72 * 60_000);
    const tonight = data.visits.filter((visit) => visit.eventId === walk.id);
    expect(tonight.every((visit) => Date.parse(visit.recordedAt) > Date.parse(walk.startsAt) && Date.parse(visit.recordedAt) < now.getTime())).toBe(true);
  });

  it("counts one door per home on Crockett north", () => {
    const walk = data.events.find((event) => event.status === "active")!;
    const assignment = data.assignments!.find((item) => item.targetId === "target_demo_crockett_north")!;
    const doors = routeVisitsTonight(data, walk, assignment);
    expect(new Set(doors.map((visit) => visit.propertyId)).size).toBe(doors.length);
    expect(doors.length).toBeGreaterThan(8);
  });

  it("leaves no pin that was never knocked", () => {
    expect(data.properties.filter((home) => home.currentOutcome === "unvisited")).toEqual([]);
  });
});
