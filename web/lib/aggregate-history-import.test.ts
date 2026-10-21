import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryObjectStore } from "./storage/memory-store";
import { createObjectStoreBootstrapAdapter } from "./storage/bootstrap-adapter";
import { AGGREGATE_HISTORY_PROVENANCE as provenance } from "./contracts/star-history";
import { RepoEntity, ReposShard, type RepoRecentDailyShard, type RepoWeeklyShard } from "./contracts";
import { GAP_DAYS, gapSeries } from "../../pipeline/scripts/star-history-aggregate.mjs";
import { rollbackBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";
import { withBootstrapPublicationLease } from "../../pipeline/lib/bootstrap-lease.mjs";
import { loadAggregateBundle, digest, type AggregateBundle } from "../scripts/lib/aggregate-history-input";
import { importAggregateHistory, mergeAggregateBucket, PREVIEW_BUCKET, type ImportReport } from "../scripts/lib/aggregate-history-import";
import { parseAggregateImportArgs } from "../scripts/import-star-history-aggregate";
import { repoEntityFromParts, orgEntityFromParts, lookupRepoEntry } from "./workflows/recompute/entities";
import { buildModel, type RawShards } from "./workflows/recompute/model";
import { computeOrgWindow, computeRepoWindow } from "./workflows/recompute/windows";
import { repoRankMatrix, orgRankMatrix } from "./workflows/recompute/ranks";
import { createPackedWindowBuilder, packedRepoRankViewsForPeriod, packedOrgRankViewsForPeriod } from "./workflows/recompute/packed-window";
import { buildMetadataShard } from "./workflows/steps/metadata";
import { slimRankRepoMeta } from "./workflows/recompute/io";

const GEN = "bootstrap-aggregate-fixture";
const NOW = "2026-10-21T00:00:00.000Z";
const json = (value: unknown) => JSON.stringify(value);
const parse = (body: { body: string } | null) => JSON.parse(body!.body);
function repo(id = 1) {
  return { id, node_id: `R_${id}`, owner: "owner", owner_type: "Organization" as const, name: `repo${id}`, full_name: `owner/repo${id}`,
    current_stars: 10000 + id, created_at: "2020-01-01", d: 2, active: true, tracked_since: null };
}
function bundle(): AggregateBundle {
  const daily = Object.fromEntries([1, 2].map((id) => [String(id), GAP_DAYS.map((day: string) => [day, id] as [string, number])]));
  return { sha256: "a".repeat(64), daily,
    weekly: Object.fromEntries(Object.entries(daily).map(([id, rows]) => [id, gapSeries({ status: "complete", daily: Object.fromEntries(rows) }).weekly.map((row): [string, number] => [String(row[0]), Number(row[1])])])),
    missing: [{ repo_id: 6, name: "missing/repo", status: "not_found_or_inaccessible" }] };
}
function report(): ImportReport {
  return { source_manifest_sha256: bundle().sha256, generation: GEN, imported: [], skipped: [], edge_weeks_skipped: [] };
}
function fixture(): MemoryObjectStore {
  const r = repo();
  const entity = repoEntityFromParts(r, [{ period: "2026-05", flow: 7, cumgross: 7, stock_est: 14, flow_rank: 1 }], [["2026-10-21", 3]]).entity;
  const org = orgEntityFromParts("owner", "Organization", r.current_stars, 1, [1], [{ period: "2026-05", flow: 7, stock_est: 14 }], [["2026-10-21", 3]]).entity;
  const objects: Record<string, string> = {
    "_meta/bucket-identity.json": json({ bucket: PREVIEW_BUCKET, deploy_env: "pre" }),
    "canonical/v2/meta.json": json({ seam_date: "2026-05-30", schema_ver: 1, folded_through: { month: "2026-09", week: "2026-W39" }, generated_at: NOW }),
    "views/latest.json": json({ version: "refresh-fixture", run_id: "refresh-fixture", schema_ver: 1, published_at: NOW, prev_version: null }),
    "views/refresh-fixture/meta.json": json({ seam_date: "2026-05-30", schema_ver: 1, generated_at: NOW, active_repo_count: 1, historical_repo_count: 0, folded_through: { month: "2026-09", week: "2026-W39" } }),
    "views/refresh-fixture/lookup/repos.json": json({ "1": lookupRepoEntry(r) }),
    "views/refresh-fixture/lookup/orgs.json": json({ owner: { login: "owner", owner_type: "Organization", current_stars_sum: 10001, repo_count: 1 } }),
    "views/refresh-fixture/rank/all-time/repo/stock.json": json({ items: [{ id: 1, value: 10001 }] }),
    "views/refresh-fixture/rank/all-time/org/stock.json": json({ items: [{ login: "owner", value: 10001 }] }),
    "views/refresh-fixture/rank/month/2026-05/repo/flow.json": json({ sentinel: "preserve-monthly-bytes" }),
    "views/refresh-fixture/rank/year/2026/repo/flow.json": json({ sentinel: "preserve-yearly-bytes" }),
    "views/refresh-fixture/entity/repo/1.json": json(entity),
    "views/refresh-fixture/entity/org/owner.json": json(org),
  };
  for (let bucket = 0; bucket < 32; bucket++) {
    for (const family of ["repos", "repo-recent-daily", "repo-weekly", "repo-monthly"]) {
      objects[`canonical/v2/${family}/${bucket}.json`] = json(bucket !== 1 ? {} : family === "repos" ? { "1": r }
        : family === "repo-monthly" ? { "1": [["2026-05", 7]] } : family === "repo-recent-daily" ? { "1": [["2026-10-21", 3]] } : { "1": [["2026-W21", 5], ["2026-W43", 3]] });
    }
  }
  return new MemoryObjectStore(objects);
}

describe("preview aggregate input and merge", () => {
  const scratch: string[] = [];
  afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });

  test("validates the sealed export and rejects manifest or payload tampering", () => {
    const dir = mkdtempSync(join(tmpdir(), "aggregate-import-")); scratch.push(dir);
    const source = bundle();
    const files: Array<{ path: string; bytes: number; sha256: string; rows: number }> = [];
    const write = (path: string, value: unknown, rows: number) => {
      const body = json(value); const target = join(dir, "inputs", path);
      mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, body);
      files.push({ path, bytes: Buffer.byteLength(body), sha256: digest(body), rows });
    };
    for (let bucket = 0; bucket < 32; bucket++) {
      for (const family of ["repo-recent-daily", "repo-weekly"]) {
        const values = Object.fromEntries(Object.entries(family === "repo-weekly" ? source.weekly : source.daily).filter(([id]) => Number(id) % 32 === bucket));
        write(`canonical/v2/${family}/${bucket}.json`, values, Object.values(values).reduce((n, rows) => n + rows.length, 0));
      }
    }
    write("partial-iso-weeks.json", Object.fromEntries(Object.entries(source.daily).map(([id, rows]) => [id, gapSeries({ status: "complete", daily: Object.fromEntries(rows) }).partialWeeks])), 4);
    const missing = Array.from({ length: 5247 }, (_, i) => ({ repo_id: i + 100, name: `missing/repo${i}`, status: "not_found_or_inaccessible" }));
    const manifest = json({ version: 1, provenance, fetch_finished: true, monthly_files: [], daily_rows: 248, complete_week_rows: 34, files,
      checkpoints: [...[1, 2].map((repo_id) => ({ repo_id, status: "complete", raw_replay_verified: true })), ...missing.map((repo) => ({ ...repo, raw_replay_verified: true }))], missing });
    writeFileSync(join(dir, "inputs/manifest.json"), manifest);
    expect(loadAggregateBundle(dir, digest(manifest)).daily).toEqual(source.daily);
    expect(() => loadAggregateBundle(dir)).toThrow("manifest checksum");
    writeFileSync(join(dir, "inputs/canonical/v2/repo-recent-daily/1.json"), "{}");
    expect(() => loadAggregateBundle(dir, digest(manifest))).toThrow("input checksum");
  });

  test("keeps existing days/weeks and only joins complete edge weeks", () => {
    const repos = ReposShard.parse({ "1": repo() });
    const daily: RepoRecentDailyShard = { "1": [["2026-05-25", 10], ["2026-05-26", 10], ["2026-05-27", 10], ["2026-05-28", 10], ["2026-05-29", 10]] };
    const weekly: RepoWeeklyShard = { "1": [["2026-W23", 999]] };
    const result = report(); mergeAggregateBucket(repos, daily, weekly, bundle(), result);
    expect(weekly["1"].find(([week]) => week === "2026-W23")).toEqual(["2026-W23", 999]);
    expect(weekly["1"].find(([week]) => week === "2026-W22")).toEqual(["2026-W22", 52]);
    expect(weekly["1"].some(([week]) => week === "2026-W40")).toBe(false);
    expect(result.edge_weeks_skipped[0]!.missing_days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(repos["1"]!.d).toBe(2);
    expect(repos["1"]!.aggregate_history!.weeks).not.toContain("2026-W23");
    const replay = report(); mergeAggregateBucket(repos, daily, weekly, bundle(), replay);
    expect(replay.imported).toHaveLength(0); expect(replay.skipped[0]!.reason).toBe("already_imported");
    daily["1"]![10]![1] = 20;
    expect(() => mergeAggregateBucket(repos, daily, weekly, bundle(), report())).toThrow("Imported history changed");
  });

  test("skips a mixed existing daily source rather than mislabeling it", () => {
    const repos = ReposShard.parse({ "1": repo() });
    const daily: RepoRecentDailyShard = { "1": [["2026-06-01", -3]] };
    const result = report(); mergeAggregateBucket(repos, daily, {}, bundle(), result);
    expect(daily["1"]).toEqual([["2026-06-01", -3]]);
    expect(result.skipped[0]!.reason).toBe("existing_gap_daily_observations");
    expect(repos["1"]!.aggregate_history).toBeUndefined();
  });

  test("CLI refuses production, missing selection and unknown flags", () => {
    expect(parseAggregateImportArgs(["--target", "pre", "--source", "local", "--generation", GEN]).execute).toBe(false);
    expect(parseAggregateImportArgs(["--target", "pre", "--source", "local", "--generation", GEN, "--execute"]).execute).toBe(true);
    expect(() => parseAggregateImportArgs(["--target", "prod"])).toThrow("Only --target pre");
    expect(() => parseAggregateImportArgs(["--source", "local", "--generation", GEN])).toThrow("Required");
    expect(() => parseAggregateImportArgs(["--target"])).toThrow("requires a value");
    expect(() => parseAggregateImportArgs(["--help"])).toThrow("Unknown argument");
  });
});

