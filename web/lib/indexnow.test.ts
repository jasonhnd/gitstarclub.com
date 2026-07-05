import type { ZodType } from "zod";
import { beforeEach, describe, expect, test } from "bun:test";

const TS = "2026-06-26T00:00:00.000Z";
const views = new Map<string, unknown>();

const {
  buildIndexNowPayloads,
  indexNowKeyLocation,
  liveOverlayCanonicalPaths,
  submitIndexNowUrls,
  workflowPublishCanonicalPaths,
} = await import("./indexnow");

beforeEach(() => {
  views.clear();
  delete process.env.INDEXNOW_ENABLED;
  delete process.env.VERCEL_ENV;
});

describe("IndexNow batching", () => {
  test("builds deterministic same-host payloads with documented caps", () => {
    const input = ["/z/z", "/rankings", "", "/pulse", "https://evil.example/nope", "/rankings/2026/6", "/z/z?ignored=1"];
    const reversed = [...input].reverse();

    const first = buildIndexNowPayloads(input, { base: "https://gitstarclub.com", maxUrls: 3, maxBatchSize: 2 });
    const second = buildIndexNowPayloads(reversed, { base: "https://gitstarclub.com", maxUrls: 3, maxBatchSize: 2 });

    expect(first).toEqual(second);
    expect(first.truncated).toBe(true);
    expect(first.payloads).toHaveLength(2);
    expect(first.payloads[0].host).toBe("gitstarclub.com");
    expect(first.payloads[0].keyLocation).toBe(indexNowKeyLocation("https://gitstarclub.com"));
    expect(first.payloads.flatMap((payload) => payload.urlList)).toEqual([
      "https://gitstarclub.com",
      "https://gitstarclub.com/pulse",
      "https://gitstarclub.com/rankings",
    ]);
  });

  test("logs IndexNow POST failures without throwing", async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const result = await submitIndexNowUrls(["/pulse"], { source: "test" }, {
        base: "https://gitstarclub.com",
        enabled: true,
        fetcher: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
      });

      expect(result.failed).toBe(1);
      expect(result.submitted).toBe(0);
      expect(warnings[0][0]).toBe("[indexnow]");
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("IndexNow URL derivation", () => {
  test("builds live-overlay canonical URLs for hot paths and mover entities", () => {
    const paths = liveOverlayCanonicalPaths({
      year: 2026,
      monthPeriod: "2026-06",
      weekPeriod: "2026-W26",
      repos: {
        "1": { owner: "alpha", name: "one", full_name: "alpha/one", owner_type: "Organization", language: "TypeScript", current_stars: 100 },
        "2": { owner: "beta", name: "two", full_name: "beta/two", owner_type: "User", language: null, current_stars: 200 },
      },
      repoIds: [2, 1, 2],
      orgLogins: ["beta", "alpha", "beta"],
    });

    expect(paths).toEqual([
      "",
      "/alpha/one",
      "/beta/two",
      "/o/alpha",
      "/o/beta",
      "/pulse",
      "/rankings",
      "/rankings/2026",
      "/rankings/2026/6",
      "/rankings/2026/W26",
    ]);
  });

  test("derives workflow publish URLs from changed versioned Blob views", async () => {
    views.set("views/v2/lookup/repos.json", {
      "1": { owner: "alpha", name: "one", full_name: "alpha/one", owner_type: "Organization", language: "TypeScript", current_stars: 110 },
      "2": { owner: "beta", name: "two", full_name: "beta/two", owner_type: "User", language: null, current_stars: 200 },
    });
    views.set("views/v1/lookup/repos.json", {
      "1": { owner: "alpha", name: "one", full_name: "alpha/one", owner_type: "Organization", language: "TypeScript", current_stars: 100 },
    });
    views.set("views/v2/lookup/orgs.json", { alpha: { login: "alpha", owner_type: "Organization", repo_count: 1, current_stars_sum: 110 } });
    views.set("views/v1/lookup/orgs.json", { alpha: { login: "alpha", owner_type: "Organization", repo_count: 1, current_stars_sum: 100 } });
    views.set("views/v2/lookup/categories.json", { rules_version: "1", generated_at: TS, dimensions: [] });
    views.set("views/v1/lookup/categories.json", { rules_version: "1", generated_at: TS, dimensions: [] });
    views.set("views/v2/meta.json", {
      seam_date: "2026-05-30",
      schema_ver: 1,
      generated_at: TS,
      folded_through: { month: "2026-05", week: "2026-W22" },
    });
    views.set("views/v1/meta.json", {
      seam_date: "2026-05-30",
      schema_ver: 1,
      generated_at: "2026-06-25T00:00:00.000Z",
      folded_through: { month: "2026-05", week: "2026-W22" },
    });
    views.set("views/v2/rank/all-time/repo/stock.json", {
      meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: TS },
      items: [{ rank: 1, id: 1, value: 110, prev_rank: null }],
    });
    views.set("views/v1/rank/all-time/repo/stock.json", {
      meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: "2026-06-25T00:00:00.000Z" },
      items: [{ rank: 1, id: 1, value: 100, prev_rank: null }],
    });
    views.set("views/v2/entity/repo/1.json", repoEntity(1, "alpha/one", 110));
    views.set("views/v1/entity/repo/1.json", repoEntity(1, "alpha/one", 100));
    views.set("views/v2/entity/repo/2.json", repoEntity(2, "beta/two", 200));
    views.set("views/v2/entity/org/alpha.json", orgEntity("alpha", 110));
    views.set("views/v1/entity/org/alpha.json", orgEntity("alpha", 100));

    const paths = await workflowPublishCanonicalPaths({ runId: "v2", prevVersion: "v1", publishedAt: TS, reader: readFixtureView });

    expect(paths).toContain("");
    expect(paths).toContain("/pulse");
    expect(paths).toContain("/rankings");
    expect(paths).toContain("/rankings/2026");
    expect(paths).toContain("/rankings/2026/6");
    expect(paths).toContain("/rankings/2026/W26");
    expect(paths).toContain("/alpha/one");
    expect(paths).toContain("/beta/two");
    expect(paths).toContain("/o/alpha");
  });
});

async function readFixtureView<T>(version: string, rel: string, schema: ZodType<T>): Promise<T | null> {
  const value = views.get(`views/${version}/${rel}`);
  return value == null ? null : schema.parse(value);
}

function repoEntity(id: number, fullName: string, stars: number) {
  const [owner, name] = fullName.split("/");
  return {
    id,
    full_name: fullName,
    owner,
    owner_type: owner === "alpha" ? "Organization" : "User",
    name,
    description: null,
    language: null,
    topics: [],
    created_at: "2020-01-01",
    current_stars: stars,
    is_archived: false,
    milestones: { crossed_10k: null, crossed_50k: null, crossed_100k: null },
    curve: { monthly: [["2026-06", 10, stars]], recent_daily: [] },
    monthly_table: [{ month: "2026-06", adds: 10, rank: 1 }],
    rank_history: { month: [["2026-06", 1]] },
  };
}

function orgEntity(login: string, stars: number) {
  return {
    login,
    owner_type: "Organization",
    current_stars_sum: stars,
    repo_count: 1,
    members: [1],
    curve: { monthly: [["2026-06", 10, stars]], recent_daily: [] },
    rank_history: { month: [["2026-06", 1]] },
  };
}
