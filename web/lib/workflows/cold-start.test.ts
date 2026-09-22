import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let meta: unknown = null;
let viewsLatest: unknown = null;
let lookup: unknown = null;
const writes: Array<{ path: string; value: unknown }> = [];

async function mockRead(path: string, schema: { parse: (input: unknown) => unknown }) {
  if (path === "canonical/v2/meta.json") return meta == null ? null : schema.parse(meta);
  if (path === "views/latest.json") return viewsLatest == null ? null : schema.parse(viewsLatest);
  if (path === "lookup/repos.json") return lookup == null ? null : schema.parse(lookup);
  return null;
}

mock.module("@/lib/data/source", () => ({
  readAuthoritativeView: mockRead,
  readRequiredView: async (path: string, schema: { parse: (input: unknown) => unknown }) => {
    const value = await mockRead(path, schema);
    if (value === null) throw new Error(`${path} missing`);
    return value;
  },
}));

mock.module("@/lib/workflows/owned-write", () => ({
  putOwnedView: async (_owner: unknown, path: string, value: unknown) => {
    writes.push({ path, value });
    if (path === "canonical/v2/meta.json") meta = value;
  },
}));

beforeEach(() => {
  meta = null;
  viewsLatest = null;
  lookup = null;
  writes.length = 0;
  delete process.env.WORKFLOW_COLD_START;
  delete process.env.VERCEL_ENV;
});

const {
  buildColdStartCanonicalMeta,
  ensureColdStartCanonicalMeta,
  isUniverseColdStartActive,
  readRefreshStartPreflight,
  readColdStartLookupOrEmpty,
} = await import("./cold-start");

describe("workflow cold-start (#519)", () => {
  test("is inactive unless preview flag is on and views are unpublished", async () => {
    delete process.env.WORKFLOW_COLD_START;
    expect(await isUniverseColdStartActive()).toBe(false);
    process.env.WORKFLOW_COLD_START = "1";
    expect(await isUniverseColdStartActive()).toBe(true);
    viewsLatest = {
      version: "v1",
      run_id: "published",
      published_at: "2026-09-01T00:00:00.000Z",
      prev_version: null,
      schema_ver: 1,
    };
    expect(await isUniverseColdStartActive()).toBe(false);
  });

  test("buildColdStartCanonicalMeta uses the bootstrap day as seam and prior fold watermarks", () => {
    const metaValue = buildColdStartCanonicalMeta(new Date("2026-09-22T12:00:00.000Z"));
    expect(metaValue.seam_date).toBe("2026-09-22");
    expect(metaValue.schema_ver).toBe(2);
    expect(metaValue.folded_through).toEqual({ month: "2026-08", week: "2026-W36" });
    expect(metaValue.generated_at).toBe("2026-09-22T12:00:00.000Z");
  });

  test("route preflight allows enqueue when meta is absent", async () => {
    process.env.WORKFLOW_COLD_START = "1";
    const result = await readRefreshStartPreflight("refresh-cold");
    const planned = buildColdStartCanonicalMeta(new Date(result.generated_at ?? Date.now()));
    expect(result.seam_date).toBe(planned.seam_date);
    expect(result.schema_ver).toBe(2);
    expect(result.folded_through).toEqual(planned.folded_through);
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("ensureColdStartCanonicalMeta writes meta once under lease", async () => {
    process.env.WORKFLOW_COLD_START = "1";
    const owner = { runId: "refresh-cold", fencingToken: 9 };
    expect(await ensureColdStartCanonicalMeta(owner, new Date("2026-09-22T12:00:00.000Z"))).toBe(true);
    expect(writes).toHaveLength(1);
    expect(await ensureColdStartCanonicalMeta(owner)).toBe(false);
    expect(writes).toHaveLength(1);
  });

  test("readColdStartLookupOrEmpty returns {} instead of throwing", async () => {
    process.env.WORKFLOW_COLD_START = "1";
    await expect(readColdStartLookupOrEmpty("refresh-cold")).resolves.toEqual({});
  });
});
