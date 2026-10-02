import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  CanonicalLifecycleMigrationBundle,
  CanonicalLifecycleMigrationPlan,
} from "@/lib/migrations/canonical-lifecycle";
import {
  canonicalLifecycleDryRunSummary,
  canonicalLifecycleUsage,
  canonicalPhysicalPaths,
  mapLimit,
  parseCanonicalLifecycleArgs,
  prepareCanonicalLifecycleRun,
  writeCanonicalLifecyclePlanFile,
} from "../../scripts/lib/migrate-canonical-lifecycle-cli";

const sha = "a".repeat(64);
const other = "b".repeat(64);
const inventory = "/tmp/issue-326-inventory.json";

function bundle(generation: string | null): CanonicalLifecycleMigrationBundle {
  return {
    planSha256: sha,
    plan: {
      source: {
        bootstrap_generation: generation,
        views_pointer: { run_id: "run-9" },
        history: [{}, {}],
      },
      counts: { canonical_repositories: 3 },
      buckets: [
        { tracked_since_recoveries: [{ tracked_since: "2020-01-01" }, { tracked_since: "2020-01-02" }] },
        { tracked_since_recoveries: [{ tracked_since: "2020-01-01" }] },
      ],
    },
  } as CanonicalLifecycleMigrationBundle;
}

describe("migrate-canonical-lifecycle arguments", () => {
  test("help wins before an invalid store flag", () => {
    expect(prepareCanonicalLifecycleRun(["--store", "nope", "--help"], inventory)).toEqual({ kind: "help" });
    expect(prepareCanonicalLifecycleRun(["-h"], inventory)).toEqual({ kind: "help" });
    expect(canonicalLifecycleUsage()).toContain("--rollback <plan-sha256>");
    expect(parseCanonicalLifecycleArgs(["--full", "--help"], inventory)).toEqual({ kind: "help" });
  });

  test("defaults to a dry-run and refuses execute or rollback without a matching SHA", () => {
    const ready = prepareCanonicalLifecycleRun(["--store", "r2", "--target", "pre", "--full"], inventory);
    expect(ready).toMatchObject({
      kind: "ready",
      selection: { store: "r2", target: "pre" },
      args: { execute: false, dry: false, full: true, confirm: null, inventoryPath: inventory },
    });
    expect(() => prepareCanonicalLifecycleRun(["--store", "r2"], inventory)).toThrow("--store r2 requires --target");
    expect(() => parseCanonicalLifecycleArgs(["--execute"], inventory)).toThrow("--execute requires --confirm");
    expect(() => parseCanonicalLifecycleArgs(["--confirm", "ABC"], inventory)).toThrow(
      "--confirm must be a lowercase SHA-256",
    );
    expect(() => parseCanonicalLifecycleArgs(["--confirm"], inventory)).toThrow("--confirm must be a lowercase SHA-256");
    expect(() => parseCanonicalLifecycleArgs(["--rollback", sha], inventory)).toThrow("--rollback requires --execute");
    expect(() => parseCanonicalLifecycleArgs(["--execute", "--confirm", sha, "--rollback", other], inventory)).toThrow(
      "--rollback and --confirm must name the same plan SHA-256",
    );
    expect(() => parseCanonicalLifecycleArgs(["--nope"], inventory)).toThrow("unknown argument --nope");
  });

  test("dry-run forces execute off after the rollback checks pass", () => {
    const parsed = parseCanonicalLifecycleArgs(
      ["--execute", "--dry-run", `--confirm=${sha}`, `--rollback=${sha}`, "--inventory", "rel.json", "--plan-out", "out.json"],
      inventory,
    );
    expect(parsed).toMatchObject({
      kind: "run",
      args: {
        execute: false,
        dry: true,
        confirm: sha,
        rollback: sha,
        full: false,
        inventoryPath: resolve("rel.json"),
        planOut: resolve("out.json"),
      },
    });
  });
});

describe("migrate-canonical-lifecycle plan helpers", () => {
  test("summarizes a dry-run with zero production writes", () => {
    const summary = canonicalLifecycleDryRunSummary(bundle("gen-9"));
    expect(summary).toMatchObject({
      mode: "dry-run",
      production_writes: 0,
      plan_sha256: sha,
      source: { layout: "gen-9", published_run_id: "run-9", whitelist_history_snapshots: 2 },
      counts: { canonical_repositories: 3 },
      tracked_since_recovered_by_date: { "2020-01-01": 2, "2020-01-02": 1 },
      execute_requires: `--execute --confirm ${sha}`,
    });
    expect(canonicalLifecycleDryRunSummary(bundle(null)).source.layout).toBe("legacy-flat");
  });

  test("refuses to overwrite an unequal plan file and keeps an equal one", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifecycle-plan-"));
    const path = join(dir, "plan.json");
    const planned = bundle("gen-9");
    try {
      writeCanonicalLifecyclePlanFile(path, planned);
      const content = readFileSync(path, "utf8");
      expect(content.endsWith("\n")).toBe(true);
      expect(JSON.parse(content)).toEqual({ plan_sha256: sha, plan: planned.plan });
      writeCanonicalLifecyclePlanFile(path, planned);
      expect(readFileSync(path, "utf8")).toBe(content);
      writeFileSync(path, "{}\n");
      expect(() => writeCanonicalLifecyclePlanFile(path, planned)).toThrow(
        `refusing to overwrite unequal plan file ${path}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("maps a logical path onto overlay and generation copies", async () => {
    const logical = "canonical/v2/repos/0.json";
    await expect(canonicalPhysicalPaths(logical, { source: { bootstrap_generation: null } } as CanonicalLifecycleMigrationPlan)).resolves.toEqual([
      logical,
    ]);
    await expect(
      canonicalPhysicalPaths(logical, { source: { bootstrap_generation: "gen-9" } } as CanonicalLifecycleMigrationPlan),
    ).resolves.toEqual([
      `bootstrap/overlays/gen-9/${logical}`,
      `bootstrap/generations/gen-9/${logical}`,
    ]);
  });

  test("mapLimit keeps order and the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((done) => setTimeout(done, 15));
      active -= 1;
      return value * 10;
    });
    expect(result).toEqual([10, 20, 30, 40]);
    expect(peak).toBe(2);
    await expect(mapLimit([], 6, async () => 1)).resolves.toEqual([]);
  });
});
