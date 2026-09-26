import { formatCalendarDate, calendarDate } from "./calendar";
import type { NeighborWalkData, OutreachEvent, Property, Visit } from "./domain";
import { reviewedEncounter } from "./encounter-history";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];

/** Homes aren't known ahead of time, so neighborhoods are summed up by the pins
 * dropped in them and when they were last walked, never a coverage percent. */
export function neighborhoodPins(data: Pick<NeighborWalkData, "properties" | "visits">, territoryId: string) {
  const pins = data.properties.filter((property) => !property.mergedIntoId && property.territoryId === territoryId).length;
  const homes = new Set(data.properties.filter((property) => property.territoryId === territoryId).map((property) => property.id));
  const lastWalkedAt = data.visits.reduce((latest, visit) => (visit.territoryId === territoryId || (visit.propertyId && homes.has(visit.propertyId))) && visit.recordedAt > latest ? visit.recordedAt : latest, "");
  return { pins, lastWalkedAt: lastWalkedAt || undefined };
}

/** "212 pins · walked Sep 24", "No pins yet" or "Never walked". */
export function neighborhoodPinLine(data: Pick<NeighborWalkData, "properties" | "visits" | "church">, territoryId: string, empty: "No pins yet" | "Never walked" = "No pins yet") {
  const { pins, lastWalkedAt } = neighborhoodPins(data, territoryId);
  if (!pins && !lastWalkedAt) return empty;
  const walked = lastWalkedAt ? `walked ${shortDate(lastWalkedAt, data.church.timezone)}` : "never walked";
  return `${pins} ${pins === 1 ? "pin" : "pins"} · ${walked}`;
}

export function shortDate(iso: string, timezone: string) {
  return formatCalendarDate(calendarDate(iso, timezone), { month: "short", day: "numeric" });
}

/** The people walking one route tonight: its volunteer, or its team's members. */
export function routeWalkerIds(data: Pick<NeighborWalkData, "teams">, assignment: Pick<Assignment, "assignedTeamId" | "assignedVolunteerId">) {
  const team = assignment.assignedTeamId ? data.teams.find((item) => item.id === assignment.assignedTeamId) : undefined;
  return new Set([...(team?.memberIds ?? []), ...(assignment.assignedVolunteerId ? [assignment.assignedVolunteerId] : [])]);
}

/** Tonight's doors on one route: this walk's visits by the route's walkers (or
 * tagged to its target), one per home, newest first. Walkers drop pins anywhere
 * in the route area, so a visit is only tagged to the target when its home is on
 * the target's parcel roster. */
export function routeVisitsTonight(data: Pick<NeighborWalkData, "visits" | "teams">, outing: Pick<OutreachEvent, "id">, assignment: Pick<Assignment, "assignedTeamId" | "assignedVolunteerId" | "targetId" | "territoryId">) {
  const walkers = routeWalkerIds(data, assignment);
  const seen = new Set<string>();
  return data.visits
    .map(reviewedEncounter)
    .filter((visit) => !visit.voided && visit.eventId === outing.id && visit.propertyId && visit.context !== "other"
      && (assignment.targetId ? visit.targetId === assignment.targetId || (!visit.targetId && walkers.has(visit.volunteerId)) : walkers.has(visit.volunteerId) || visit.territoryId === assignment.territoryId))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .filter((visit) => { if (seen.has(visit.propertyId!)) return false; seen.add(visit.propertyId!); return true; });
}

/** Doors logged on a whole walk, one per home. */
export function walkDoors(data: Pick<NeighborWalkData, "visits">, outingId: string) {
  return new Set(data.visits.map(reviewedEncounter).filter((visit) => !visit.voided && visit.eventId === outingId && visit.propertyId).map((visit) => visit.propertyId!)).size;
}

/** Homes with a visit on this walk: their pins are drawn full size in walk mode. */
export function homesVisitedOnWalk(visits: readonly Visit[], outingId: string) {
  return new Set(visits.filter((visit) => visit.eventId === outingId && visit.propertyId).map((visit) => visit.propertyId!));
}

/** Pins stacked on one spot (a duplex, an apartment) show a count. */
export function homesAtSameSpot(properties: readonly Property[], home: Property) {
  return properties.filter((other) => !other.mergedIntoId && (other.id === home.id
    || (home.parcel && other.parcel && other.parcel.countyFips === home.parcel.countyFips && other.parcel.gislink === home.parcel.gislink)
    || (!home.parcel && home.coordinates && other.coordinates && other.address === home.address && Math.abs(other.coordinates[0] - home.coordinates[0]) < 2e-5 && Math.abs(other.coordinates[1] - home.coordinates[1]) < 2e-5)));
}

const suffixes: Record<string, string> = { street: "St", avenue: "Ave", boulevard: "Blvd", road: "Rd", drive: "Dr", lane: "Ln", court: "Ct", place: "Pl", circle: "Cir", highway: "Hwy", parkway: "Pkwy", terrace: "Ter" };

/** "213 Gaines Street" → "Gaines Street"; keeps the address when there is no house number. */
export function streetOf(address: string) {
  const street = address.replace(/^\s*[\d-]+[a-z]?\s+/i, "").split(",")[0].trim();
  return street || address.trim();
}

/** "Gaines Street" → "Gaines St". */
export function shortStreet(street: string) {
  return street.replace(/\b(street|avenue|boulevard|road|drive|lane|court|place|circle|highway|parkway|terrace)\b\.?$/i, (word) => suffixes[word.toLowerCase()] ?? word);
}

/** "217 Gaines Street" → "217 Gaines St", for mono headers. */
export function shortAddress(address: string) {
  return shortStreet(address.split(",")[0].trim());
}

/** "217 Gaines Street" → "217 Gaines", for dense lists. */
export function houseLabel(address: string, unit?: string) {
  const first = address.split(",")[0].trim();
  const short = first.replace(/\s+(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|place|pl|circle|cir|terrace|ter)\.?$/i, "");
  return `${short || first}${unit ? ` · ${unit}` : ""}`;
}
