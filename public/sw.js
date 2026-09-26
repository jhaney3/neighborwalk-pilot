importScripts("/sw-build.js");
const CACHE_SCOPE = new URL(self.location.href).searchParams.has("sandbox") ? "-sandbox" : "";
const APP_CACHE = `neighborwalk-app-${self.NEIGHBORWALK_BUILD.version}${CACHE_SCOPE}`;
const CORE = ["/", "/app/today", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", ...self.NEIGHBORWALK_BUILD.assets];
const STATIC_DESTINATIONS = new Set(["style", "script", "worker", "image", "font", "manifest"]);
const PUBLIC_PAGES = new Set(["/", "/how-it-works", "/pricing", "/trust", "/help", "/pilot", "/privacy", "/terms", "/demo"]);
function preparedAppPath(pathname) {
  const parts = pathname.split("/").filter(Boolean).slice(1);
  if (!pathname.startsWith("/app/") || !["today", "outreach", "locations", "people", "followups", "guides", "leader", "settings", "more", "recovery", "data"].includes(parts[0])) return false;
  if (parts.length === 1) return true;
  if (!/^[A-Za-z0-9_-]{1,240}$/.test(parts[1] || "")) return false;
  return (parts.length === 2 && ["outreach", "people", "locations", "followups", "guides"].includes(parts[0]))
    || (parts.length === 3 && parts[0] === "outreach" && parts[2] === "field");
}

self.addEventListener("install", (event) => {
  // Do not replace the running app while a volunteer has unsent work.
  // The browser activates this worker after existing clients have closed.
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(CORE.map((path) => new Request(new URL(path, self.location.origin), { credentials: "omit", cache: "reload" })))).catch(async (error) => {
    await caches.delete(APP_CACHE);
    throw error;
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) =>
    (key.startsWith("neighborwalk-app-") || key.startsWith("neighborwalk-map-"))
    && (CACHE_SCOPE ? key.endsWith("-sandbox") : !key.endsWith("-sandbox"))
    && key !== APP_CACHE
  ).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "OFFLINE_STATUS" || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    const entries = await Promise.all(CORE.map((path) => cache.match(path)));
    event.ports[0].postMessage({ ready: entries.every(Boolean), build: self.NEIGHBORWALK_BUILD.version, bytes: self.NEIGHBORWALK_BUILD.bytes });
  })());
});

async function navigation(request) {
  const cache = await caches.open(APP_CACHE);
  if (new URL(request.url).pathname.startsWith("/app/")) {
    // Pin the authenticated app shell to this worker's fully prepared build.
    // A new worker takes over only after old tabs close, not mid-fieldwork.
    const shell = await cache.match("/app/today");
    if (shell) return shell;
  }
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const fallback = new URL(request.url).pathname.startsWith("/app") ? "/app/today" : "/";
    return await cache.match(request) || await cache.match(fallback) ||
      new Response("SendMe is offline. Reconnect to prepare this device.", { status: 503 });
  }
}

async function staticAsset(request) {
  const cache = await caches.open(APP_CACHE);
  const pathname = new URL(request.url).pathname;
  const cached = await cache.match(pathname);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(pathname, response.clone());
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
    || url.pathname === "/login" || url.pathname.startsWith("/auth/") || url.pathname === "/invite" || url.pathname.startsWith("/invite/")) return;
  if (request.mode === "navigate") {
    // Unknown paths remain server 404s, not a cached Today screen. New public
    // routes must be deliberately reviewed before becoming cacheable.
    if (!PUBLIC_PAGES.has(url.pathname) && !preparedAppPath(url.pathname)) return;
    const safeAppQuery = url.pathname === "/app/followups" && [...url.searchParams].every(([key, value]) =>
      key === "person" ? /^[A-Za-z0-9_-]{1,240}$/.test(value) : key === "scope" && ["mine", "all", "team", "unowned", "declined"].includes(value));
    if (!url.search || safeAppQuery) event.respondWith(navigation(request));
    return;
  }
  const safeAssetQuery = [...url.searchParams].every(([key, value]) => key === "dpl" && /^[A-Za-z0-9_-]{1,200}$/.test(value));
  if (STATIC_DESTINATIONS.has(request.destination) && CORE.includes(url.pathname) && safeAssetQuery) event.respondWith(staticAsset(request));
});
