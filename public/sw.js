const BUILD_ID = "ai-zerow-commercial-v1-rc2-9-local-r2026-10-02";
const CACHE_REVISION = "role-safe-static-cache-2026-10-18-01";
const SHELL_CACHE = `zerow-shell-${BUILD_ID}-${CACHE_REVISION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/ai-zerow-icon.jpeg", "/icons/ai-zerow-192.png", "/icons/ai-zerow-512.png"];

function isCacheableStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/ai-zerow-icon.jpeg"
    || url.pathname === "/manifest.webmanifest"
    || url.pathname === OFFLINE_URL;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("zerow-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Authenticated pages and their server-derived role contracts must never
    // come from a shared shell cache. Offline navigation gets only the neutral
    // fallback page; it never replays personalized HTML or RSC payloads.
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Next RSC transitions are GET requests too. Leaving every non-static
  // request to the network prevents stale or cross-session authority data.
  if (!isCacheableStaticAsset(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
