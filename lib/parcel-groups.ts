import type { ParcelReference, Property } from "./domain";

type ParcelIdentity = Pick<ParcelReference, "countyFips" | "gislink">;

export type ParcelProgress = {
  total: number;
  visited: number;
  remaining: number;
  percent: number;
};

export function parcelKey(parcel: ParcelIdentity) {
  return `${parcel.countyFips}:${parcel.gislink}`;
}

export function propertyParcelKey(property: Property) {
  return property.parcel ? parcelKey(property.parcel) : null;
}

export function dwellingsForParcel(properties: Property[], parcel: ParcelIdentity) {
  const key = parcelKey(parcel);
  return properties.filter((property) => !property.mergedIntoId && propertyParcelKey(property) === key);
}

export function parcelProgress(properties: Property[]): ParcelProgress {
  const visited = properties.filter((property) => property.currentOutcome !== "unvisited").length;
  return {
    total: properties.length,
    visited,
    remaining: properties.length - visited,
    percent: properties.length ? Math.round((visited / properties.length) * 100) : 0,
  };
}
