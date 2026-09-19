import { describe, expect, it } from "vitest";
import { summarizePropertyVisits, type Visit } from "../lib/domain";
import { createSeedData } from "../lib/seed";

describe("location visit summaries", () => {
  it("preserves the original filter/sort results for unsorted visits and equal timestamps", () => {
    const data = createSeedData();
    const visits: Visit[] = Array.from({ length: 2000 }, (_, index) => ({
      ...data.visits[index % data.visits.length],
      id: `visit_${index}`,
      propertyId: data.properties[index % (data.properties.length - 1)].id,
      recordedAt: new Date(Date.UTC(2026, 8, 1 + index % 7)).toISOString(),
    }));
    const original = structuredClone({ properties: data.properties, visits });
    const expected = data.properties.map((property) => {
      const history = visits.filter((visit) => visit.propertyId === property.id).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
      const restricted = property.currentOutcome === "do_not_visit" || history.some((visit) => visit.outcome === "do_not_visit");
      return { ...property, currentOutcome: restricted ? "do_not_visit" : history[0]?.outcome ?? "unvisited", lastVisitedAt: history[0]?.recordedAt, visitCount: history.length };
    });

    expect(summarizePropertyVisits(data.properties, visits)).toEqual(expected);
    expect({ properties: data.properties, visits }).toEqual(original);
  });
});
