import type { SearchHit } from "./core";

export type SearchResultSnapshot = {
  query: string;
  hits: SearchHit[];
};

/** Chrome-only panel body; there is no `/search?q=` results page. */
export type SearchChromeBody =
  | { kind: "error" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "results"; hits: SearchHit[] };

export function startSearchQuery(query: string): SearchResultSnapshot {
  return { query, hits: [] };
}

export function acceptSearchResults(query: string, hits: SearchHit[]): SearchResultSnapshot {
  return { query, hits };
}

export function searchHitForCommit(
  results: SearchResultSnapshot,
  currentQuery: string,
  index: number,
): SearchHit | null {
  if (results.query !== currentQuery) return null;
  return results.hits[index] ?? null;
}

/** True for current membership; historical rows (`active: false`) are demoted/labeled. */
export function searchHitIsActive(hit: Pick<SearchHit, "active">): boolean {
  return hit.active !== false;
}

/**
 * Panel body for the nav SearchBox chrome.
 * Empty queries and unresolved typos stay here — never a dedicated search route.
 */
export function presentSearchChromeBody(options: {
  searchFailed: boolean;
  loading: boolean;
  hits: readonly SearchHit[];
}): SearchChromeBody {
  if (options.searchFailed) return { kind: "error" };
  if (options.hits.length > 0) return { kind: "results", hits: [...options.hits] };
  if (options.loading) return { kind: "loading" };
  return { kind: "empty" };
}
