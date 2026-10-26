import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DuckDBInstance } from "../../pipeline/node_modules/@duckdb/node-api";
import { BOOTSTRAP_PHASES, verifyBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";
import { GAP_DAYS } from "../../pipeline/scripts/star-history-aggregate.mjs";
import { AGGREGATE_HISTORY_PROVENANCE as provenance } from "./contracts/star-history";
import { RepoEntity, ReposShard, RepoMonthlyShard, RepoRecentDailyShard, RepoWeeklyShard } from "./contracts";
import { buildModel, type RawShards } from "./workflows/recompute/model";
import { computeRepoWindow } from "./workflows/recompute/windows";
import { repoEntityFromParts, lookupRepoEntry, orgEntityFromParts } from "./workflows/recompute/entities";
import { assertFrozenMonths, buildProductionRepair, DROP_IDS, frozenDiscount, parseRepairArgs } from "../scripts/prod-repair-build";
import { inspectLocalBootstrapCanonical } from "../scripts/lib/validate-bootstrap-canonical";
import { compareProductionRepair } from "../scripts/prod-repair-compare";
import { computeAllViews } from "./workflows/recompute";

const GEN = "bootstrap-prod-repair-fixture";
const NOW = "2026-09-13T06:00:16.398Z";
const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
const write = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "prod-repair-")); scratch.push(root);
  const options = { frozenViews: join(root, "frozen"), whitelist: join(root, "whitelist.json"), restRepos: join(root, "rest"),
    gross: join(root, "gross"), aggregate: join(root, "aggregate"), out: join(root, "output"), generation: GEN };
  const raw: RawShards = { repos: {}, monthly: { "1": [["2026-04", 10], ["2026-05", 10], ["2026-06", 4]], "2": [["2026-06", 7]], "3": [], ...Object.fromEntries(DROP_IDS.map((id) => [id, [["2026-05", 8]] as Array<[string, number]>])) }, weekly: {}, recentDaily: { "1": [["2026-05-29", 4]] }, siteDailyByYear: {} };
  for (const id of [1, 2, 3, ...DROP_IDS]) raw.repos[String(id)] = {
    id, owner: "owner", owner_type: "Organization", name: `repo${id}`, full_name: `owner/repo${id}`,
    current_stars: 10000 + id, created_at: "2020-01-01", d: id === 1 ? 0.5 : id === 2 || id === 3 ? 0 : 1,
    active: id !== 3, tracked_since: id === 3 ? "2026-08-30" : null,
  };
  const window = computeRepoWindow(buildModel(raw, "2026-05-30"), "month");
  const lookup = Object.fromEntries(Object.entries(raw.repos).map(([id, repo]) => [id, lookupRepoEntry(repo)]));
  write(join(options.frozenViews, "meta.json"), { seam_date: "2026-05-30", schema_ver: 1, generated_at: NOW, active_repo_count: 3, historical_repo_count: 1, folded_through: { month: "2026-08", week: "2026-W35" } });
  write(join(options.frozenViews, "lookup/repos.json"), lookup);
  write(join(options.frozenViews, "lookup/orgs.json"), { owner: { login: "owner", owner_type: "Organization", repo_count: 3, current_stars_sum: 30000 } });
  write(join(options.frozenViews, "entity/org/owner.json"), orgEntityFromParts("owner", "Organization", 30000, 3, [1, 2, DROP_IDS[0]], [], []).entity);
  for (const [id, repo] of Object.entries(raw.repos)) write(join(options.frozenViews, `entity/repo/${id}.json`), repoEntityFromParts(repo, window.byRepo.get(Number(id))!, raw.recentDaily[id] ?? []).entity);
  for (const dim of ["repo", "org"]) write(join(options.frozenViews, `rank/all-time/${dim}/stock.json`), { frozen_sentinel: dim });
  write(join(options.frozenViews, "rank/month/2026-05/repo/flow.json"), { frozen_sentinel: "monthly-ranks" });
  write(join(options.frozenViews, "heatmap/month/2026-05.json"), { meta: { scope: "month", period: "2026-05", generated_at: NOW }, cells: [["2026-05-29", 123]] });
  write(options.whitelist, { run_id: "refresh-retained", generated_at: NOW, count: 2, entries: [1, 3].map((id) => ({ id, node_id: `R_retained_${id}`, full_name: `owner/repo${id}`, owner: "owner", name: `repo${id}`, stars: 10000 + id })), diff: { added: [], dropped: [] } });
  write(join(options.restRepos, "2.json"), { id: 2, node_id: "R_from_rest_2", full_name: "owner/repo2" });
  mkdirSync(options.gross);
  const db = await DuckDBInstance.create(); const con = await db.connect();
  try {
    const file = join(options.gross, "data-0.parquet").replaceAll("'", "''");
    await con.run(`COPY (SELECT * FROM (VALUES (1,DATE '2026-05-25',9),(1,DATE '2026-05-29',4),(99,DATE '2026-05-29',7)) t(repo_id,day,gross_adds)) TO '${file}' (FORMAT PARQUET)`);
  } finally { con.closeSync(); db.closeSync(); }
  const daily = Object.fromEntries(GAP_DAYS.map((day: string) => [day, 2]));
  for (const id of [1, 99]) write(join(options.aggregate, `repos/${id}.json`), { version: 1, repo_id: id, name: `owner/repo${id}`, provenance, status: "complete", daily, total: 248 });
  write(join(options.aggregate, "repos/2.json"), { version: 1, repo_id: 2, name: "owner/repo2", provenance, status: "not_found_or_inaccessible", daily: null });
  return { root, options, raw };
}

