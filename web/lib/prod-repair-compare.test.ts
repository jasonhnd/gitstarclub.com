import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildBootstrapPhaseManifest, bootstrapGenerationPrefix } from "../../pipeline/lib/bootstrap-publication.mjs";
import { compareProductionRepair, compareRepairViews, parseCompareArgs } from "../scripts/prod-repair-compare";
import { AGGREGATE_HISTORY_PROVENANCE as provenance } from "./contracts/star-history";
import { buildModel, computeAllViews, type RawShards } from "./workflows/recompute";
import type { RankView } from "./workflows/recompute/ranks";

const GEN = "bootstrap-repair-compare-fixture";
const NOW = "2026-09-13T06:00:16.398Z";
const META = { seam_date: "2026-05-30", schema_ver: 1, generated_at: NOW, folded_through: { month: "2026-08", week: "2026-W35" } };
const PREFIX = bootstrapGenerationPrefix(GEN);
const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const write = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, encode(value)); };
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const recompute = (raw: RawShards, gen = NOW) => computeAllViews(buildModel(raw, META.seam_date), { gen, seamDate: META.seam_date, foldedThrough: META.folded_through }).views;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "repair-compare-")); scratch.push(root);
  const options = { built: join(root, "built"), generation: GEN, out: join(root, "comparison.json") };
  const raw: RawShards = {
    repos: {
      "1": { id: 1, owner: "acme", owner_type: "Organization", name: "one", full_name: "acme/one", current_stars: 19, created_at: "2020-01-01", d: 0.5 },
      "2": { id: 2, owner: "solo", owner_type: "User", name: "two", full_name: "solo/two", current_stars: 7, created_at: "2020-01-01", d: 1 },
    },
    monthly: { "1": [["2026-04", 10], ["2026-05", 10], ["2026-06", 4], ["2026-08", 5]], "2": [["2026-05", 6], ["2026-06", 1]] },
    weekly: { "1": [["2026-W22", 10], ["2026-W23", 2]], "2": [["2026-W22", 6], ["2026-W24", 1]] },
    recentDaily: { "1": [["2026-05-29", 3]], "2": [] },
    siteDailyByYear: { "2026": { year: "2026", cells: [["2026-05-29", 123], ["2026-06-01", 4]] } },
  };
  const frozen = recompute(raw, "2026-09-13T00:00:00.000Z");
  raw.repos["1"].aggregate_history = { provenance, weeks: Array.from({ length: 17 }, (_, i) => `2026-W${23 + i}`) };
  raw.weekly["1"] = [["2026-W22", 10], ...raw.repos["1"].aggregate_history.weeks.map((week) => [week, 14] as [string, number])];
  raw.recentDaily["1"] = [...raw.recentDaily["1"], ["2026-06-01", 2], ["2026-09-30", 2]];
  const seal = () => {
    const phases = {
      base: [...frozen].map(([path, value]) => ({ path: `views/${path}`, body: encode(value) })),
      canonical: [
        { path: "canonical/v2/meta.json", body: encode(META) },
        ...([["repos", raw.repos], ["repo-monthly", raw.monthly], ["repo-weekly", raw.weekly], ["repo-recent-daily", raw.recentDaily]] as const).flatMap(([family, rows]) =>
          Array.from({ length: 32 }, (_, bucket) => ({ path: `canonical/v2/${family}/${bucket}.json`, body: encode(Object.fromEntries(Object.entries(rows).filter(([id]) => Number(id) % 32 === bucket)
            .map(([id, row]) => [id, family === "repos" ? { ...row, node_id: `R_retained_${id}` } : row]))) }))),
        ...Object.values(raw.siteDailyByYear).map((site) => ({ path: `canonical/v2/site-daily/${site.year}.json`, body: encode(site) })),
      ],
    };
    for (const phase of ["base", "canonical"] as const) {
      for (const item of phases[phase]) {
        const path = join(options.built, PREFIX, item.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, item.body);
      }
      write(join(options.built, PREFIX, `manifests/${phase}.json`), buildBootstrapPhaseManifest(GEN, phase, phases[phase]));
    }
  };
  seal();
  return { root, options, raw, frozen, seal };
}

function cli(options: ReturnType<typeof fixture>["options"]) {
  return Bun.spawnSync([process.execPath, "--no-env-file", resolve(import.meta.dir, "../scripts/prod-repair-compare.ts"),
    "--built", options.built, "--generation", options.generation, "--out", options.out], {
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, stdout: "pipe", stderr: "pipe",
  });
}

const rank = (views: Map<string, unknown>, file = "rank/month/2026-05/repo/flow.json") => views.get(file) as RankView;

