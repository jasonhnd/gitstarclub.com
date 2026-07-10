import { describe, expect, test } from "bun:test";
import { isRenderableRepoFullName, normalizeRepoPageEntity } from "./repo-readiness";

describe("normalizeRepoPageEntity", () => {
  test("keeps a linked repo renderable when optional sections are malformed", () => {
    const repo = normalizeRepoPageEntity(
      {
        id: 259,
        full_name: "fighting41love/funNLP",
        owner: "fighting41love",
        owner_type: "User",
        name: "funNLP",
        description: null,
        language: "Python",
        languages: "Python",
        topics: null,
        homepage_url: "javascript:alert(1)",
        license: null,
        latest_release: { tag_name: "v1", url: "ftp://example.test/release" },
        created_at: "not-a-date",
        current_stars: 10_000,
        is_archived: false,
        milestones: null,
        curve: { monthly: null, recent_daily: "bad" },
        monthly_table: null,
        rank_history: { month: "bad" },
        inflections: "bad",
      },
      259,
    );

    expect(repo?.full_name).toBe("fighting41love/funNLP");
    expect(repo?.created_at).toBeNull();
    expect(repo?.homepage_url).toBeNull();
    expect(repo?.latest_release?.url).toBeNull();
    expect(repo?.languages).toEqual([]);
    expect(repo?.topics).toEqual([]);
    expect(repo?.curve.monthly).toEqual([]);
    expect(repo?.milestones).toEqual({ crossed_10k: null, crossed_50k: null, crossed_100k: null });
  });

  test("returns null when required identity fields are malformed", () => {
    expect(
      normalizeRepoPageEntity({
        id: 259,
        full_name: "fighting41love",
        owner: "fighting41love",
        owner_type: "User",
        name: "funNLP",
        current_stars: 10_000,
      }),
    ).toBeNull();
  });
});

describe("isRenderableRepoFullName", () => {
  test("accepts owner/name paths and rejects malformed sitemap paths", () => {
    expect(isRenderableRepoFullName("fighting41love/funNLP")).toBe(true);
    expect(isRenderableRepoFullName("missing-slash")).toBe(false);
    expect(isRenderableRepoFullName("owner/")).toBe(false);
    expect(isRenderableRepoFullName("owner/name?debug=1")).toBe(false);
  });
});
