import type { NeighborWalkData, Visit } from "./domain";
import { recordFamilyIds } from "./record-aliases";

/** Pure presentation only. Never rewrite an original or queue a derived edit. */
export function reviewedEncounter(visit: Visit) {
  const latest = visit.corrections?.[visit.corrections.length - 1];
  return { ...visit, outcome: latest?.outcome ?? visit.outcome, context: latest?.context ?? visit.context ?? "door", voided: latest?.voided ?? false };
}

export function lastRecordedContact(data: NeighborWalkData, personId: string): { at: string; source: "encounter" | "historical" } | undefined {
  const family = recordFamilyIds(data.residents, personId);
  if (!family.size) return undefined;
  let at: string | undefined;
  for (const original of data.visits) {
    if (!original.residentId || !family.has(original.residentId)) continue;
    const visit = reviewedEncounter(original);
    if (visit.voided || !["conversation", "follow_up", "declined", "do_not_visit"].includes(visit.outcome)) continue;
    if (!at || visit.recordedAt > at) at = visit.recordedAt;
  }
  if (at) return { at, source: "encounter" };
  const dates = data.residents.filter((person) => family.has(person.id)).map((person) => person.lastContactAt).filter((date): date is string => Boolean(date)).sort();
  const historical = dates[dates.length - 1];
  return historical ? { at: historical, source: "historical" } : undefined;
}
