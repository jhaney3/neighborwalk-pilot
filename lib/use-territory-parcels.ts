"use client";

import { useEffect, useMemo, useState } from "react";
import type { Territory } from "./domain";
import {
  cacheTerritoryParcels,
  getCachedTerritoryParcels,
  isTerritoryParcelCacheFresh,
} from "./parcel-cache";
import {
  fetchParcelDatasetRevision,
  fetchParcelsForTerritory,
  territoryBoundarySignature,
  type TerritoryParcelResult,
} from "./parcels";

type LoadedTerritoryParcels = {
  boundarySignature: string;
  result: TerritoryParcelResult;
};

export function useTerritoryParcels(territories: Territory[]) {
  const [loaded, setLoaded] = useState<Record<string, LoadedTerritoryParcels>>({});
  const territoryRequests = useMemo(() => territories.filter((territory) => territory.kind !== "list" && territory.boundary.length >= 3).map((territory) => ({
    id: territory.id,
    boundary: territory.boundary,
    boundarySignature: territoryBoundarySignature(territory.boundary),
  })), [territories]);

  useEffect(() => {
    let cancelled = false;
    let revisionPromise: Promise<string | null> | null = null;

    const publish = (territoryId: string, boundarySignature: string, result: TerritoryParcelResult) => {
      if (cancelled) return;
      setLoaded((current) => ({ ...current, [territoryId]: { boundarySignature, result } }));
    };

    const load = async ({ id, boundary, boundarySignature }: (typeof territoryRequests)[number]) => {
      let cached = null;
      try {
        cached = await getCachedTerritoryParcels(id, boundarySignature);
      } catch {
        // IndexedDB can be unavailable in restrictive browser modes; online loading still works.
      }
      if (cancelled) return;

      if (cached) {
        publish(id, boundarySignature, cached);
        if (isTerritoryParcelCacheFresh(cached.cachedAt)) return;
        try {
          revisionPromise ??= fetchParcelDatasetRevision().catch(() => null);
          const revision = await revisionPromise;
          if (revision && revision === cached.datasetRevision) {
            await cacheTerritoryParcels(id, boundarySignature, cached).catch(() => undefined);
            publish(id, boundarySignature, cached);
            return;
          }
        } catch {
          return;
        }
      }

      try {
        const result = await fetchParcelsForTerritory(boundary);
        if (!result || cancelled) return;
        publish(id, boundarySignature, result);
        await cacheTerritoryParcels(id, boundarySignature, result).catch(() => undefined);
      } catch {
        // Parcel coverage falls back to mapped locations when no cache or network is available.
      }
    };

    void Promise.all(territoryRequests.map(load));
    return () => {
      cancelled = true;
    };
  }, [territoryRequests]);

  return useMemo(() => Object.fromEntries(territoryRequests.flatMap(({ id, boundarySignature }) => {
    const entry = loaded[id];
    return entry?.boundarySignature === boundarySignature ? [[id, entry.result]] : [];
  })) as Record<string, TerritoryParcelResult>, [loaded, territoryRequests]);
}
