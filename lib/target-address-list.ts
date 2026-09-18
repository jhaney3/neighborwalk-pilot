import { outcomeMeta, type NeighborWalkData, type Property } from "./domain";
import { reviewedEncounter } from "./encounter-history";
import { propertyParcelKey } from "./parcel-groups";
import type { ParcelFeature, ParcelFeatureCollection } from "./parcels";
import { targetParcelKey } from "./target-parcels";

export type TargetAddressEntry =
  | { key: string; kind: "saved"; address: string; unit?: string; property: Property }
  | { key: string; kind: "parcel"; address: string; unit?: undefined; parcel: ParcelFeature };

export type AddressWorksheetRow = {
  entry: TargetAddressEntry;
  sequence: number;
  sequenceLabel: string;
  statusLabel: string;
  recordedThisWalk: boolean;
  restricted: boolean;
};

export type AddressWorksheetPage = {
  number: number;
  rows: AddressWorksheetRow[];
};

type AddressWorksheetOptions = {
  visits: NeighborWalkData["visits"];
  restrictions?: NonNullable<NeighborWalkData["restrictions"]>;
  eventId?: string;
  targetId?: string;
  pageSize?: number;
};

/** Merge saved dwellings with every untouched parcel in the frozen nightly roster. */
export function targetAddressEntries(properties: Property[], parcels?: ParcelFeatureCollection): TargetAddressEntry[] {
  if (!parcels) return properties.map((property) => ({
    key: `property:${property.id}`,
    kind: "saved" as const,
    address: property.address,
    unit: property.unit,
    property,
  })).sort(compareEntries);

  const propertiesByParcel = new Map<string, Property[]>();
  const emitted = new Set<string>();
  for (const property of properties) {
    const key = propertyParcelKey(property);
    if (key) propertiesByParcel.set(key, [...(propertiesByParcel.get(key) ?? []), property]);
  }

  const entries: TargetAddressEntry[] = [];
  for (const parcel of parcels.features) {
    const linked = propertiesByParcel.get(targetParcelKey(parcel.properties)) ?? [];
    if (linked.length) {
      for (const property of linked) {
        emitted.add(property.id);
        entries.push({ key: `property:${property.id}`, kind: "saved", address: property.address, unit: property.unit, property });
      }
    } else {
      entries.push({
        key: `parcel:${targetParcelKey(parcel.properties)}`,
        kind: "parcel",
        address: parcel.properties.situsAddress?.trim() || "Address unavailable",
        parcel,
      });
    }
  }

  for (const property of properties) {
    if (!emitted.has(property.id)) entries.push({
      key: `property:${property.id}`,
      kind: "saved",
      address: property.address,
      unit: property.unit,
      property,
    });
  }
  return entries.sort(compareEntries);
}

/** Build a stable, complete paper roster independently of the screen search. */
export function buildAddressWorksheet(entries: TargetAddressEntry[], options: AddressWorksheetOptions): AddressWorksheetPage[] {
  const pageSize = options.pageSize ?? 3;
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("A worksheet page must contain at least one address.");
  const digits = Math.max(2, String(entries.length).length);
  const rows = entries.map((entry, index): AddressWorksheetRow => {
    const propertyId = entry.kind === "saved" ? entry.property.id : undefined;
    const parcelIdentity = entry.kind === "parcel" ? targetParcelKey(entry.parcel.properties) : undefined;
    const recordedThisWalk = options.visits.some((original) => {
      const visit = reviewedEncounter(original);
      if (visit.voided || (options.targetId ? visit.targetId !== options.targetId : options.eventId && visit.eventId !== options.eventId)) return false;
      if (propertyId) return visit.propertyId === propertyId;
      return Boolean(parcelIdentity && visit.targetParcel && targetParcelKey(visit.targetParcel) === parcelIdentity);
    });
    const restricted = entry.kind === "saved" && (entry.property.currentOutcome === "do_not_visit"
      || (options.restrictions ?? []).some((restriction) => restriction.active && restriction.propertyId === entry.property.id && ["all", "visit"].includes(restriction.channel)));
    return {
      entry,
      sequence: index + 1,
      sequenceLabel: String(index + 1).padStart(digits, "0"),
      statusLabel: entry.kind === "saved" ? outcomeMeta[entry.property.currentOutcome].label : outcomeMeta.unvisited.label,
      recordedThisWalk,
      restricted,
    };
  });
  return Array.from({ length: Math.ceil(rows.length / pageSize) }, (_, index) => ({
    number: index + 1,
    rows: rows.slice(index * pageSize, (index + 1) * pageSize),
  }));
}

function compareEntries(left: TargetAddressEntry, right: TargetAddressEntry) {
  return `${left.address} ${left.unit ?? ""}`.localeCompare(`${right.address} ${right.unit ?? ""}`, undefined, { numeric: true });
}