describe("lease-protected immutable preview publication", () => {
  test("dry-run writes nothing; publish preserves monthly/anchors and can recover managed cold start", async () => {
    const store = fixture();
    const before = await store.list({ prefix: "" });
    const dry = await importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: false });
    expect(dry.status).toBe("dry-run"); expect(dry.report!.imported).toHaveLength(1);
    expect(dry.report!.skipped.map((repo) => repo.reason)).toEqual(["not_in_preview_membership", "not_found_or_inaccessible"]);
    expect(await store.list({ prefix: "" })).toEqual(before);
    const original = parse(await store.get("views/refresh-fixture/entity/repo/1.json"));
    const result = await importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: true });
    expect(result.status).toBe("published");
    const prefix = `bootstrap/generations/${GEN}`;
    expect(parse(await store.get("bootstrap/latest.json")).generation).toBe(GEN);
    expect(parse(await store.get("ops/workflows/active.json")).status).toBe("published");
    expect(await store.get(`${prefix}/canonical/v2/repo-monthly/1.json`)).toMatchObject({ body: (await store.get("canonical/v2/repo-monthly/1.json"))!.body });
    const entity = RepoEntity.parse(parse(await store.get(`${prefix}/views/entity/repo/1.json`)));
    expect(entity.curve.monthly).toEqual(original.curve.monthly); expect(entity.monthly_table).toEqual(original.monthly_table);
    expect(entity.current_stars).toBe(10001); expect(entity.curve.provenance).toEqual(provenance);
    expect(entity.curve.recent_daily).toHaveLength(125);
    expect(parse(await store.get(`${prefix}/canonical/v2/repos/1.json`))["1"].d).toBe(2);
    for (const rel of ["meta.json", "lookup/repos.json", "rank/month/2026-05/repo/flow.json", "rank/year/2026/repo/flow.json", "rank/all-time/repo/stock.json"]) {
      expect((await store.get(`${prefix}/views/${rel}`))!.body).toBe((await store.get(`views/refresh-fixture/${rel}`))!.body);
    }
    const flow = parse(await store.get(`${prefix}/views/rank/week/2026-W23/repo/flow.json`));
    expect(flow.items[0].value).toBe(7); expect(flow.meta.provenance).toEqual(provenance);
    expect(parse(await store.get(`${prefix}/views/rank/week/2026-W23/repo/stock.json`)).items).toEqual([]);
    expect((await store.get(`${prefix}/views/aggregate-history-import.json`))!.body).not.toMatch(/\/Users\/|sources|measurements/);
    expect((await importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: true })).status).toBe("already-published");
    const previous = parse(await store.get("bootstrap/latest.json")).previous_generation;
    expect(previous).toStartWith("bootstrap-aggregate-recovery-");
    await withBootstrapPublicationLease({ store: createObjectStoreBootstrapAdapter(store), generation: GEN, operation: "rollback",
      run: (assertCanCommit: () => Promise<void>) => rollbackBootstrapGeneration({ store: createObjectStoreBootstrapAdapter(store), targetGeneration: previous, assertCanCommit }) });
    expect(parse(await store.get("bootstrap/latest.json")).generation).toBe(previous);
    expect(parse(await store.get("views/latest.json")).version).toBe("refresh-fixture");
  });

  test("a real cold-start layout with missing history families gets a sealed empty recovery generation", async () => {
    const store = fixture();
    for (let bucket = 0; bucket < 32; bucket++) {
      for (const family of ["repo-monthly", "repo-weekly", "repo-recent-daily"]) await store.del(`canonical/v2/${family}/${bucket}.json`);
    }
    const entity = parse(await store.get("views/refresh-fixture/entity/repo/1.json"));
    entity.curve.monthly = []; entity.monthly_table = []; entity.rank_history.month = [];
    await store.put("views/refresh-fixture/entity/repo/1.json", json(entity));
    const org = parse(await store.get("views/refresh-fixture/entity/org/owner.json")); org.curve.monthly = [];
    await store.put("views/refresh-fixture/entity/org/owner.json", json(org));
    const result = await importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: true });
    expect(result.status).toBe("published");
    const previous = parse(await store.get("bootstrap/latest.json")).previous_generation;
    const recoveryPrefix = `bootstrap/generations/${previous}`;
    expect(parse(await store.get(`${recoveryPrefix}/canonical/v2/repo-monthly/1.json`))).toEqual({});
    expect(parse(await store.get(`${recoveryPrefix}/canonical/v2/repo-weekly/1.json`))).toEqual({});
    expect((await store.get(`${recoveryPrefix}/views/entity/repo/1.json`))!.body).toBe((await store.get("views/refresh-fixture/entity/repo/1.json"))!.body);
    expect(await store.get("canonical/v2/repo-monthly/1.json")).toBeNull();
    expect(parse(await store.get(`bootstrap/generations/${GEN}/canonical/v2/repo-monthly/1.json`))).toEqual({});
    expect(parse(await store.get(`bootstrap/generations/${GEN}/canonical/v2/repo-recent-daily/1.json`))["1"].at(-1)).toEqual(["2026-10-21", 3]);
  });

  test("missing canonical monthly history cannot silently erase a published monthly curve", async () => {
    const store = fixture(); await store.del("canonical/v2/repo-monthly/1.json");
    await expect(importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: true })).rejects.toThrow("no canonical source");
    expect(await store.get("bootstrap/latest.json")).toBeNull();
  });

  test("active, corrupt or wrong-bucket leases refuse before staging", async () => {
    for (const lease of [{ status: "running", expires_at: "2099-01-01T00:00:00Z", fencing_token: 3 }, { status: "bad" }]) {
      const store = fixture(); await store.put("ops/workflows/active.json", json(lease));
      await expect(importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: true })).rejects.toThrow(/lease/i);
      expect((await store.list({ prefix: `bootstrap/generations/${GEN}/` })).blobs).toEqual([]);
    }
    const store = fixture(); await store.put("_meta/bucket-identity.json", json({ bucket: "other-bucket", deploy_env: "pre" }));
    await expect(importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: false })).rejects.toThrow("exact preview bucket");
  });

  test("lease takeover or interrupted staging cannot change the publication pointer", async () => {
    const store = fixture(); const put = store.put.bind(store); let staged = false;
    store.put = async (path, body, options) => {
      if (path.startsWith(`bootstrap/generations/${GEN}/`) && !staged) {
        staged = true;
        await put("ops/workflows/active.json", json({ run_id: "successor", status: "running", expires_at: "2099-01-01T00:00:00Z", fencing_token: 99 }));
      }
      return put(path, body, options);
    };
    await expect(importAggregateHistory({ store, bundle: bundle(), generation: GEN, execute: true })).rejects.toThrow(/lease/i);
    expect(await store.get("bootstrap/latest.json")).toBeNull();
    expect(parse(await store.get("views/latest.json")).version).toBe("refresh-fixture");
    expect(parse(await store.get("ops/workflows/active.json")).run_id).toBe("successor");
  });
});

