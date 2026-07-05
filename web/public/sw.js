// Minimal PWA service worker. Cache only immutable/static assets.
// HTML and API responses depend on cookies, so they must always hit the network.
const CACHE = "gsc-static-v2";
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

sw.addEventListener("install", () => sw.skipWaiting());
sw.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim()),
  ),
);

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (request.mode === "navigate" || request.destination === "document" || url.pathname.startsWith("/api/")) return;

  const cacheable =
    url.pathname.startsWith("/_next/static/") ||
    ["font", "image", "manifest", "script", "style"].includes(request.destination);
  if (!cacheable) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached ?? Response.error());
      return cached || network;
    }),
  );
});
