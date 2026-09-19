import type { NeighborWalkData, Property } from "./domain";
import { reviewedEncounter } from "./encounter-history";
import { propertyParcelKey } from "./parcel-groups";
import { parcelKey, type WalkTarget } from "./walk-targets";

export type ResidentialCoverage = {
  total: number;
  touched: number;
  remaining: number;
  percent: number | null;
  complete: boolean;
};

function coverage(roster: Set<string>, touched: Set<string>, complete = true): ResidentialCoverage {
  const count = [...touched].filter((key) => roster.has(key)).length;
  return { total: roster.size, touched: count, remaining: roster.size - count,
    percent: complete && roster.size > 0 ? Math.round(count / roster.size * 100) : null, complete };
}

export function propertyInTarget(property: Property, target: WalkTarget) {
  const key = propertyParcelKey(property);
  return property.territoryId === target.territoryId && Boolean(key && target.parcels.some((parcel) => parcelKey(parcel) === key));
}

/** A finished assignment is independent of how many residential properties were reached. */
export function targetCoverage(data: Pick<NeighborWalkData, "visits"> & Partial<Pick<NeighborWalkData, "targetProgress">>, target: WalkTarget): ResidentialCoverage {
  const roster = new Set(target.parcels.map(parcelKey));
  const touched = new Set<string>((data.targetProgress ?? []).filter((touch) => touch.targetId === target.id).map(parcelKey));
  for (const original of data.visits) {
    const visit = reviewedEncounter(original);
    if (visit.voided || visit.targetId !== target.id || visit.eventId !== target.eventId || !visit.targetParcel) continue;
    touched.add(parcelKey(visit.targetParcel));
  }
  return coverage(roster, touched);
}

export function parentZoneTouchedParcelKeys(
  data: Pick<NeighborWalkData, "visits" | "properties"> & Partial<Pick<NeighborWalkData, "parentProgress">>,
  territoryId: string,
  eventId?: string,
) {
  const properties = new Map(data.properties.map((property) => [property.id, property]));
  const touched = new Set<string>((data.parentProgress ?? [])
    .filter((touch) => touch.territoryId === territoryId && (!eventId || touch.eventId === eventId))
    .map(parcelKey));
  for (const original of data.visits) {
    const visit = reviewedEncounter(original);
    if (visit.voided || (eventId && visit.eventId !== eventId)) continue;
    const property = visit.propertyId ? properties.get(visit.propertyId) : undefined;
    if (visit.targetParcel && visit.territoryId === territoryId) touched.add(parcelKey(visit.targetParcel));
    else if ((visit.territoryId ?? property?.territoryId) === territoryId && property?.parcel) touched.add(parcelKey(property.parcel));
  }
  return touched;
}

/** Pass a complete, parent-clipped inventory, never just the current viewport. */
export function parentZoneCoverage(
  data: Pick<NeighborWalkData, "visits" | "properties"> & Partial<Pick<NeighborWalkData, "parentProgress" | "coverageVisibility">>,
  territoryId: string,
  inventory: { parcels: Array<{ countyFips: string; gislink: string }>; complete: boolean } | undefined,
  eventId?: string,
): ResidentialCoverage {
  const touched = parentZoneTouchedParcelKeys(data, territoryId, eventId);
  return coverage(new Set(inventory?.parcels.map(parcelKey) ?? []), touched, Boolean(inventory?.complete && data.coverageVisibility !== "assigned_targets_only"));
}
