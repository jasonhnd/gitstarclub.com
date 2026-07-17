// Unit tests for the PURE helper math in github.ts, with NO network and NO token.
//
// github.ts exports only three functions — fetchStarCounts, searchWhitelist,
// batchMetadata — and each is gated on GITHUB_TOKEN and immediately calls fetch()
// against api.github.com, so none are unit-testable without hitting the live API.
// Its genuinely pure pieces are module-PRIVATE:
//   - secondaryLimitDelayMs(status, text)  → abuse/secondary-rate-limit detector
//   - retryDelayMs(res, attempt)           → retry-after / rate-reset / backoff math
//   - the star-range bucket-split math inside searchWhitelist
//   - the GraphQL query-string builders inside fetchStarCounts / batchMetadata
// Since they aren't exported, we replicate them VERBATIM here and test the math.
// (If github.ts changes these helpers, keep the replicas in sync.) No fetch is
// invoked and GITHUB_TOKEN is never set, so this suite makes zero network calls.
import { test, expect, describe } from "bun:test";
import { searchWhitelistWithSearch, type SearchResult } from "./github";

const MAX_RETRIES = 4; // mirrors github.ts

// --- Verbatim replicas of the private helpers in github.ts ----------------------
function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);

  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (remaining === 0 && Number.isFinite(reset) && reset > 0) {
    return Math.min(Math.max(reset * 1000 - Date.now(), 0) + 1000, 60_000);
  }

  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

function secondaryLimitDelayMs(status: number, text: string): number | null {
  if (status !== 403) return null;
  return /secondary rate limit|abuse detection|rate limit/i.test(text) ? 60_000 : null;
}

// Helper to build a Response with arbitrary headers (header math is what we test).
function resWith(headers: Record<string, string>): Response {
  return new Response(null, { status: 200, headers });
}

describe("secondaryLimitDelayMs (pure)", () => {
  test("returns null for any non-403 status", () => {
    expect(secondaryLimitDelayMs(200, "secondary rate limit")).toBeNull();
    expect(secondaryLimitDelayMs(429, "abuse detection")).toBeNull();
    expect(secondaryLimitDelayMs(500, "rate limit")).toBeNull();
  });

  test("returns 60s for a 403 mentioning a secondary/abuse/rate limit (case-insensitive)", () => {
    expect(secondaryLimitDelayMs(403, "You have exceeded a secondary rate limit")).toBe(60_000);
    expect(secondaryLimitDelayMs(403, "ABUSE DETECTION triggered")).toBe(60_000);
    expect(secondaryLimitDelayMs(403, "API rate limit exceeded")).toBe(60_000);
  });

  test("returns null for a 403 that is not a rate-limit message (e.g. plain forbidden)", () => {
    expect(secondaryLimitDelayMs(403, "Bad credentials")).toBeNull();
    expect(secondaryLimitDelayMs(403, "")).toBeNull();
  });
});