test("ordinary refresh preserves provenance, flow, monthly stock and unknown weekly stock in packed and full paths", () => {
  const marked = { ...repo(), aggregate_history: { provenance, weeks: ["2026-W23"] } };
  const raw: RawShards = { repos: { "1": marked }, monthly: { "1": [["2026-05", 7]] }, weekly: { "1": [["2026-W21", 5], ["2026-W23", 70], ["2026-W43", 3]] }, recentDaily: { "1": [["2026-06-01", 10]] }, siteDailyByYear: {} };
  const model = buildModel(raw, "2026-05-30"); const window = computeRepoWindow(model, "week");
  expect(window.byRepo.get(1)!.map((row) => row.stock_est)).toEqual([10, -1, 13]);
  expect(computeRepoWindow(model, "month").byRepo.get(1)![0]!.stock_est).toBe(14);
  const org = computeOrgWindow(model, window);
  for (const ranks of [repoRankMatrix(window, "week", NOW), orgRankMatrix(org, "week", NOW)]) {
    expect([...ranks].find(([path]) => path.includes("W23") && path.endsWith("stock.json"))![1].items).toEqual([]);
    expect([...ranks].find(([path]) => path.includes("W23") && path.endsWith("flow.json"))![1].meta.provenance).toEqual(provenance);
  }
  const packed = createPackedWindowBuilder(model.seam.week); packed.absorb(1, "owner", true, 2, raw.weekly["1"]!, new Set(["2026-W23"]));
  const cells = packed.finalize();
  for (const ranked of [packedRepoRankViewsForPeriod(cells, 1, "week", NOW, undefined, undefined), packedOrgRankViewsForPeriod(cells, 1, "week", NOW, new Float64Array(1), undefined, undefined)]) {
    expect([...ranked.views.values()].find((view) => view.meta.metric === "stock")!.items).toEqual([]);
    expect([...ranked.views.values()].find((view) => view.meta.metric === "flow")!.meta.provenance).toEqual(provenance);
  }
  expect(repoEntityFromParts(marked, [], raw.recentDaily["1"]!).entity.curve.provenance).toEqual(provenance);
  expect(slimRankRepoMeta(1, marked).aggregate_history).toEqual(marked.aggregate_history);
  const refreshed = buildMetadataShard({ entries: [{ id: 1, node_id: "R_1", full_name: "owner/repo1", owner: "owner", name: "repo1", stars: 10001 }],
    previous: { "1": marked }, lookup: {}, github: new Map([[1, { ...repo(), current_stars: 10002, description: null, language: null, languages: [], topics: [], is_archived: false }]]), newcomers: new Set(), trackedSince: "2026-10-21", fetchedAt: NOW });
  expect(refreshed["1"]!.aggregate_history).toEqual(marked.aggregate_history);
});
