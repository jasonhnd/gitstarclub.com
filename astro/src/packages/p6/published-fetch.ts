import { fetchWithTimeout as existingFetchWithTimeout } from "../../../../web/lib/fetch-timeout.mjs";
import { R2BindingObjectStore, type R2Bucket } from "../../../../web/lib/storage/r2-binding-store";
import { workerBindings } from "../../../../web/lib/workers-host/runtime-env";
import { PUBLISHED_READ_ORIGIN } from "./published-reads";
export { DEFAULT_FETCH_TIMEOUT_MS, BLOB_JSON_FETCH_TIMEOUT_MS, GITHUB_FETCH_TIMEOUT_MS, FetchTimeoutError } from "../../../../web/lib/fetch-timeout.mjs";

type TimeoutOptions = NonNullable<Parameters<typeof existingFetchWithTimeout>[1]>;

/** Request-scoped native transport for unchanged web readers; never patches global fetch. */
export function fetchWithTimeout(input: RequestInfo | URL, init: TimeoutOptions = {}) {
  if (init.fetcher) return existingFetchWithTimeout(input, init);
  return existingFetchWithTimeout(input, { ...init, fetcher: async (target, options) => {
    const url = new URL(target instanceof Request ? target.url : String(target));
    if (url.origin === PUBLISHED_READ_ORIGIN) {
      const method = options?.method ?? (target instanceof Request ? target.method : "GET");
      if (!["GET", "HEAD"].includes(method)) throw new Error("Published reads are read-only");
      const bucket = workerBindings().DATA as R2Bucket | undefined;
      if (!bucket) throw new Error("Published DATA binding is missing");
      const object = await new R2BindingObjectStore({ bucket }).get(url.pathname.slice(1));
      return new Response(method === "HEAD" ? null : object?.body ?? null, {
        status: object ? 200 : 404,
        headers: { "Content-Type": "application/json", ...(object?.etag ? { ETag: object.etag } : {}) },
      });
    }
    // Workers only accepts no-store/no-cache; application caching belongs to P0.
    const { cache, ...rest } = options ?? {};
    return fetch(target, { ...rest, ...(["no-store", "no-cache"].includes(cache ?? "") ? { cache } : {}) });
  } });
}
