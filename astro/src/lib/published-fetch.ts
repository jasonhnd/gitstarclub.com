import { fetchWithTimeout as httpFetchWithTimeout } from "../../../web/lib/fetch-timeout.mjs";
import { R2BindingObjectStore, type R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { withWorkerEnv, workerBindings } from "../../../web/lib/workers-host/runtime-env";
export { DEFAULT_FETCH_TIMEOUT_MS, BLOB_JSON_FETCH_TIMEOUT_MS, GITHUB_FETCH_TIMEOUT_MS, FetchTimeoutError } from "../../../web/lib/fetch-timeout.mjs";

const DATA_ORIGIN = "https://astro-data.invalid";

/** Keep existing publication/live-history readers intact; adapt only their transport. */
export function withPublishedData<T>(run: () => T): T {
  return withWorkerEnv({ ...workerBindings(), BLOB_BASE_URL: DATA_ORIGIN, STORAGE_READ_DRIVER: "blob" }, run);
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: Parameters<typeof httpFetchWithTimeout>[1] = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== DATA_ORIGIN || init?.fetcher) return httpFetchWithTimeout(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (!["GET", "HEAD"].includes(method)) throw new Error("Published page transport is read-only");
  const key = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9_./-]+\.json$/.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid published object key");
  const bucket = workerBindings().DATA as R2Bucket | undefined;
  if (!bucket) throw new Error("Published page transport requires DATA");
  const store = new R2BindingObjectStore({ bucket });
  return httpFetchWithTimeout(input, { ...init, fetcher: async () => {
    const object = await store.get(key);
    return new Response(method === "HEAD" ? null : object?.body ?? null, {
      status: object ? 200 : 404,
      headers: { "Content-Type": "application/json", ...(object?.etag ? { ETag: object.etag } : {}) },
    });
  } });
}
