import { describe, expect, mock, test } from "bun:test";
import { runWithCloudflareWorkersHostForTests } from "@/lib/runtime-config";
import { CANONICAL_SHARD_READ_CONCURRENCY_CF } from "@/lib/workflows/canonical-validation";

let inflight = 0;
let maxInflight = 0;

mock.module("@/lib/data/source", () => ({
  readAuthoritativeView: async (path: string) => {
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

const { loadCanonicalModel } = await import("./io");

describe("loadCanonicalModel CF budget", () => {
  test("does not fan out all 128 canonical shards at once on the CF host", async () => {
    inflight = 0;
    maxInflight = 0;
    const loaded = await runWithCloudflareWorkersHostForTests(true, () => loadCanonicalModel("refresh-cf-recompute"));
    expect(loaded.seamDate).toBe("2026-05-30");
    expect(maxInflight).toBeGreaterThan(0);
    expect(maxInflight).toBeLessThanOrEqual(CANONICAL_SHARD_READ_CONCURRENCY_CF);
  });
});