function cli(options: Awaited<ReturnType<typeof fixture>>["options"]) {
  const flags = ["--frozen-views", options.frozenViews, "--whitelist", options.whitelist, "--rest-repos", options.restRepos, "--gross", options.gross, "--aggregate", options.aggregate, "--out", options.out, "--generation", options.generation];
  return Bun.spawnSync([process.execPath, "--no-env-file", resolve(import.meta.dir, "../scripts/prod-repair-build.ts"), ...flags], { env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, stdout: "pipe", stderr: "pipe" });
}

describe("offline option B repair builder", () => {
  test("writes and verifies both phases, exact frozen base, canonical buckets and source report", async () => {
    const { options } = await fixture();
    const network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    let report: Awaited<ReturnType<typeof buildProductionRepair>>;
    try { report = await buildProductionRepair(options); expect(network).not.toHaveBeenCalled(); }
    finally { network.mockRestore(); }
    expect(report.repo_count).toBe(3); expect(report.frozen_repo_count).toBe(7);
    expect(report.phases).toEqual(BOOTSTRAP_PHASES);
    expect(report.rows).toEqual({ monthly: 4, weekly: 18, daily: 125, site_daily: 1 });
    expect(report.dropped).toEqual(DROP_IDS.map((id) => ({ id, full_name: `owner/repo${id}`, reason: "github_rest_404_owner_approved" })));
    expect(Object.keys(report.node_id_sources)).toEqual(["1", "2", "3"]);
    expect(report.node_id_sources["1"].kind).toBe("retained_whitelist"); expect(report.node_id_sources["2"].kind).toBe("github_rest");
    expect(report.node_id_sources["2"].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.aggregate.outside_frozen_membership).toEqual([99]);
    expect(report.aggregate.outside_aggregate_membership).toEqual([3]);
    expect(report.aggregate.unavailable[0].repo_id).toBe(2);
    const prefix = join(options.out, "bootstrap/generations", GEN);
    const verified = await verifyBootstrapGeneration({ generation: GEN, store: { read: async (path: string) => readFileSync(join(options.out, path)) } });
    expect(verified.canonical.manifest.object_count).toBe(130);
    for (const item of verified.base.manifest.objects) {
      expect(readFileSync(join(prefix, item.path))).toEqual(readFileSync(join(options.frozenViews, item.path.slice("views/".length))));
    }
    expect(existsSync(join(options.out, "bootstrap/latest.json"))).toBe(false);
    const canonical = join(prefix, "canonical/v2");
    expect(await inspectLocalBootstrapCanonical(canonical)).toMatchObject({ exitCode: 0, failures: [] });
    for (let bucket = 0; bucket < 32; bucket++) {
      for (const [family, schema] of [["repos", ReposShard], ["repo-monthly", RepoMonthlyShard], ["repo-weekly", RepoWeeklyShard], ["repo-recent-daily", RepoRecentDailyShard]] as const) {
        expect(schema.safeParse(read(join(canonical, `${family}/${bucket}.json`))).success).toBe(true);
      }
    }
    const repo = read(join(canonical, "repos/1.json"))["1"];
    expect(repo.d).toBe(0.5); expect(repo.node_id).toBe("R_retained_1");
    expect(repo.aggregate_history).toEqual({ provenance, weeks: Array.from({ length: 17 }, (_, i) => `2026-W${23 + i}`) });
    expect(read(join(canonical, "repos/3.json"))["3"]).toMatchObject({ active: false, tracked_since: "2026-08-30", d: 0 });
    expect(read(join(canonical, "repo-monthly/1.json"))["1"]).toEqual([["2026-04", 10], ["2026-05", 10], ["2026-06", 4]]);
    expect(read(join(canonical, "repo-weekly/1.json"))["1"]).toEqual([["2026-W22", 13], ...Array.from({ length: 17 }, (_, i) => [`2026-W${23 + i}`, 14])]);
    expect(read(join(canonical, "repo-recent-daily/1.json"))["1"][0]).toEqual(["2026-05-29", 4]);
    expect(read(join(canonical, "repo-recent-daily/2.json"))["2"]).toEqual([]);
    expect(read(join(canonical, "site-daily/2026.json")).cells).toEqual([["2026-05-29", 123]]);
    expect(read(join(options.out, "repair-report.json"))).toEqual(report);
    await expect(buildProductionRepair(options)).rejects.toThrow("Output already exists");
  });

  test("CLI succeeds using only supplied local files", async () => {
    const { options } = await fixture(); const result = cli(options);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout.toString()).repo_count).toBe(3);
  });

  test("comparison consumes actual builder output and reports the approved drops' monthly effects", async () => {
    const { options, raw, root } = await fixture();
    raw.siteDailyByYear = { "2026": { year: "2026", cells: [["2026-05-29", 123]] } };
    const frozen = computeAllViews(buildModel(raw, "2026-05-30"), {
      gen: NOW, seamDate: "2026-05-30", foldedThrough: { month: "2026-08", week: "2026-W35" },
    });
    for (const [path, value] of frozen.views) write(join(options.frozenViews, path), value);
    await buildProductionRepair(options);
    const comparison = await compareProductionRepair({ built: options.out, generation: GEN, out: join(root, "comparison.json") });
    expect(comparison.monthly_matches_frozen).toBe(false);
    expect(comparison.monthly.monthly_repo_ranks.differences.length).toBeGreaterThan(0);
    expect(comparison.monthly.organization_monthly_curves.differences.length).toBeGreaterThan(0);
    expect(comparison.monthly.month_heatmaps.differences).toEqual([]);
    expect(comparison.weekly.survivor_sum_files).toContain("rank/week/2026-W39/repo/flow.json");
  });

  test.each([1, 2])("CLI refuses missing retained node_id %i without synthesizing it or writing output", async (id) => {
    const { options } = await fixture();
    if (id === 1) {
      const snapshot = read(options.whitelist); snapshot.entries = snapshot.entries.filter((row: { id: number }) => row.id !== id); snapshot.count--;
      write(options.whitelist, snapshot);
    } else rmSync(join(options.restRepos, `${id}.json`));
    const result = cli(options);
    expect(result.exitCode).not.toBe(0); expect(result.stderr.toString()).toContain(`Missing retained node_id for kept repository ${id}`);
    expect(result.stderr.toString()).toContain("synthesized node_id fallback is forbidden");
    expect(existsSync(options.out)).toBe(false);
  });

  test("CLI refuses a monthly stock that cannot reproduce the frozen curve", async () => {
    const { options } = await fixture(); const path = join(options.frozenViews, "entity/repo/1.json");
    const entity = read(path); entity.curve.monthly[0][2]++; write(path, entity);
    const result = cli(options);
    expect(result.exitCode).not.toBe(0); expect(result.stderr.toString()).toContain("Monthly value differs from frozen curve for repository 1");
    expect(existsSync(options.out)).toBe(false);
  });

  test("monthly guard refuses any changed flow, removed point, added point, or stock", async () => {
    const { options, raw } = await fixture();
    const curves = new Map([["1", RepoEntity.parse(read(join(options.frozenViews, "entity/repo/1.json"))).curve.monthly]]);
    assertFrozenMonths(raw, curves, "2026-05-30");
    for (const monthly of [[["2026-04", 11], ["2026-05", 10], ["2026-06", 4]], [["2026-04", 10]], [...raw.monthly["1"], ["2026-07", 0]]] as Array<Array<[string, number]>>) {
      expect(() => assertFrozenMonths({ ...raw, monthly: { ...raw.monthly, "1": monthly } }, curves, "2026-05-30")).toThrow("Monthly value differs");
    }
    expect(() => assertFrozenMonths({ ...raw, repos: { ...raw.repos, "1": { ...raw.repos["1"], d: 1 } } }, curves, "2026-05-30")).toThrow("Monthly value differs");
  });

  test("refuses incomplete aggregate coverage instead of treating missing days as zero", async () => {
    const { options } = await fixture(); const path = join(options.aggregate, "repos/1.json"); const row = read(path);
    delete row.daily["2026-06-01"]; write(path, row);
    await expect(buildProductionRepair(options)).rejects.toThrow("Invalid aggregate daily coverage"); expect(existsSync(options.out)).toBe(false);
  });

  test("refuses a missing pre-seam checkpoint and conflicting retained identities", async () => {
    const { options } = await fixture(); const path = join(options.aggregate, "repos/1.json"); rmSync(path);
    await expect(buildProductionRepair(options)).rejects.toThrow("Missing aggregate checkpoint");
    write(join(options.restRepos, "1.json"), { id: 1, node_id: "R_conflicting" });
    await expect(buildProductionRepair(options)).rejects.toThrow("Conflicting retained node_id"); expect(existsSync(options.out)).toBe(false);
  });

  test("empty and post-seam curves invert to zero; invalid pre-seam curves refuse", () => {
    expect(frozenDiscount([], "2026-05")).toBe(0);
    expect(frozenDiscount([["2026-06", 4, 4]], "2026-05")).toBe(0);
    expect(() => frozenDiscount([["2026-05", 0, 1]], "2026-05")).toThrow("zero gross");
    expect(() => frozenDiscount([["2026-05", -1, 0]], "2026-05")).toThrow("Negative");
    expect(() => frozenDiscount([["2026-05", 1, 1], ["2026-05", 1, 2]], "2026-05")).toThrow("ordered and unique");
  });

  test("CLI rejects unknown, duplicate, missing, remote, and publication arguments", () => {
    for (const args of [[], ["--execute"], ["--gross"], ["--gross", "https://data.example/archive"], ["--out", "one", "--out", "two"], ["--target", "prod"]]) expect(() => parseRepairArgs(args)).toThrow();
  });
});
