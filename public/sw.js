const APP_CACHE = "neighborwalk-app-v5";
const MAP_CACHE = "neighborwalk-map-v1";
const CORE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
const MAP_CACHE_LIMIT = 180;
const STATIC_DESTINATIONS = new Set(["style", "script", "worker", "image", "font", "manifest"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![APP_CACHE, MAP_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match("/")) || new Response("NeighborWalk is offline.", { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

async function cacheMapResource(request) {
  const cache = await caches.open(MAP_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    void trimCache(MAP_CACHE, MAP_CACHE_LIMIT);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (["/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(url.pathname)
    || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/v1/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (["tiles.openfreemap.org", "api.maptiler.com"].includes(url.hostname)) {
    event.respondWith(cacheMapResource(request));
    return;
  }
  if (url.origin === self.location.origin && STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
