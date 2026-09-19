import type { Territory } from "./domain";
import type { ParcelFeatureCollection } from "./parcels";
import { fetchStreetSegmentsForBoundary, type StreetSegmentCollection } from "./street-segments";
import {
  cacheCompletePlanningDataset,
  fetchPlanningParcelsForBoundary,
  getCompletePlanningDataset,
  planningDatasetIdentity,
  type CachedPlanningDataset,
  type PlanningParcelResult,
} from "./target-parcels";

export type PlanningLayerStatus = "loading" | "ready" | "empty" | "incomplete" | "cached" | "unavailable";

export type PlanningStreetLayer = {
  identity: string;
  status: PlanningLayerStatus;
  data: StreetSegmentCollection;
  complete: boolean;
  live: boolean;
  availability?: string;
  error?: string;
};

export type PlanningParcelLayer = {
  identity: string;
  status: PlanningLayerStatus;
  data: ParcelFeatureCollection;
  revision: string;
  complete: boolean;
  live: boolean;
  availability?: string;
  error?: string;
};

export type PlanningLayerEvent =
  | { layer: "streets"; value: PlanningStreetLayer }
  | { layer: "parcels"; value: PlanningParcelLayer };

type StreetFetcher = (query: { boundary: Territory["boundary"]; publicMap?: boolean; signal?: AbortSignal }) => Promise<StreetSegmentCollection>;
type ParcelFetcher = (boundary: Territory["boundary"], options?: { publicMap?: boolean; signal?: AbortSignal }) => Promise<PlanningParcelResult>;

export type PlanningLoaderDependencies = {
  fetchStreets?: StreetFetcher;
  fetchParcels?: ParcelFetcher;
  getCached?: typeof getCompletePlanningDataset;
  cacheComplete?: typeof cacheCompletePlanningDataset;
};

export const EMPTY_STREETS: StreetSegmentCollection = { type: "FeatureCollection", features: [] };
export const EMPTY_PLANNING_PARCELS: ParcelFeatureCollection = { type: "FeatureCollection", features: [] };

export function loadingPlanningStreetLayer(identity: string): PlanningStreetLayer {
  return { identity, status: "loading", data: EMPTY_STREETS, complete: false, live: false };
}

export function loadingPlanningParcelLayer(identity: string): PlanningParcelLayer {
  return { identity, status: "loading", data: EMPTY_PLANNING_PARCELS, revision: "", complete: false, live: false };
}

export function planningLayerMatchesIdentity(layerIdentity: string, activeIdentity: string) {
  return layerIdentity === activeIdentity;
}

export function planningAvailabilityMessage(availability: string | undefined, layer: "streets" | "parcels") {
  if (availability === "missing_inventory") {
    return layer === "parcels" ? "Residential parcel data has not been loaded for this area." : "Street data has not been loaded for this area.";
  }
  if (availability === "unsupported_area") return "Planning data is available only in Giles, Lawrence, Lewis, and Wayne counties.";
  return undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Planning data is unavailable.";
}

function liveStreetLayer(identity: string, data: StreetSegmentCollection): PlanningStreetLayer {
  const complete = data.metadata?.complete === true && data.metadata.truncated !== true;
  const availability = data.metadata?.availability;
  const unavailable = availability === "missing_inventory" || availability === "unsupported_area";
  return { identity, status: unavailable ? "unavailable" : complete ? (data.features.length ? "ready" : "empty") : "incomplete",
    data, complete: unavailable ? false : complete, live: true, availability };
}

function liveParcelLayer(identity: string, result: PlanningParcelResult): PlanningParcelLayer {
  const complete = result.complete === true && result.truncated !== true;
  const unavailable = result.availability === "missing_inventory" || result.availability === "unsupported_area";
  return { identity, status: unavailable ? "unavailable" : complete ? (result.parcels.features.length ? "ready" : "empty") : "incomplete",
    data: result.parcels, revision: result.datasetRevision, complete: unavailable ? false : complete, live: true, availability: result.availability };
}

