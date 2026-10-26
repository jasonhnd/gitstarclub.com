/** Issue #787. Offline only: verify the builder's two local phases, recompute in
 * memory, and compare against its sealed, byte-for-byte frozen base snapshot.
 * Run with Bun --no-env-file; see docs/analysis/PRODUCTION-REPAIR-BUILDER.md.
 * No storage adapters, workflow handlers, environment reads, or network I/O.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ZodType } from "zod";
import { assertBootstrapGeneration, bootstrapGenerationPrefix, verifyBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";
import { CanonicalMeta, RepoMonthlyShard, RepoRecentDailyShard, ReposShard, RepoWeeklyShard, SiteDaily } from "../lib/contracts";
import { buildModel, computeAllViews, type RawShards } from "../lib/workflows/recompute";
import type { RankView } from "../lib/workflows/recompute/ranks";

export type CompareOptions = { built: string; generation: string; out: string };
export type Difference = {
  file: string;
  pointer: string;
  kind: "changed" | "missing_frozen" | "missing_recomputed";
  frozen?: unknown;
  recomputed?: unknown;
};
type Family = "monthly_repo_ranks" | "organization_monthly_curves" | "month_heatmaps";
const familyOf = (file: string): Family | undefined => {
  if (/^rank\/month\/\d{4}-\d{2}\/repo\/[^/]+\.json$/.test(file)) return "monthly_repo_ranks";
  if (/^entity\/org\/[^/]+\.json$/.test(file)) return "organization_monthly_curves";
  if (/^heatmap\/month\/\d{4}-\d{2}\.json$/.test(file)) return "month_heatmaps";
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseCompareArgs(argv: string[]): CompareOptions {
  const flags: Record<string, keyof CompareOptions> = { "--built": "built", "--generation": "generation", "--out": "out" };
  const options: Partial<CompareOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = flags[argv[i]];
    assert(key && !options[key], `Unknown or duplicate argument: ${argv[i]}`);
    const value = argv[++i];
    assert(value && !value.startsWith("--") && !value.includes("://"), `Expected local value for ${argv[i - 1]}`);
    options[key] = value;
  }
  assert(Object.values(flags).every((key) => options[key]), "Required: --built DIRECTORY --generation BOOTSTRAP_ID --out NEW_REPORT_JSON");
  assertBootstrapGeneration(options.generation);
  return options as CompareOptions;
}

/** Compare only monthly organization points; aggregate recent days intentionally differ.
 * Rank and heatmap content is exact except for their top-level generation timestamp.
 */
function comparisonValue(file: string, value: unknown): unknown {
  assert(object(value), `Expected JSON object: ${file}`);
  if (file.startsWith("entity/org/")) {
    assert(object(value.curve) && Array.isArray(value.curve.monthly), `Missing monthly organization curve: ${file}`);
    return { curve: { monthly: value.curve.monthly } };
  }
  assert(object(value.meta), `Missing metadata: ${file}`);
  const meta = { ...value.meta };
  delete meta.generated_at;
  return { ...value, meta };
}

/** Exact, exhaustive JSON differences. Unequal array lengths still compare every
 * shared index and retain every added/removed point. No rounding tolerance/cap.
 */
function diff(file: string, frozen: unknown, recomputed: unknown, pointer: string, out: Difference[]): void {
  if (frozen === recomputed) return;
  const arrays = Array.isArray(frozen) && Array.isArray(recomputed);
  if (arrays || (object(frozen) && object(recomputed))) {
    const left = frozen as Record<string, unknown>, right = recomputed as Record<string, unknown>;
    const keys = arrays
      ? Array.from({ length: Math.max((frozen as unknown[]).length, (recomputed as unknown[]).length) }, (_, i) => String(i))
      : [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const next = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (!Object.hasOwn(left, key)) out.push({ file, pointer: next, kind: "missing_frozen", recomputed: right[key] });
      else if (!Object.hasOwn(right, key)) out.push({ file, pointer: next, kind: "missing_recomputed", frozen: left[key] });
      else diff(file, left[key], right[key], next, out);
    }
    return;
  }
  out.push({ file, pointer, kind: "changed", frozen, recomputed });
}

function compareFile(file: string, frozen: Map<string, unknown>, recomputed: Map<string, unknown>): Difference[] {
  if (!frozen.has(file)) return [{ file, pointer: "", kind: "missing_frozen", recomputed: comparisonValue(file, recomputed.get(file)) }];
  if (!recomputed.has(file)) return [{ file, pointer: "", kind: "missing_recomputed", frozen: comparisonValue(file, frozen.get(file)) }];
  const differences: Difference[] = [];
  diff(file, comparisonValue(file, frozen.get(file)), comparisonValue(file, recomputed.get(file)), "", differences);
  return differences;
}

