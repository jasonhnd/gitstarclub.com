import { AsyncLocalStorage } from "node:async_hooks";
import type { pageData } from "./data";
import { publicationScope } from "../../../web/lib/workers-host/publication-fence";
import { withWorkerEnv, workerBindings } from "../../../web/lib/workers-host/runtime-env";
import { fetchWithTimeout as originalFetchWithTimeout } from "../../../web/lib/fetch-timeout.mjs";
export { DEFAULT_FETCH_TIMEOUT_MS, BLOB_JSON_FETCH_TIMEOUT_MS, GITHUB_FETCH_TIMEOUT_MS, FetchTimeoutError } from "../../../web/lib/fetch-timeout.mjs";

type Data = ReturnType<typeof pageData>;
const scope = new AsyncLocalStorage<{ data: Data; origin: string }>();
const json = { parse: (value: unknown) => value };

/** Run the unchanged web readers against this request's captured native DATA. */
export function withPublishedReaders<T>(data: Data, run: () => T): T {
  // Publication identity also isolates the existing immutable-history memo keys.
  const origin = `https://${data.publication.id}.astro-data.invalid`;
  return scope.run({ data, origin }, () => withWorkerEnv({
    ...workerBindings(), STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: origin,
    VIEWS_VERSION_FALLBACK: "",
  }, () => publicationScope.run(data.publication, run)));
}

/** Vite redirects only the existing readers' timeout import to this adapter. */
export function fetchWithTimeout(input: Parameters<typeof originalFetchWithTimeout>[0], init: Parameters<typeof originalFetchWithTimeout>[1] = {}) {
  const captured = scope.getStore();
  if (!captured) return originalFetchWithTimeout(input, init);
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== captured.origin) return originalFetchWithTimeout(input, init);
  return originalFetchWithTimeout(input, {
    ...init,
    fetcher: async (_input, options) => {
      options?.signal?.throwIfAborted();
      if (options?.method && options.method !== "GET" && options.method !== "HEAD") {
        throw new Error("Published DATA transport is read-only");
      }
      const key = decodeURIComponent(url.pathname.slice(1));
      if (!/^[a-zA-Z0-9_./-]+\.json$/.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
        throw new Error("Invalid published DATA key");
      }
      const value = await captured.data.raw(key, json);
      options?.signal?.throwIfAborted();
      return new Response(options?.method === "HEAD" ? null : JSON.stringify(value), {
        status: value === null ? 404 : 200, headers: { "Content-Type": "application/json" },
      });
    },
  });
}
