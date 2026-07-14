import type { SearchIndex } from "@/lib/contracts";

// Pure response builder for GET /search-index. Kept free of Next/React imports so unit
// tests can exercise success, empty, and failure paths without mocking @/lib/data
// (which would leak across the shared Bun test process). See app/search-index/route.ts.

export const SEARCH_INDEX_HIT_CACHE =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
export const SEARCH_INDEX_MISS_CACHE = "public, max-age=0, s-maxage=60";
export const SEARCH_INDEX_FAIL_CACHE = "no-store";
export const SEARCH_INDEX_DESCRIPTION_CAP = 96;

export function slimSearchIndex(index: SearchIndex, descriptionCap = SEARCH_INDEX_DESCRIPTION_CAP): SearchIndex {
  return {
    ...index,
    repos: index.repos.map((repo) => ({
      ...repo,
      description: repo.description ? repo.description.slice(0, descriptionCap) : null,
    })),
  };
}

export async function buildSearchIndexResponse(
  load: () => Promise<SearchIndex | null>,
): Promise<Response> {
  try {
    const index = await load();
    if (!index) {
      return Response.json(
        { generated_at: "", count: 0, repos: [] },
        { headers: { "Cache-Control": SEARCH_INDEX_MISS_CACHE } },
      );
    }
    return Response.json(slimSearchIndex(index), {
      headers: { "Cache-Control": SEARCH_INDEX_HIT_CACHE },
    });
  } catch (error) {
    console.error("[search-index] unavailable", {
      code: "search_index_unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "search_index_unavailable", retryable: true },
      { status: 503, headers: { "Cache-Control": SEARCH_INDEX_FAIL_CACHE } },
    );
  }
}
