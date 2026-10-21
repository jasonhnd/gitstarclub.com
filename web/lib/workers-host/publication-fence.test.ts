import { describe, expect, test } from "bun:test";
import { publicationFromBucket, readPublication } from "./publication-fence";
import type { R2Bucket } from "../storage/r2-binding-store";

describe("authoritative publication fence", () => {
  test("negative pointers are a stable identity but transport/schema errors never become absence", async () => {
    const a = await readPublication(async () => null);
    expect((await readPublication(async () => null)).id).toBe(a.id);
    expect(a.views).toBeNull();
    await expect(readPublication(async () => { throw new Error("R2 unavailable"); })).rejects.toThrow("R2 unavailable");
    await expect(readPublication(async () => ({ body: "{}", etag: "x" }))).rejects.toThrow();
    await expect(readPublication(async () => ({ body: "x".repeat(32769), etag: "x" }))).rejects.toThrow("envelope");
  });
  test("strong binding reads include each pointer's ETag and new rollback timestamp", async () => {
    let etag = "etag1";
    let published = "2026-10-01T00:00:00Z";
    const paths: string[] = [];
    const bucket = { get: async (path: string) => {
      paths.push(path);
      if (path !== "views/latest.json") return null;
      const body = JSON.stringify({ version: "original", run_id: "run", published_at: published, prev_version: null, schema_ver: 2 });
      return { size: body.length, etag, text: async () => body };
    } } as unknown as R2Bucket;
    const original = await publicationFromBucket(bucket);
    etag = "etag2";
    expect((await publicationFromBucket(bucket)).id).not.toBe(original.id);
    published = "2026-10-03T00:00:00Z";
    const rollback = await publicationFromBucket(bucket);
    expect(rollback.views?.version).toBe(original.views?.version);
    expect(rollback.id).not.toBe(original.id);
    expect(paths).toHaveLength(9);
    expect(new Set(paths)).toEqual(new Set(["views/latest.json", "bootstrap/latest.json", "live/latest.json"]));
  });
});
