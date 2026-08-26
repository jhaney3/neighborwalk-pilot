"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchParcelsInView,
  type MapViewport,
  type ParcelFeatureCollection,
  viewportKey,
} from "./parcels";

const EMPTY_PARCELS: ParcelFeatureCollection = { type: "FeatureCollection", features: [] };

type LoadedViewport = {
  key: string;
  parcels: ParcelFeatureCollection;
};

export function useVisibleParcels(viewport: MapViewport | null) {
  const [loaded, setLoaded] = useState<LoadedViewport | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const key = viewportKey(viewport);

  useEffect(() => {
    if (!viewport || !key) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingKey(key);
      void fetchParcelsInView(viewport)
        .then((parcels) => {
          if (!cancelled && parcels) setLoaded({ key, parcels });
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoadingKey((current) => current === key ? null : current);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, viewport]);

  return useMemo(() => ({
    parcels: key && loaded?.key === key ? loaded.parcels : EMPTY_PARCELS,
    loading: Boolean(key && loadingKey === key),
  }), [key, loaded, loadingKey]);
}
