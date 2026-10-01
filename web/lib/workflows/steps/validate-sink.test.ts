import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as source from "@/lib/data/source";
import * as write from "@/lib/data/write";
import * as canonical from "@/lib/workflows/canonical-validation";
import { validateVersion } from "./validate";

describe("validateVersion stored diagnostics", () => {
  let readView: ReturnType<typeof spyOn>;
  let writeView: ReturnType<typeof spyOn>;
  let validateCanonical: ReturnType<typeof spyOn>;
  const writes: Array<{ path: string; data: unknown }> = [];

  afterEach(() => {
    readView?.mockRestore();
    writeView?.mockRestore();
    validateCanonical?.mockRestore();
    writes.length = 0;
  });

  test("validation.json omits secret canaries and keeps the failure category", async () => {
    const canary = "ghp_CANARYMISSEDSINK1234567890abcd";
    readView = spyOn(source, "readAuthoritativeView").mockImplementation(async (path: string) => {
      if (path.includes("views/")) throw new Error(`schema exploded GitHub GraphQL 502 ${canary}`);
      return null;
    });
    validateCanonical = spyOn(canonical, "validateCanonicalGeneration").mockResolvedValue({
      manifest: {
        run_id: "refresh-test",
        generated_at: "2026-07-17T00:00:00.000Z",
        expected_shards: 0,
        validated_shards: 0,
        total_records: 0,
        complete: false,
        shards: [],
      },
      checked: 0,
      schemaFailures: 1,
      invariants: {},
      failures: [`canonical shard GitHub GraphQL 502 ${canary}`],
      placeholders: [],
      repoIds: new Set<string>(),
      activeRepoIds: new Set<string>(),
      acc: {
        repoRecords: 0,
        monthlyRecords: 0,
        weeklyRecords: 0,
        recentDailyRecords: 0,
        validatedShards: 0,
        schemaFailures: 1,
        placeholderShards: 0,
      },
    } as never);
    writeView = spyOn(write, "putView").mockImplementation(async (path: string, data: unknown) => {
      writes.push({ path, data });
    });

    await expect(validateVersion("refresh-test")).rejects.toThrow(/validation failed/);
    const stored = writes.find((item) => item.path === "ops/workflows/refresh-test/validation.json");
    const text = JSON.stringify(stored);
    expect(text).toContain("GitHub GraphQL 502");
    expect(text).not.toContain("CANARY");
  });
});
