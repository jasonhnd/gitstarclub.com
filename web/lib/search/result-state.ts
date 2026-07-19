import type { SearchHit } from "./core";

export type SearchResultSnapshot = {
  query: string;
  hits: SearchHit[];
};

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
