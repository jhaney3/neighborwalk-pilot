const CACHE_SCOPE = new URL(self.location.href).searchParams.has("sandbox") ? "-sandbox" : "";
const APP_CACHE = `neighborwalk-app-v17${CACHE_SCOPE}`;
const CORE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
const STATIC_DESTINATIONS = new Set(["style", "script", "worker", "image", "font", "manifest"]);

self.addEventListener("install", (event) => {
  // Do not replace the running app while a volunteer has unsent work.
  // The browser activates this worker after existing clients have closed.
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(CORE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) =>
    (key.startsWith("neighborwalk-app-") || key.startsWith("neighborwalk-map-"))
    && (CACHE_SCOPE ? key.endsWith("-sandbox") : !key.endsWith("-sandbox"))
    && key !== APP_CACHE
  ).map((key) => caches.delete(key)))));
});

async function navigation(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return await cache.match(request) || await cache.match("/") ||
      new Response("NeighborWalk is offline. Reconnect to prepare this device.", { status: 503 });
  }
}

async function staticAsset(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("This resource is not prepared offline.", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Authentication, API data, external maps, and token-bearing URLs are never
  // stored here. Offline church records live in account-scoped IndexedDB.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/invite/")) return;
  if (request.mode === "navigate") {
    if (!url.search) event.respondWith(navigation(request));
    return;
  }
  if (STATIC_DESTINATIONS.has(request.destination)) event.respondWith(staticAsset(request));
});
