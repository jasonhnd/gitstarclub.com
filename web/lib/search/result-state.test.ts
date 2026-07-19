import { describe, expect, test } from "bun:test";
import type { SearchHit } from "./core";
import { acceptSearchResults, searchHitForCommit, startSearchQuery } from "./result-state";

const facebook: SearchHit = {
  id: 1,
  full_name: "facebook/react",
  owner: "facebook",
  language: "JavaScript",
  current_stars: 232_000,
  description: "A UI library",
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
