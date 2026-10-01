import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOTSTRAP_CANONICAL_OK,
  bootstrapCanonicalFailureLines,
  canonicalDirectoryError,
  canonicalLogicalRelative,
  inspectLocalBootstrapCanonical,
  siteDailyShardNames,
} from "../../scripts/lib/validate-bootstrap-canonical";

const meta = {
  seam_date: "2024-01-01",
  schema_ver: 1,
  folded_through: { month: "2024-01", week: "2024-W01" },
};
const siteDaily = { year: "2026", cells: [["2026-01-01", 3]] };

describe("validate-bootstrap-canonical", () => {
  test("maps logical paths and yearly shard names", () => {
    expect(canonicalLogicalRelative("canonical/v2/repos/0.json")).toBe("repos/0.json");
    expect(canonicalLogicalRelative("repos/0.json")).toBe("repos/0.json");
    expect(siteDailyShardNames(["notes.txt", "2026.json", "26.json", "2020.json"])).toEqual([
      "2020.json",
      "2026.json",
    ]);
    expect(bootstrapCanonicalFailureLines(Array.from({ length: 31 }, (_, index) => `f${index}`))).toHaveLength(30);
    expect(bootstrapCanonicalFailureLines(["only"])).toEqual(["  only"]);
    expect(BOOTSTRAP_CANONICAL_OK).toContain("validated");
  });

  test("refuses a missing directory and reports meta, site-daily, and shard gaps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bootstrap-canonical-"));
    const file = join(dir, "not-dir");
    writeFileSync(file, "{}\n");
    const previousRelax = process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
    const previousDeploy = process.env.DEPLOY_ENV;
    delete process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
    delete process.env.DEPLOY_ENV;
    try {
      expect(canonicalDirectoryError(join(dir, "missing"))).toBe(
        `canonical directory not found: ${join(dir, "missing")}`,
      );
      expect(canonicalDirectoryError(file)).toContain("canonical directory not found");
      const empty = await inspectLocalBootstrapCanonical(dir);
      expect(empty.exitCode).toBe(1);
      expect(empty.failures.some((failure) => failure.startsWith("canonical/v2/meta.json:"))).toBe(true);
      expect(empty.failures).toContain("canonical/v2/site-daily: no yearly shard found");
      expect(empty.failures).toContain("canonical/v2/repos/0.json: missing");
      expect(empty.summary).toContain("site_daily=0");
      expect(empty.summary).toContain(`failures=${empty.failures.length}`);
    } finally {
      if (previousRelax === undefined) delete process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
      else process.env.PREFLIGHT_RELAX_EMPTY_SHARDS = previousRelax;
      if (previousDeploy === undefined) delete process.env.DEPLOY_ENV;
      else process.env.DEPLOY_ENV = previousDeploy;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts meta and a yearly shard, and still names a bad shard file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bootstrap-canonical-"));
    mkdirSync(join(dir, "site-daily"));
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta)}\n`);
    writeFileSync(join(dir, "site-daily", "2026.json"), `${JSON.stringify(siteDaily)}\n`);
    writeFileSync(join(dir, "site-daily", "notes.txt"), "ignore\n");
    writeFileSync(join(dir, "site-daily", "2024.json"), "{");
    const previousRelax = process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
    delete process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
    try {
      const report = await inspectLocalBootstrapCanonical(dir);
      expect(report.summary).toContain("site_daily=2");
      expect(report.failures.some((failure) => failure.startsWith("canonical/v2/meta.json:"))).toBe(false);
      expect(report.failures.some((failure) => failure.startsWith("canonical/v2/site-daily/2026.json:"))).toBe(false);
      expect(report.failures.some((failure) => failure.startsWith("canonical/v2/site-daily/2024.json:"))).toBe(true);
      expect(report.failures).not.toContain("canonical/v2/site-daily: no yearly shard found");
      expect(report.exitCode).toBe(1);
    } finally {
      if (previousRelax === undefined) delete process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
      else process.env.PREFLIGHT_RELAX_EMPTY_SHARDS = previousRelax;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