function cachedStreetLayer(identity: string, cached: CachedPlanningDataset, error?: unknown): PlanningStreetLayer {
  return { identity, status: "cached", data: cached.streets, complete: true, live: false, error: error ? errorMessage(error) : undefined };
}

function cachedParcelLayer(identity: string, cached: CachedPlanningDataset, error?: unknown): PlanningParcelLayer {
  return { identity, status: "cached", data: cached.parcels, revision: cached.parcelRevision, complete: true, live: false,
    error: error ? errorMessage(error) : undefined };
}

/**
 * Loads street and parcel inventories concurrently and publishes each result as soon as
 * it is usable. A failure in one source never erases the other source's map overlay.
 */
export async function loadPlanningLayers(
  territory: Territory,
  options: { publicMap?: boolean; signal?: AbortSignal; onLayer: (event: PlanningLayerEvent) => void },
  dependencies: PlanningLoaderDependencies = {},
) {
  const identity = planningDatasetIdentity(territory.id, territory.boundary);
  const fetchStreets = dependencies.fetchStreets ?? fetchStreetSegmentsForBoundary;
  const fetchParcels = dependencies.fetchParcels ?? fetchPlanningParcelsForBoundary;
  const getCached = dependencies.getCached ?? getCompletePlanningDataset;
  const cacheComplete = dependencies.cacheComplete ?? cacheCompletePlanningDataset;
  const cachedPromise = getCached(territory.id, territory.boundary).catch(() => null);

  const streetPromise = fetchStreets({ boundary: territory.boundary, publicMap: options.publicMap, signal: options.signal });
  const parcelPromise = fetchParcels(territory.boundary, { publicMap: options.publicMap, signal: options.signal });

  const publishStreet = streetPromise.then(async (data) => {
    if (options.signal?.aborted) return liveStreetLayer(identity, data);
    const live = liveStreetLayer(identity, data);
    const value = live.status === "incomplete" && data.features.length === 0
      ? await cachedPromise.then((cached) => cached ? cachedStreetLayer(identity, cached) : live)
      : live;
    if (!options.signal?.aborted) options.onLayer({ layer: "streets", value });
    return live;
  }, async (error) => {
    const cached = await cachedPromise;
    const value = cached ? cachedStreetLayer(identity, cached, error)
      : { identity, status: "unavailable" as const, data: EMPTY_STREETS, complete: false, live: false, error: errorMessage(error) };
    if (!options.signal?.aborted) options.onLayer({ layer: "streets", value });
    return value;
  });

  const publishParcels = parcelPromise.then(async (result) => {
    if (options.signal?.aborted) return liveParcelLayer(identity, result);
    const live = liveParcelLayer(identity, result);
    const value = live.status === "incomplete" && result.parcels.features.length === 0
      ? await cachedPromise.then((cached) => cached ? cachedParcelLayer(identity, cached) : live)
      : live;
    if (!options.signal?.aborted) options.onLayer({ layer: "parcels", value });
    return live;
  }, async (error) => {
    const cached = await cachedPromise;
    const value = cached ? cachedParcelLayer(identity, cached, error)
      : { identity, status: "unavailable" as const, data: EMPTY_PLANNING_PARCELS, revision: "", complete: false, live: false, error: errorMessage(error) };
    if (!options.signal?.aborted) options.onLayer({ layer: "parcels", value });
    return value;
  });

  const [streetResult, parcelResult] = await Promise.all([publishStreet, publishParcels]);
  if (options.signal?.aborted || !streetResult.live || !parcelResult.live || !streetResult.complete || !parcelResult.complete) return;
  try {
    await cacheComplete(territory.id, territory.boundary, { streets: streetResult.data, parcels: parcelResult.data,
      parcelRevision: parcelResult.revision, streetComplete: true, parcelComplete: true });
  } catch {
    // Browser storage is an optional offline aid; live planning data remains usable.
  }
}