describe("offline production repair comparison", () => {
  test("sealed builder layout recomputes without network; monthly data is exact despite new aggregate days", async () => {
    const { options } = fixture();
    const network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    let report: Awaited<ReturnType<typeof compareProductionRepair>>;
    try { report = await compareProductionRepair(options); expect(network).not.toHaveBeenCalled(); }
    finally { network.mockRestore(); }
    expect(report.monthly_matches_frozen).toBe(true);
    expect(report.monthly_difference_count).toBe(0);
    expect(report.monthly.monthly_repo_ranks.files).toBe(8);
    expect(report.monthly.organization_monthly_curves.files).toBe(2);
    expect(report.monthly.month_heatmaps.files).toBe(2);
    expect(report.phase_manifest_sha256.base).toMatch(/^[a-f0-9]{64}$/);
    expect(read(options.out)).toEqual(report);
    await expect(compareProductionRepair(options)).rejects.toThrow("Report already exists");
    expect(report.weekly.files).toHaveLength(68);
    expect(report.weekly.survivor_sum_files).toContain("rank/week/2026-W23/repo/flow.json");
    expect(report.weekly.survivor_sum_files).toContain("rank/week/2026-W39/org/flow.json");
    expect(report.weekly.mixed_files).toEqual(["rank/week/2026-W24/repo/flow.json", "rank/week/2026-W24/org/flow.json"]);
    expect(report.weekly.files.find((f) => f.file === "rank/week/2026-W23/repo/stock.json")).toMatchObject({ measurement: "empty", recomputed_items: 0 });
    expect(report.weekly.files.find((f) => f.file === "rank/week/2026-W24/repo/stock.json")).toMatchObject({ measurement: "stock", recomputed_items: 1 });
    expect(report.weekly.files.find((f) => f.file === "rank/week/2026-W23/repo/flow.json")!.differences.length).toBeGreaterThan(0);
    expect(report.weekly.files.some((f) => f.week === "2026-W22" || f.week === "2026-W40")).toBe(false);
  });

  test("CLI exits zero on monthly equality even though weekly values differ", () => {
    const { options } = fixture(); const result = cli(options);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout.toString()).monthly_matches_frozen).toBe(true);
    expect(read(options.out).weekly.survivor_sum_files).toHaveLength(32);
  });

  test("CLI retains every monthly rank, org curve and heatmap difference and exits one", () => {
    const { options, frozen, seal } = fixture();
    const ranks = rank(frozen); ranks.items[0].value = Number(ranks.items[0].value) + 1; ranks.items[1].prev_rank = 91;
    const org = frozen.get("entity/org/acme.json") as { curve: { monthly: number[][] } };
    org.curve.monthly[0][2]++; org.curve.monthly.pop();
    const heatmap = frozen.get("heatmap/month/2026-05.json") as { cells: Array<[string, number]> };
    heatmap.cells[0][1]++;
    seal(); const result = cli(options);
    expect(result.exitCode).toBe(1);
    const report = read(options.out);
    expect(report.monthly_matches_frozen).toBe(false); expect(report.monthly_difference_count).toBe(5);
    expect(report.monthly.monthly_repo_ranks.differences).toEqual([
      { file: "rank/month/2026-05/repo/flow.json", pointer: "/items/0/value", kind: "changed", frozen: 11, recomputed: 10 },
      { file: "rank/month/2026-05/repo/flow.json", pointer: "/items/1/prev_rank", kind: "changed", frozen: 91, recomputed: null },
    ]);
    expect(report.monthly.organization_monthly_curves.differences.map((d: { pointer: string }) => d.pointer)).toEqual(["/curve/monthly/0/2", "/curve/monthly/3"]);
    expect(report.monthly.month_heatmaps.differences[0]).toMatchObject({ pointer: "/cells/0/1", frozen: 124, recomputed: 123 });
  });

  test("compares both file inventories, including growth/new metrics and missing organizations", () => {
    const { raw, frozen } = fixture(); const computed = recompute(raw);
    frozen.delete("rank/month/2026-05/repo/stock.json");
    frozen.set("rank/month/2026-09/repo/new.json", { ...rank(frozen), meta: { ...rank(frozen).meta, period: "2026-09", metric: "new" } });
    frozen.set("rank/month/2026-09/repo/growth.json", { ...rank(frozen), meta: { ...rank(frozen).meta, period: "2026-09", metric: "growth" } });
    frozen.set("entity/org/removed.json", structuredClone(frozen.get("entity/org/acme.json")));
    frozen.delete("heatmap/month/2026-06.json");
    frozen.set("heatmap/month/2026-07.json", { meta: { scope: "month", period: "2026-07", generated_at: NOW }, cells: [] });
    const report = compareRepairViews(frozen, computed);
    expect(report.monthly_matches_frozen).toBe(false); expect(report.monthly_difference_count).toBe(6);
    expect(report.monthly.monthly_repo_ranks.differences.map((d) => [d.file, d.kind])).toEqual([
      ["rank/month/2026-05/repo/stock.json", "missing_frozen"], ["rank/month/2026-09/repo/growth.json", "missing_recomputed"], ["rank/month/2026-09/repo/new.json", "missing_recomputed"],
    ]);
    expect(report.monthly.organization_monthly_curves.differences[0].kind).toBe("missing_recomputed");
    expect(report.monthly.month_heatmaps.differences.map((d) => d.kind)).toEqual(["missing_frozen", "missing_recomputed"]);
  });

  test("array length mismatches do not hide other values or any added/removed points", () => {
    const { raw, frozen } = fixture(); const computed = recompute(raw);
    rank(frozen).items[0].value = Number(rank(frozen).items[0].value) + 1; rank(frozen).items.pop();
    const org = frozen.get("entity/org/acme.json") as { curve: { monthly: Array<[string, number, number]> } };
    org.curve.monthly.push(["2026-09", 1, 20], ["2026-10", 2, 22]);
    const report = compareRepairViews(frozen, computed);
    expect(report.monthly.monthly_repo_ranks.differences.map((d) => d.pointer)).toEqual(["/items/0/value", "/items/1"]);
    expect(report.monthly.organization_monthly_curves.differences.map((d) => d.pointer)).toEqual(["/curve/monthly/4", "/curve/monthly/5"]);
  });

  test("approved dropped repository effects are reported rather than filtered or waived", () => {
    const { raw, frozen } = fixture();
    const dropped = 206462776;
    raw.repos[String(dropped)] = { ...raw.repos["1"], id: dropped, name: "gone", full_name: "acme/gone" };
    raw.monthly[String(dropped)] = [["2026-05", 20]];
    const beforeDrop = recompute(raw);
    delete raw.repos[String(dropped)]; delete raw.monthly[String(dropped)];
    const report = compareRepairViews(beforeDrop, recompute(raw));
    expect(report.monthly_matches_frozen).toBe(false);
    expect(report.monthly.monthly_repo_ranks.differences.some((d) => d.frozen === dropped)).toBe(true);
    expect(report.monthly.organization_monthly_curves.differences.length).toBeGreaterThan(0);
    expect(compareRepairViews(frozen, recompute(raw)).monthly_matches_frozen).toBe(true);
  });

  test("only rank/heatmap generation timestamps and non-monthly org fields are ignored", () => {
    const { raw, frozen } = fixture(); const computed = recompute(raw);
    rank(frozen).meta.period = "2026-07";
    const report = compareRepairViews(frozen, computed);
    expect(report.monthly_difference_count).toBe(1);
    expect(report.monthly.monthly_repo_ranks.differences[0].pointer).toBe("/meta/period");
    const malformed = new Map(frozen); malformed.set("entity/org/acme.json", { curve: {} });
    expect(() => compareRepairViews(malformed, computed)).toThrow("Missing monthly organization curve");
  });

  test("week absence and ordinary history are explicit and cannot turn an empty monthly comparison green", () => {
    const { raw, frozen } = fixture();
    delete raw.repos["1"].aggregate_history;
    const report = compareRepairViews(frozen, recompute(raw));
    expect(report.weekly.files.find((f) => f.file === "rank/week/2026-W23/repo/flow.json")!.measurement).toBe("existing_history");
    const empty = compareRepairViews(new Map(), new Map());
    expect(empty.monthly_matches_frozen).toBe(false); expect(empty.empty_monthly_families).toHaveLength(3);
    expect(empty.weekly.missing_files).toHaveLength(68);
  });

  test("tampered sealed input or missing shard refuses with exit two and no report", () => {
    const { options } = fixture();
    write(join(options.built, PREFIX, "canonical/v2/repo-monthly/1.json"), { "1": [["2026-05", 11]] });
    const result = cli(options);
    expect(result.exitCode).toBe(2); expect(result.stderr.toString()).toContain("differs from its manifest"); expect(existsSync(options.out)).toBe(false);
    rmSync(join(options.built, PREFIX, "canonical/v2/repos/2.json"));
    expect(cli(options).exitCode).toBe(2);
  });

  test("a resealed monthly canonical change is caught by the recompute comparison", async () => {
    const { options, raw, seal } = fixture();
    raw.monthly["1"] = [["2026-04", 10], ["2026-05", 10], ["2026-06", 5], ["2026-08", 5]];
    seal(); const report = await compareProductionRepair(options);
    expect(report.monthly_matches_frozen).toBe(false);
    expect(report.monthly.monthly_repo_ranks.differences.length).toBeGreaterThan(0);
    expect(report.monthly.organization_monthly_curves.differences.length).toBeGreaterThan(0);
  });

  test("refuses symlink input, overlapping output and invalid local CLI arguments", async () => {
    const { root, options } = fixture();
    await expect(compareProductionRepair({ ...options, out: join(options.built, "report.json") })).rejects.toThrow("outside the built input tree");
    symlinkSync(options.built, join(root, "linked"));
    await expect(compareProductionRepair({ ...options, built: join(root, "linked") })).rejects.toThrow("Symlink input root refused");
    const shard = join(options.built, PREFIX, "canonical/v2/repos/1.json");
    const other = join(root, "repo.json"); write(other, read(shard)); rmSync(shard); symlinkSync(other, shard);
    await expect(compareProductionRepair(options)).rejects.toThrow("Symlink input refused");
    for (const args of [[], ["--execute"], ["--built"], ["--built", "https://example.com"], ["--out", "one", "--out", "two"], ["--generation", "../bad", "--built", "local", "--out", "report"]]) expect(() => parseCompareArgs(args)).toThrow();
  });
});