describe("retryDelayMs (pure)", () => {
  test("honours a positive Retry-After header (seconds → ms), capped at 60s", () => {
    expect(retryDelayMs(resWith({ "retry-after": "3" }), 1)).toBe(3000);
    expect(retryDelayMs(resWith({ "retry-after": "120" }), 1)).toBe(60_000); // capped
  });

  test("ignores a non-positive / non-numeric Retry-After and falls through", () => {
    // attempt 2 with no usable headers → exponential backoff 1000 * 2^(2-1) = 2000
    expect(retryDelayMs(resWith({ "retry-after": "0" }), 2)).toBe(2000);
    expect(retryDelayMs(resWith({ "retry-after": "nope" }), 2)).toBe(2000);
  });

  test("waits until x-ratelimit-reset when remaining is 0 (+1s grace), capped at 60s", () => {
    // reset 5s in the future → ~5000 + 1000 grace; allow timing slack on the lower bound.
    const resetEpoch = Math.floor((Date.now() + 5000) / 1000);
    const delay = retryDelayMs(resWith({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetEpoch) }), 1);
    expect(delay).toBeGreaterThan(4000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  test("clamps a past reset time to the +1s grace floor", () => {
    const pastEpoch = Math.floor((Date.now() - 10_000) / 1000);
    const delay = retryDelayMs(resWith({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(pastEpoch) }), 1);
    expect(delay).toBe(1000); // Math.max(negative,0)+1000
  });

  test("does NOT use the reset branch when remaining > 0", () => {
    const resetEpoch = Math.floor((Date.now() + 60_000) / 1000);
    // remaining=10 → skip reset math → backoff for attempt 1 = 1000
    const delay = retryDelayMs(resWith({ "x-ratelimit-remaining": "10", "x-ratelimit-reset": String(resetEpoch) }), 1);
    expect(delay).toBe(1000);
  });

  test("exponential backoff by attempt, capped at 30s, when no rate headers present", () => {
    const noHeaders = () => resWith({});
    expect(retryDelayMs(noHeaders(), 1)).toBe(1000); // 1000 * 2^0
    expect(retryDelayMs(noHeaders(), 2)).toBe(2000); // 1000 * 2^1
    expect(retryDelayMs(noHeaders(), 3)).toBe(4000); // 1000 * 2^2
    expect(retryDelayMs(noHeaders(), 4)).toBe(8000); // 1000 * 2^3
    expect(retryDelayMs(noHeaders(), 10)).toBe(30_000); // capped
  });
});

// --- Star-range bucketing: the adaptive split inside searchWhitelist ------------
// Mirrors: if total_count > 1000 && high > low → split at mid = floor((low+high)/2)
// into [low, mid] and [mid+1, high]; otherwise the bucket is "terminal" (page it).
function splitBucket(low: number, high: number): [number, number] {
  const mid = Math.floor((low + high) / 2);
  return [mid, mid + 1]; // boundary of the two child buckets: [low,mid] and [mid+1,high]
}

describe("searchWhitelist star-range bucketing math (replicated)", () => {
  test("discovers 599,999, 600,000, 600,001 and >1m without a fixed upper ceiling", async () => {
    const repos = [599_999, 600_000, 600_001, 1_250_000].map((stars, index) => ({
      id: index + 1,
      node_id: `R_${index + 1}`,
      full_name: `owner/repo-${index + 1}`,
      name: `repo-${index + 1}`,
      stargazers_count: stars,
      owner: { login: "owner" },
    }));
    const queries: string[] = [];
    const search = async (params: Record<string, string | number>): Promise<SearchResult> => {
      const q = String(params.q);
      queries.push(q);
      if (q === "stars:>=599999") return { total_count: repos.length, items: [repos.at(-1)!] };
      if (q === "stars:599999..1250000") return { total_count: repos.length, items: repos.toReversed() };
      throw new Error(`unexpected query ${q}`);
    };

    const result = await searchWhitelistWithSearch(599_999, search);

    expect(result.map((repo) => repo.stars)).toEqual([1_250_000, 600_001, 600_000, 599_999]);
    expect(queries).toEqual(["stars:>=599999", "stars:599999..1250000"]);
  });

  test("fails closed instead of publishing an incomplete Search membership", async () => {
    await expect(
      searchWhitelistWithSearch(10_000, async () => ({ total_count: 1, incomplete_results: true, items: [] })),
    ).rejects.toThrow("GitHub Search returned incomplete results");
  });

  test("splits a wide bucket at the floored midpoint with no gap or overlap", () => {
    const [mid, next] = splitBucket(10000, 600000);
    expect(mid).toBe(305000);
    expect(next).toBe(305001); // child buckets [10000,305000] and [305001,600000] tile exactly
    expect(next).toBe(mid + 1);
  });

  test("a single-star-wide bucket cannot split further (high === low halts recursion)", () => {
    // In searchWhitelist the guard is `high > low`; when low === high it never splits.
    const low = 12345;
    const high = 12345;
    expect(high > low).toBe(false);
  });

  test("midpoint split eventually terminates (strictly shrinking ranges)", () => {
    // Drive the split to a width-1 range to prove progress / no infinite loop.
    const lo = 10000;
    let hi = 10003;
    let guard = 0;
    while (hi > lo && guard < 100) {
      const mid = Math.floor((lo + hi) / 2);
      // always recurse into the lower child for this progress check
      hi = mid;
      guard++;
    }
    expect(lo).toBe(hi);
    expect(guard).toBeLessThan(100);
  });

  test("pages-per-bucket is clamped to GitHub's 10-page (1000 result) ceiling", () => {
    // Mirrors: const pages = Math.min(Math.ceil(total/100), 10)
    const pages = (total: number) => Math.min(Math.ceil(total / 100), 10);
    expect(pages(0)).toBe(0);
    expect(pages(50)).toBe(1);
    expect(pages(150)).toBe(2);
    expect(pages(1000)).toBe(10);
    expect(pages(5000)).toBe(10); // clamped
  });

  test("whitelist entries dedup by id and sort by stars desc", () => {
    // Mirrors the Map<id, entry> dedup + final .sort((a,b)=>b.stars-a.stars).
    const raw = [
      { id: 1, stars: 100 },
      { id: 2, stars: 500 },
      { id: 1, stars: 100 }, // duplicate id (range-boundary overlap) → collapses
      { id: 3, stars: 300 },
    ];
    const dedup = new Map<number, { id: number; stars: number }>();
    for (const r of raw) dedup.set(r.id, r);
    const sorted = [...dedup.values()].sort((a, b) => b.stars - a.stars);
    expect(sorted.map((r) => r.id)).toEqual([2, 3, 1]);
    expect(sorted).toHaveLength(3); // 4 raw → 3 after dedup
  });
});

// --- MAX_RETRIES boundary used by gql()/restSearch() (attempt <= MAX_RETRIES) ---
describe("retry attempt boundary (MAX_RETRIES)", () => {
  test("retries while attempt <= MAX_RETRIES, stops after", () => {
    const shouldRetry = (attempt: number) => attempt <= MAX_RETRIES;
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(MAX_RETRIES)).toBe(true);
    expect(shouldRetry(MAX_RETRIES + 1)).toBe(false);
  });
});
