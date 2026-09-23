"use client";

import { useEffect, useState } from "react";
import type { Coordinates } from "./domain";
import { type MapViewport, type ParcelFeatureCollection, viewportKey } from "./parcels";
import { lawrenceburgDemoParcelResult } from "./demo-planning";
import { isMobileApp } from "./mobile";
import { fetchPlanningParcelsForBoundary } from "./target-parcels";

const EMPTY: ParcelFeatureCollection = { type: "FeatureCollection", features: [] };
type Result = { key: string; parcels: ParcelFeatureCollection; message: string; failed: boolean };

/** The creator displays live inventory, with bundled fictional parcels only in the native sample workspace. */
export function usePlanningParcelsInView(viewport: MapViewport | null, publicMap: boolean) {
  const [result, setResult] = useState<Result>();
  const [attempt, setAttempt] = useState(0);
  const boundsKey = viewportKey(viewport);
  const key = boundsKey ? `${publicMap ? "public" : "member"}:${boundsKey}` : null;

  useEffect(() => {
    if (!boundsKey || !key) return;
    let cancelled = false;
    const controller = new AbortController();
    const [west, south, east, north] = boundsKey.split(":").map(Number);
    const boundary: Coordinates[] = [[west, south], [east, south], [east, north], [west, north]];
    const deadline = window.setTimeout(() => controller.abort(), 15_000);
    const debounce = window.setTimeout(() => {
      const loading = isMobileApp && publicMap
        ? Promise.resolve(lawrenceburgDemoParcelResult(boundary))
        : fetchPlanningParcelsForBoundary(boundary, { publicMap, signal: controller.signal });
      void loading.then((loaded) => {
        if (cancelled) return;
        const message = loaded.availability === "unsupported_area" ? "Home data covers Giles, Lawrence, Lewis and Wayne counties."
          : loaded.availability === "missing_inventory" ? "Home data isn’t loaded for this area yet."
          : loaded.truncated ? "Some homes are shown. Zoom in to see them all."
          : !loaded.complete ? "Home data isn’t available for this area yet."
          : loaded.parcels.features.length === 0 ? "No homes in this view."
          : `${loaded.parcels.features.length} homes loaded. Draw around the neighborhood.`;
        setResult({ key, parcels: loaded.parcels, message, failed: !loaded.complete && !loaded.truncated });
      }).catch(() => {
        if (!cancelled) setResult({ key, parcels: EMPTY, failed: true,
          message: "Homes couldn’t load. Check your connection and try again." });
      }).finally(() => window.clearTimeout(deadline));
    }, 180);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(debounce); window.clearTimeout(deadline); };
  }, [attempt, boundsKey, key, publicMap]);

  const current = key && result?.key === key ? result : undefined;
  return {
    parcels: current?.parcels ?? EMPTY,
    loading: Boolean(key && !current),
    message: !key ? "Zoom in to see residential parcels while drawing your zone."
      : current?.message ?? "Loading residential parcels…",
    failed: current?.failed ?? false,
    retry: () => { setResult(undefined); setAttempt((value) => value + 1); },
  };
}