export function compareRepairViews(frozen: Map<string, unknown>, recomputed: Map<string, unknown>) {
  const monthly = Object.fromEntries((["monthly_repo_ranks", "organization_monthly_curves", "month_heatmaps"] as const).map((family) => {
    const files = [...new Set([...frozen.keys(), ...recomputed.keys()])].filter((file) => familyOf(file) === family).sort();
    const differences = files.flatMap((file) => compareFile(file, frozen, recomputed));
    const changedFiles = new Set(differences.map((difference) => difference.file));
    return [family, { files: files.length, matched_files: files.length - changedFiles.size, differences }];
  })) as Record<Family, { files: number; matched_files: number; differences: Difference[] }>;
  // A completely absent family must not produce a vacuous pass.
  const emptyFamilies = Object.entries(monthly).filter(([, result]) => result.files === 0).map(([family]) => family);
  const weekly = Array.from({ length: 17 }, (_, index) => `2026-W${23 + index}`).flatMap((week) =>
    (["repo", "org"] as const).flatMap((dim) => (["flow", "stock"] as const).map((metric) => {
      const file = `rank/week/${week}/${dim}/${metric}.json`;
      const view = recomputed.get(file) as RankView | undefined;
      const measurement = !view ? "missing" : view.items.length === 0 ? "empty" : metric === "stock" ? "stock"
        : view.meta.provenance?.metric === "surviving_stars_at_query_time"
          ? view.meta.provenance_scope === "mixed" ? "mixed" : "survivor_sum" : "existing_history";
      return { file, week, dim, metric, measurement, frozen_present: frozen.has(file), recomputed_present: !!view,
        recomputed_items: view?.items.length ?? 0,
        provenance: view?.meta.provenance ?? null, provenance_scope: view?.meta.provenance_scope ?? null,
        differences: !frozen.has(file) && !view ? [] : compareFile(file, frozen, recomputed) };
    })),
  );
  const monthlyDifferenceCount = Object.values(monthly).reduce((sum, family) => sum + family.differences.length, 0);
  return {
    monthly_matches_frozen: monthlyDifferenceCount === 0 && emptyFamilies.length === 0,
    monthly_difference_count: monthlyDifferenceCount, empty_monthly_families: emptyFamilies, monthly,
    weekly: { informational_only: true, files: weekly,
      survivor_sum_files: weekly.filter((item) => item.measurement === "survivor_sum").map((item) => item.file),
      mixed_files: weekly.filter((item) => item.measurement === "mixed").map((item) => item.file),
      missing_files: weekly.filter((item) => item.measurement === "missing").map((item) => item.file) },
  };
}

/** Local reader confined to the input tree; neither symlinks nor remote paths are inputs. */
function localReader(root: string) {
  return (logical: string): Buffer | null => {
    const parts = logical.split("/");
    assert(parts.every((part) => part && part !== "." && part !== ".." && !part.includes("\\")), `Invalid local input path: ${logical}`);
    let path = root;
    for (const part of parts) {
      path = join(path, part);
      if (!existsSync(path)) return null;
      assert(!lstatSync(path).isSymbolicLink(), `Symlink input refused: ${path}`);
    }
    assert(lstatSync(path).isFile(), `Expected regular input: ${path}`);
    return readFileSync(path);
  };
}

