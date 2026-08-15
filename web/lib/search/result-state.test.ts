import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SearchHit } from "./core";
import {
  acceptSearchResults,
  presentSearchChromeBody,
  searchHitForCommit,
  searchHitIsActive,
  startSearchQuery,
} from "./result-state";

const facebook: SearchHit = {
  id: 1,
  full_name: "facebook/react",
  owner: "facebook",
  language: "JavaScript",
  current_stars: 232_000,
  description: "A UI library",
  active: true,
};

const historical: SearchHit = {
  id: 9,
  full_name: "history/dropped",
  owner: "history",
  language: "Go",
  current_stars: 18_000,
  description: "no longer polled",
  active: false,
};

describe("search result freshness", () => {
  test("a new query clears old hits before its worker response arrives", () => {
    const oldResults = acceptSearchResults("facebook", [facebook]);
    expect(searchHitForCommit(oldResults, "facebook", 0)).toBe(facebook);

    const pendingVueResults = startSearchQuery("vue");

    expect(pendingVueResults.hits).toEqual([]);
    expect(searchHitForCommit(pendingVueResults, "vue", 0)).toBeNull();
  });

  test("commit rejects an old snapshot after the input query changes", () => {
    const oldResults = acceptSearchResults("facebook", [facebook]);

    expect(searchHitForCommit(oldResults, "vue", 0)).toBeNull();
  });
});

describe("search chrome empty / typo / inactive presentation", () => {
  test("empty match state stays in chrome (no results body)", () => {
    expect(presentSearchChromeBody({ searchFailed: false, loading: false, hits: [] })).toEqual({
      kind: "empty",
    });
  });

  test("typo with zero hits uses the same chrome empty body while loading uses loading", () => {
    // Unresolved typos leave hits empty; presentation never invents a results page.
    expect(presentSearchChromeBody({ searchFailed: false, loading: true, hits: [] })).toEqual({
      kind: "loading",
    });
    expect(presentSearchChromeBody({ searchFailed: false, loading: false, hits: [] })).toEqual({
      kind: "empty",
    });
  });

  test("inactive rows are marked for demoted presentation", () => {
    const body = presentSearchChromeBody({
      searchFailed: false,
      loading: false,
      hits: [facebook, historical],
    });
    expect(body.kind).toBe("results");
    if (body.kind !== "results") return;
    expect(searchHitIsActive(body.hits[0]!)).toBe(true);
    expect(searchHitIsActive(body.hits[1]!)).toBe(false);
    expect(body.hits[1]?.active).toBe(false);
    // Row chrome should treat inactive as a labeled demotion, not a peer hide.
    expect(body.hits.map((hit) => ({ name: hit.full_name, active: hit.active }))).toEqual([
      { name: "facebook/react", active: true },
      { name: "history/dropped", active: false },
    ]);
  });

  test("there is no dedicated /search results route under app/", () => {
    const webRoot = join(import.meta.dir, "../..");
    expect(existsSync(join(webRoot, "app/search/page.tsx"))).toBe(false);
    expect(existsSync(join(webRoot, "app/search/route.ts"))).toBe(false);
    // Index endpoint only — not a query-results page.
    expect(existsSync(join(webRoot, "app/search-index/route.ts"))).toBe(true);
  });
});
