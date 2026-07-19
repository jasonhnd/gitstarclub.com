import { describe, expect, mock, test } from "bun:test";

let value: unknown = null;
let reads: Array<{ path: string; bust?: string }> = [];

mock.module("@/lib/data/source", () => ({
  readView: async (path: string, schema: { parse: (input: unknown) => unknown }, opts: { bust?: string } = {}) => {
    reads.push({ path, bust: opts.bust });
    return value == null ? null : schema.parse(value);
  },
}));

const { preflightCanonical } = await import("./preflight");
const { readCanonicalPreflight } = await import("../canonical-preflight");

describe("preflightCanonical", () => {
  test("route preflight uses a cache key distinct from the workflow step", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    reads = [];

    await readCanonicalPreflight("refresh-test");
    await preflightCanonical("refresh-test");

    expect(reads.map(({ bust }) => bust)).toEqual([
      "refresh-test-route-preflight",
      "refresh-test-workflow-preflight",
    ]);
  });

  test("accepts the current production metadata shape before mutation steps", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    reads = [];

    await expect(preflightCanonical("refresh-test")).resolves.toEqual({
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    });
    expect(reads).toEqual([{ path: "canonical/v2/meta.json", bust: "refresh-test-workflow-preflight" }]);
  });

  test("accepts a legacy object while reporting its missing watermark", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
    };

    await expect(preflightCanonical("refresh-legacy")).resolves.toMatchObject({ generated_at: null });
  });

  test("fails closed when metadata is missing or incompatible", async () => {
    value = null;
    await expect(preflightCanonical("refresh-missing")).rejects.toThrow("canonical/v2/meta.json missing");

    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    await expect(preflightCanonical("refresh-invalid")).rejects.toThrow();
  });
});
