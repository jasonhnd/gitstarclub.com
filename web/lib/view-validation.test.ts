import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { contractForViewPath, validateViewDirectory } from "./view-validation";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gsc-view-validation-"));
  roots.push(root);
  return root;
}

function writeJson(root: string, rel: string, value: unknown): void {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

describe("contractForViewPath", () => {
  test("routes every generated view family and live/version prefixes", () => {
    const paths = [
      "meta.json",
      "hot-snapshot.json",
      "current_month.json",
      "current_month/shards/0.json",
      "lookup/repos.json",
      "lookup/orgs.json",
      "lookup/aliases.json",
      "lookup/categories.json",
      "categories/registry.json",
      "categories/assignments.json",
      "categories/assignments/shards/0.json",
      "search/index.json",
      "rank/month/2026-07/repo/flow.json",
      "rank/category/language/typescript/all-time/repo/stock.json",
      "entity/repo/1.json",
      "entity/org/example.json",
      "heatmap/year/2026.json",
      "live/rank/week/2026-W29/repo/flow.json",
      "live/generations/daily-run/rank/week/2026-W29/repo/flow.json",
      "views/refresh-1/search/index.json",
    ];
    for (const path of paths) expect(contractForViewPath(path), path).not.toBeNull();
    expect(contractForViewPath("future/new-view.json")).toBeNull();
  });
});

describe("validateViewDirectory", () => {
  test("validates known files and reports exact counts", () => {
    const root = fixtureRoot();
    writeJson(root, "meta.json", { seam_date: "2026-05-30", schema_ver: 1 });
    writeJson(root, "lookup/repos.json", {});

    const result = validateViewDirectory(root);
    expect(result).toMatchObject({ discovered: 2, validated: 2, allowlisted: 0, skipped: 0, failed: 0 });
    expect(Object.fromEntries(result.byKind)).toEqual({ "lookup/repos": 1, meta: 1 });
  });

  test("fails unknown, malformed, and schema-invalid JSON independently", () => {
    const root = fixtureRoot();
    writeJson(root, "future/new-view.json", { ok: true });
    const malformed = join(root, "meta.json");
    writeFileSync(malformed, "{not-json");
    writeJson(root, "lookup/repos.json", { "1": { full_name: "missing-required-fields" } });

    const result = validateViewDirectory(root);
    expect(result).toMatchObject({ discovered: 3, validated: 0, allowlisted: 0, skipped: 0, failed: 3 });
    expect(result.failures.map((failure) => failure.path)).toEqual([
      "future/new-view.json",
      "lookup/repos.json",
      "meta.json",
    ]);
  });

  test("requires an explicit reasoned allowlist for non-view JSON", () => {
    const root = fixtureRoot();
    writeJson(root, "reports/summary.json", { informational: true });

    const result = validateViewDirectory(root, {
      allowlist: [{ pattern: /^reports\/summary\.json$/, reason: "operator-only summary, not a served view" }],
    });
    expect(result).toMatchObject({ discovered: 1, validated: 0, allowlisted: 1, skipped: 0, failed: 0 });
    expect(result.allowlistedFiles).toEqual([
      { path: "reports/summary.json", reason: "operator-only summary, not a served view" },
    ]);
  });
});
