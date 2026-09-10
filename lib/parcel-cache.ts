import { openDB, type IDBPDatabase } from "idb";
import type { TerritoryParcelResult } from "./parcels";
import { storageKey } from "./environment";

const DB_NAME = storageKey("neighborwalk-parcel-cache");
const DB_VERSION = 1;
const STORE = "territories";
export const PARCEL_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type CachedTerritoryParcels = TerritoryParcelResult & {
  territoryId: string;
  boundarySignature: string;
  cachedAt: number;
};

let databasePromise: Promise<IDBPDatabase> | null = null;

function getDatabase() {
  if (typeof window === "undefined") throw new Error("Parcel caching is available in the browser only.");
  databasePromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "territoryId" });
      }
    },
  });
  return databasePromise;
}

export async function getCachedTerritoryParcels(
  territoryId: string,
  boundarySignature: string,
): Promise<CachedTerritoryParcels | null> {
  const database = await getDatabase();
  const cached = await database.get(STORE, territoryId) as CachedTerritoryParcels | undefined;
  if (!cached || cached.boundarySignature !== boundarySignature) return null;
  return cached;
}

export async function cacheTerritoryParcels(
  territoryId: string,
  boundarySignature: string,
  result: TerritoryParcelResult,
): Promise<void> {
  const database = await getDatabase();
  await database.put(STORE, {
    ...result,
    territoryId,
    boundarySignature,
    cachedAt: Date.now(),
  } satisfies CachedTerritoryParcels);
}

export function isTerritoryParcelCacheFresh(cachedAt: number, now = Date.now()) {
  return now - cachedAt < PARCEL_CACHE_MAX_AGE_MS;
}
