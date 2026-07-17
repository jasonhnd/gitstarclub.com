import type { SearchDoc } from "@/lib/contracts";
import { isAbortError } from "@/lib/client/latest-request";
import { createSearchWorkerError, parseSearchIndexPayload, type SearchWorkerError } from "./worker-protocol";

export type SearchIndexFetch = (input: string, init: RequestInit) => Promise<Response>;

export type SearchIndexFetchResult =
  | { ok: true; repos: SearchDoc[] }
  | { ok: false; error: SearchWorkerError };

export type SearchIndexFetchOptions = {
  cache?: "no-cache" | "reload";
  fetchImpl?: SearchIndexFetch;
  signal?: AbortSignal;
};

export async function fetchSearchIndex({
  cache = "no-cache",
  fetchImpl = fetch,
  signal,
}: SearchIndexFetchOptions = {}): Promise<SearchIndexFetchResult> {
  try {
    const response = await fetchImpl("/search-index", { cache, signal });
    if (!response.ok) {
      return {
        ok: false,
        error: createSearchWorkerError("load-failed", `Search index request failed with ${response.status}`),
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return { ok: false, error: createSearchWorkerError("bad-index", error) };
    }

    return parseSearchIndexPayload(payload);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    return { ok: false, error: createSearchWorkerError("load-failed", error) };
  }
}