export async function compareProductionRepair(options: CompareOptions) {
  assertBootstrapGeneration(options.generation);
  assert(!options.built.includes("://") && !options.out.includes("://"), "Only local paths are supported");
  assert(!lstatSync(options.built).isSymbolicLink(), "Symlink input root refused");
  const root = realpathSync(options.built);
  const out = join(realpathSync(dirname(resolve(options.out))), resolve(options.out).split(sep).at(-1)!);
  const outputRelative = relative(root, out);
  assert(outputRelative.startsWith(`..${sep}`), "Report must be outside the built input tree");
  assert(!existsSync(out), `Report already exists: ${out}`);
  const read = localReader(root);
  // This store exposes only read. Verification hashes every object in both phases.
  const verified = await verifyBootstrapGeneration({ generation: options.generation, store: { read: async (path: string) => read(path) } });
  const prefix = bootstrapGenerationPrefix(options.generation);
  const inputHashes = new Map<string, string>();
  for (const phase of [verified.base, verified.canonical]) {
    for (const item of phase.manifest.objects as Array<{ path: string; sha256: string }>) inputHashes.set(item.path, item.sha256);
  }
  const json = (path: string): unknown => {
    assert(inputHashes.has(path), `Required input absent from sealed inventory: ${path}`);
    const body = read(`${prefix}/${path}`);
    assert(body, `Missing local input: ${path}`);
    // Recheck consumed bytes to avoid comparing a file changed after verification.
    assert(createHash("sha256").update(body).digest("hex") === inputHashes.get(path), `Input changed after verification: ${path}`);
    return JSON.parse(body.toString("utf8"));
  };
  const meta = CanonicalMeta.parse(json("canonical/v2/meta.json"));
  const merge = <T>(family: string, schema: ZodType<Record<string, T>>): Record<string, T> => {
    const all: Record<string, T> = {};
    for (let bucket = 0; bucket < 32; bucket++) {
      for (const [id, row] of Object.entries(schema.parse(json(`canonical/v2/${family}/${bucket}.json`)))) {
        assert(/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) % 32 === bucket && !Object.hasOwn(all, id), `Invalid/duplicate bucket membership: ${family}/${bucket}/${id}`);
        all[id] = row;
      }
    }
    return all;
  };
  const raw: RawShards = {
    repos: merge("repos", ReposShard) as RawShards["repos"], monthly: merge("repo-monthly", RepoMonthlyShard),
    weekly: merge("repo-weekly", RepoWeeklyShard), recentDaily: merge("repo-recent-daily", RepoRecentDailyShard), siteDailyByYear: {},
  };
  assert(Object.keys(raw.repos).length > 0, "Built canonical has no repositories");
  for (const [id, repo] of Object.entries(raw.repos)) assert(repo.id === Number(id), `Repository identity mismatch: ${id}`);
  for (const series of [raw.monthly, raw.weekly, raw.recentDaily]) {
    for (const [id, rows] of Object.entries(series)) {
      assert(raw.repos[id], `Orphan series repository: ${id}`);
      assert(rows.every(([period], index) => index === 0 || period > rows[index - 1][0]), `Unordered/duplicate series periods: ${id}`);
    }
  }
  for (const path of inputHashes.keys()) {
    if (!/^canonical\/v2\/site-daily\/\d{4}\.json$/.test(path)) continue;
    const site = SiteDaily.parse(json(path));
    assert(path === `canonical/v2/site-daily/${site.year}.json`, `Site daily year mismatch: ${path}`);
    assert(site.cells.every(([day], index) => day.startsWith(`${site.year}-`) && (index === 0 || day > site.cells[index - 1][0])), `Unordered/duplicate site daily cells: ${path}`);
    raw.siteDailyByYear[site.year] = site;
  }
  const frozen = new Map<string, unknown>();
  for (const path of inputHashes.keys()) {
    if (!path.startsWith("views/")) continue;
    const file = path.slice("views/".length);
    if (familyOf(file) || /^rank\/week\/2026-W(2[3-9]|3\d)\/(repo|org)\/(flow|stock)\.json$/.test(file)) frozen.set(file, json(path));
  }
  const { views, stats } = computeAllViews(buildModel(raw, meta.seam_date), {
    gen: meta.generated_at ?? "1970-01-01T00:00:00.000Z", seamDate: meta.seam_date, foldedThrough: meta.folded_through,
  });
  const report = {
    version: 1, generation: options.generation, built: root,
    frozen_source: `${prefix}/views`, phase_manifest_sha256: { base: verified.base.sha256, canonical: verified.canonical.sha256 },
    comparison_policy: { numeric_tolerance: 0, ignored_fields: ["rank.meta.generated_at", "heatmap.meta.generated_at"], organization_fields: ["curve.monthly"], dropped_ids: "not_filtered_or_excused" },
    recompute: { ...stats, views: views.size }, ...compareRepairViews(frozen, views),
  };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  return report;
}

if (import.meta.main) {
  try {
    const report = await compareProductionRepair(parseCompareArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ generation: report.generation, monthly_matches_frozen: report.monthly_matches_frozen,
      monthly_difference_count: report.monthly_difference_count, survivor_sum_files: report.weekly.survivor_sum_files,
      mixed_files: report.weekly.mixed_files, missing_weekly_files: report.weekly.missing_files }));
    process.exitCode = report.monthly_matches_frozen ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
