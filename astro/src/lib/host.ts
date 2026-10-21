import { contentSecurityPolicyForEnvironment, securityHeaders } from "../../../web/lib/csp";
import { type Publication } from "../../../web/lib/workers-host/publication-fence";
import { ArtifactStore, type StoredEntry } from "../../../web/lib/workers-host/cache/store";
import { bypassPageCache, isLongTail, MAX_ENTRY_BYTES, TAIL_EXPIRE_SECONDS, TAIL_FRESH_SECONDS } from "../../../web/lib/workers-host/cache/policy";
import { siteIndexable } from "./mode";
import { operationResponse } from "../packages/p7/response";
import { languageRedirect, negotiateLocale } from "./routing";

export type HostOptions = {
  publication: () => Promise<Publication>;
  store: ArtifactStore;
  render: (publication: Publication) => Promise<Response>;
  unscopedRender?: () => Promise<Response>;
  waitUntil: (pending: Promise<unknown>) => void;
  build: string;
  now?: () => number;
};
type CacheStatus = "BYPASS" | "MISS" | "HIT" | "STALE";

export function secureResponse(response: Response, method: string, status: CacheStatus, api = false, indexable = siteIndexable): Response {
  const headers = new Headers(response.headers);
  for (const { key, value } of securityHeaders) headers.set(key, key === "Content-Security-Policy" ? contentSecurityPolicyForEnvironment("production") : value);
  // The origin fence must run on every request; no independent browser/CDN page cache.
  if (status === "BYPASS" || headers.get("content-type")?.includes("text/html") || !headers.has("cache-control")) {
    headers.set("Cache-Control", "private, no-store");
  }
  if (!api && !indexable) headers.set("X-Robots-Tag", "noindex, nofollow");
  else headers.delete("X-Robots-Tag");
  headers.set("x-gsc-cache", status);
  return new Response(method === "HEAD" ? null : response.body, { status: response.status, headers });
}

/** Caches Astro's final HTML, using the existing bounded Cache API/KV artifact store. */
export async function handleRequest(request: Request, options: HostOptions): Promise<Response> {
  const url = new URL(request.url);
  const api = url.pathname.startsWith("/api/");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const finish = (response: Response, status: CacheStatus = "BYPASS", rendered = true) => {
    const result = secureResponse(
      api && rendered ? operationResponse(response, request, options.build) : response, request.method, status, api,
    );
    if (path === "/repo-curve") {
      // The old Worker does not add page indexing/publication metadata to this API.
      result.headers.delete("X-Robots-Tag");
      result.headers.delete("x-gsc-publication");
    }
    return result;
  };
  if (path === "/api/lang" && ["GET", "HEAD"].includes(request.method)) return finish(languageRedirect(request));
  if (path === "/api/workflows/refresh/revalidate" && request.method === "POST" && options.unscopedRender) {
    return finish(await options.unscopedRender());
  }
  const redirect = negotiateLocale(request);
  if (redirect) return finish(redirect);
  const bypass = bypassPageCache(request);
  const tail = isLongTail(path);
  const now = options.now ?? Date.now;
  const key = (publication: Publication) => JSON.stringify([options.build, url.origin, url.pathname, url.search, "html", tail ? "tail" : publication.id]);
  const read = async (publication: Publication): Promise<StoredEntry | null> => {
    if (bypass) return null;
    try { return await options.store.get(key(publication)); } catch { return null; }
  };
  const responseFor = (entry: StoredEntry): Response | null => {
    const value = entry.value;
    if (value?.kind !== "APP_ROUTE") return null;
    return new Response(value.body, { status: value.status, headers: value.headers as Record<string, string> });
  };
  const render = async (publication: Publication, startedAt: number): Promise<Response | null> => {
    const response = await options.render(publication);
    const body = await response.arrayBuffer();
    if ((await options.publication()).id !== publication.id) return null;
    const headers = new Headers(response.headers);
    if (!api) headers.set("x-gsc-publication", publication.id);
    const entry: StoredEntry = {
      v: 1, lastModified: now(), fence: tail ? "tail" : publication.id, tags: [url.pathname],
      cacheControl: { revalidate: tail ? TAIL_FRESH_SECONDS : 3600, expire: tail ? TAIL_EXPIRE_SECONDS : 3600 },
      value: { kind: "APP_ROUTE", body, status: response.status, headers: Object.fromEntries(headers) },
    };
    if (!bypass && response.status === 200 && headers.get("content-type")?.includes("text/html")
      && !headers.has("set-cookie") && !headers.has("vary") && body.byteLength < MAX_ENTRY_BYTES / 2) {
      try {
        // A tag invalidated during rendering must not be refilled by late output.
        if (!await options.store.invalid({ ...entry, lastModified: startedAt })
          && (await options.publication()).id === publication.id) await options.store.set(key(publication), entry);
      } catch { /* Cache loss cannot prevent rendering or weaken the publication fence. */ }
    }
    if ((await options.publication()).id !== publication.id) return null;
    return new Response(response.body === null ? null : body, { status: response.status, headers });
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = now();
      const publication = await options.publication();
      // P7 handlers own their methods/auth. Never retry a mutating request after publication.
      if (bypass && !["GET", "HEAD"].includes(request.method)) return finish(await options.render(publication));
      const entry = await read(publication);
      if (entry) {
        const age = (now() - entry.lastModified) / 1000;
        const expire = tail ? TAIL_EXPIRE_SECONDS : 3600;
        const hit = responseFor(entry);
        if (hit && age >= 0 && age < expire && entry.fence === (tail ? "tail" : publication.id)) {
          if (!tail && (await options.publication()).id !== publication.id) continue;
          if (tail && age >= TAIL_FRESH_SECONDS) {
            options.waitUntil((async () => {
              const current = await options.publication();
              await render(current, now());
            })().catch(() => {}));
            return finish(hit, "STALE");
          }
          return finish(hit, "HIT");
        }
      }
      const response = await render(publication, startedAt);
      if (response) return finish(response, bypass ? "BYPASS" : "MISS");
    }
  } catch { /* Unknown/missing/unreadable publication fails closed for data-dependent requests. */ }
  return finish(new Response(api || path === "/repo-curve" ? "Publication changed or unavailable; retry" : "Published data is temporarily unavailable.", { status: 503 }), "BYPASS", false);
}
