// Minimal PWA service worker. Cache only immutable/static assets.
// HTML and API responses depend on cookies, so they must always hit the network.
/// <reference lib="webworker" />

const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = "gsc-static-v2";

worker.addEventListener("install", () => worker.skipWaiting());
worker.addEventListener("activate", (event) => {
  const activateEvent = /** @type {ExtendableEvent} */ (event);
  activateEvent.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener("fetch", (event) => {
  const fetchEvent = /** @type {FetchEvent} */ (event);
  const { request } = fetchEvent;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (request.mode === "navigate" || request.destination === "document" || url.pathname.startsWith("/api/")) return;

  const cacheable =
    url.pathname.startsWith("/_next/static/") ||
    ["font", "image", "manifest", "script", "style"].includes(request.destination);
  if (!cacheable) return;

  fetchEvent.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
