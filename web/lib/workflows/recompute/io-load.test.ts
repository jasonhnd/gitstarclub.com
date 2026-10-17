import { describe, expect, mock, test } from "bun:test";
import { runWithCloudflareWorkersHostForTests } from "@/lib/runtime-config";
import { CANONICAL_SHARD_READ_CONCURRENCY_CF } from "@/lib/workflows/canonical-validation";

let inflight = 0;
let maxInflight = 0;
const reads: string[] = [];

mock.module("@/lib/data/source", () => ({
  readAuthoritativeView: async (path: string) => {
    reads.push(path);
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inflight -= 1;
    if (path.includes("site-daily/")) {
      const year = path.match(/site-daily\/(\d+)\.json$/)?.[1] ?? "2010";
      return { year, cells: [] };
    }
    return {};
  },
  readRequiredView: async () => ({
    seam_date: "2026-05-30",
    schema_ver: 1,
    folded_through: { month: "2026-05", week: "2026-W22" },
    generated_at: "2026-05-30T00:00:00.000Z",
  }),
}));

const { collectSeriesPeriods, loadCanonicalModel, loadPackedRepoWindow, slimRankRepoMeta } = await import("./io");

describe("loadCanonicalModel CF budget", () => {
  test("does not fan out all 128 canonical shards at once on the CF host", async () => {
    inflight = 0;
    maxInflight = 0;
    reads.length = 0;
    const loaded = await runWithCloudflareWorkersHostForTests(true, () => loadCanonicalModel("refresh-cf-recompute"));
    expect(loaded.seamDate).toBe("2026-05-30");
    expect(maxInflight).toBeGreaterThan(0);
    expect(maxInflight).toBeLessThanOrEqual(CANONICAL_SHARD_READ_CONCURRENCY_CF);
  });

  test("a month hop does not read weekly or recent-daily families", async () => {
    reads.length = 0;
    await runWithCloudflareWorkersHostForTests(true, () =>
      loadCanonicalModel("refresh-cf-recompute", { families: ["repos", "monthly"] }),
    );
    expect(reads.some((path) => path.includes("repo-weekly/"))).toBe(false);
    expect(reads.some((path) => path.includes("repo-recent-daily/"))).toBe(false);
    expect(reads.some((path) => path.includes("repo-monthly/"))).toBe(true);
    expect(reads.some((path) => path.includes("repos/"))).toBe(true);
  });

  test("packed month load pairs one repo shard with one monthly shard and skips weekly", async () => {
    inflight = 0;
    maxInflight = 0;
    reads.length = 0;
    const loaded = await runWithCloudflareWorkersHostForTests(true, () => loadPackedRepoWindow("refresh-cf-recompute", "month"));
    expect(loaded.kind).toBe("month");
    expect(loaded.fromPersist).toBe(false);
    expect(maxInflight).toBe(1);
    expect(reads.some((path) => path.includes("repo-weekly/"))).toBe(false);
    expect(reads.some((path) => path.includes("repo-recent-daily/"))).toBe(false);
    expect(reads.some((path) => path.includes("repo-monthly/"))).toBe(true);
    expect(reads.some((path) => path.includes("repos/"))).toBe(true);
  });

  test("week period collection reads weekly shards one at a time and skips recent-daily", async () => {
    inflight = 0;
    maxInflight = 0;
    reads.length = 0;
    const periods = await runWithCloudflareWorkersHostForTests(true, () => collectSeriesPeriods("refresh-cf-recompute", "week"));
    expect(periods).toEqual([]);
    expect(maxInflight).toBe(1);
    expect(reads.some((path) => path.includes("repo-weekly/"))).toBe(true);
    expect(reads.some((path) => path.includes("repo-monthly/"))).toBe(false);
    expect(reads.some((path) => path.includes("repo-recent-daily/"))).toBe(false);
  });
});

describe("slimRankRepoMeta", () => {
  test("keeps rank fields and drops description/languages/topics", () => {
    const slim = slimRankRepoMeta(7, {
      id: 7,
      owner: "acme",
      owner_type: "Organization",
      name: "cli",
      full_name: "acme/cli",
      description: "a very long readme that must not stay in a rank hop",
      language: "Go",
      languages: [{ name: "Go", size: 100 }],
      topics: ["cli", "tools"],
      current_stars: 12000,
      d: 1,
      active: true,
    });
    expect(slim.owner).toBe("acme");
    expect(slim.d).toBe(1);
    expect(slim.current_stars).toBe(12000);
    expect(slim.description).toBeUndefined();
    expect(slim.languages).toBeUndefined();
    expect(slim.topics).toBeUndefined();
  });
});
