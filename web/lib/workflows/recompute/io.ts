import { z } from "zod";
import {
  CategoryAssignmentsDocument,
  CategoryAssignmentsShard,
  OrgEntity,
  RepoEntity,
} from "@/lib/contracts";
import { mapLimit } from "@/lib/data/map-limit";
import { clearViewParseMemo } from "@/lib/data/parse-view";
import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import { isCloudflareWorkersHost } from "@/lib/runtime-config";
import { assertPublishedViewJsonSize } from "@/lib/view-size";
import {
  CanonicalMeta,
  ReposShard,
  RepoMonthlyShard,
  RepoWeeklyShard,
  RepoRecentDailyShard,
  SiteDaily,
} from "@/lib/contracts";
import { getWriteObjectStore } from "@/lib/storage";
import { canonicalShardReadConcurrency } from "@/lib/workflows/canonical-validation";
import { REPO_BUCKETS } from "../buckets";
import { assembleModel, normalizeRepoMeta, seamPeriods, type DailySeries, type Model, type OwnerType, type RepoMeta, type Series } from "./model";
import { putOwnedView, workflowHeartbeat } from "@/lib/workflows/owned-write";
import type { WorkflowOwnership } from "@/lib/workflows/lease";
import {
  absorbOrgPeriodRowsFromBucket,
  appendRepoPeriodRowsFromBucket,
  coercePackedWindowBucket,
  coercePackedWindowMeta,
  createPackedWindowAssembler,
  createPackedWindowBuilder,
  orgRowsFromAbsorbed,
  packedBucketFile,
  packedMetaFile,
  packedWindowAsFlatBucket,
  packedWindowBucketPath,
  packedWindowMetaPath,
  type PackedPeriodOrgRow,
  type PackedPeriodRepoRow,
  type PackedRepoWindow,
  type PackedWindowKind,
  type PackedWindowMetaFile,
} from "./packed-window";

// Blob I/O for the recompute steps: load the canonical/v2 model and write a versioned
// view set (views/<run_id>/**). Reads bust Blob's short cache with the run id so a step
// sees the canonical shards written earlier in the same run. See VERCEL-DATA-OPERATIONS §3/§7.

const UnknownJson = z.unknown();
const WRITE_PER_SEC = 60; // Blob write-rate budget (OPS §Blob)
const WRITE_CONCURRENCY = 12;
/** Tighter write pool on OpenNext — each Blob PUT also does an ASSETS cache GET. */
export const WRITE_CONCURRENCY_CF = 4;
const SITE_YEAR_MIN = 2010;

export const CANONICAL_MODEL_FAMILIES = ["repos", "monthly", "weekly", "recentDaily", "siteDaily"] as const;
export type CanonicalModelFamily = (typeof CANONICAL_MODEL_FAMILIES)[number];

export type LoadCanonicalModelOptions = {
  families?: readonly CanonicalModelFamily[];
};

export function canonicalModelLoadPlan(env?: Parameters<typeof isCloudflareWorkersHost>[0]): {
  shardConcurrency: number;
  parallelFamilies: boolean;
  writeConcurrency: number;
} {
  const cf = isCloudflareWorkersHost(env);
  return {
    // CF recompute hops hold one shard JSON at a time. Weekly family is ~33 MiB;
    // concurrency 2 plus Zod clones is what OOM'd after fold.json.
    shardConcurrency: cf ? 1 : canonicalShardReadConcurrency(env),
    parallelFamilies: !cf,
    writeConcurrency: cf ? WRITE_CONCURRENCY_CF : WRITE_CONCURRENCY,
  };
}

export function wantedCanonicalFamilies(opts?: LoadCanonicalModelOptions): Set<CanonicalModelFamily> {
  return new Set(opts?.families ?? CANONICAL_MODEL_FAMILIES);
}

export type LoadedPackedWindow = {
  packed: PackedRepoWindow;
  seamDate: string;
  foldedThrough: { month: string; week: string };
  kind: PackedWindowKind;
  fromPersist: boolean;
};

export type LoadPackedWindowOptions = {
  owner?: WorkflowOwnership;
  persist?: boolean;
};

/** Rank hops only need identity + d + milestones. Drop description/languages/topics. */
export function slimRankRepoMeta(id: number, value: unknown): RepoMeta {
  if (!value || typeof value !== "object") {
    throw new Error(`canonical/v2/repos: repo ${id} is not an object`);
  }
  const raw = value as Record<string, unknown>;
  const ownerType: OwnerType = raw.owner_type === "Organization" ? "Organization" : "User";
  const owner = String(raw.owner ?? "");
  const name = String(raw.name ?? `r${id}`);
  return normalizeRepoMeta(id, {
    id,
    owner,
    owner_type: ownerType,
    name,
    full_name: String(raw.full_name ?? `${owner || "unknown"}/${name}`),
    current_stars: typeof raw.current_stars === "number" ? raw.current_stars : Number(raw.current_stars ?? 0),
    active: raw.active === false ? false : true,
    d: raw.d as number,
    created_at: typeof raw.created_at === "string" ? raw.created_at : undefined,
    crossed_10k: raw.crossed_10k === null || typeof raw.crossed_10k === "string" ? raw.crossed_10k : undefined,
    crossed_50k: raw.crossed_50k === null || typeof raw.crossed_50k === "string" ? raw.crossed_50k : undefined,
    crossed_100k: raw.crossed_100k === null || typeof raw.crossed_100k === "string" ? raw.crossed_100k : undefined,
    tracked_since: raw.tracked_since === null || typeof raw.tracked_since === "string" ? raw.tracked_since : undefined,
  });
}

function asSeries(value: unknown): Series {
  return Array.isArray(value) ? (value as Series) : [];
}

export async function persistPackedWindow(
  runId: string,
  kind: PackedWindowKind,
  seamPeriod: string,
  packed: PackedRepoWindow,
  owner: WorkflowOwnership,
): Promise<void> {
  const heartbeat = workflowHeartbeat(owner);
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    await heartbeat();
    await putOwnedView(owner, packedWindowBucketPath(runId, kind, bucket), packedBucketFile(packed, bucket, REPO_BUCKETS));
    clearViewParseMemo();
  }
  await heartbeat();
  await putOwnedView(owner, packedWindowMetaPath(runId, kind), packedMetaFile(kind, seamPeriod, packed, REPO_BUCKETS));
}

export async function readPackedWindowMeta(bust: string, kind: PackedWindowKind): Promise<PackedWindowMetaFile | null> {
  const rawMeta = await readAuthoritativeView(packedWindowMetaPath(bust, kind), UnknownJson, {
    bust,
    skipSchemaParse: true,
  });
  const meta = coercePackedWindowMeta(rawMeta);
  if (!meta || meta.kind !== kind || meta.buckets !== REPO_BUCKETS) return null;
  return meta;
}

export async function readPersistedPackedWindow(
  bust: string,
  kind: PackedWindowKind,
): Promise<PackedRepoWindow | null> {
  const meta = await readPackedWindowMeta(bust, kind);
  if (!meta) return null;
  const assembler = createPackedWindowAssembler(meta);
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const raw = await readAuthoritativeView(packedWindowBucketPath(bust, kind, bucket), UnknownJson, {
      bust,
      skipSchemaParse: true,
    });
    const shard = coercePackedWindowBucket(raw);
    if (!shard) return null;
    assembler.absorb(shard);
    clearViewParseMemo();
  }
  return assembler.finalize();
}

async function buildPackedWindowFromShards(
  bust: string,
  kind: PackedWindowKind,
  seamPeriod: string,
  owner?: WorkflowOwnership,
): Promise<PackedRepoWindow> {
  const skipSchemaParse = isCloudflareWorkersHost();
  const heartbeat = owner ? workflowHeartbeat(owner) : async () => {};
  const builder = createPackedWindowBuilder(seamPeriod);
  const seriesKind = kind === "week" ? "repo-weekly" : "repo-monthly";
  const seriesSchema = kind === "week" ? RepoWeeklyShard : RepoMonthlyShard;
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    await heartbeat();
    const reposPath = `canonical/v2/repos/${bucket}.json`;
    const seriesPath = `canonical/v2/${seriesKind}/${bucket}.json`;
    const reposShard = await readAuthoritativeView(reposPath, ReposShard, { bust, skipSchemaParse });
    if (reposShard === null) throw new Error(`${reposPath}: missing required shard`);
    const seriesShard = await readAuthoritativeView(seriesPath, seriesSchema, { bust, skipSchemaParse });
    if (seriesShard === null) throw new Error(`${seriesPath}: missing required shard`);
    const slim = new Map<number, RepoMeta>();
    for (const [key, value] of Object.entries(reposShard)) {
      const id = Number(key);
      slim.set(id, slimRankRepoMeta(id, value));
    }
    for (const [key, value] of Object.entries(seriesShard)) {
      const id = Number(key);
      const meta = slim.get(id);
      if (!meta) {
        throw new Error(`${seriesPath}: repo ${id} missing from ${reposPath}`);
      }
      builder.absorb(id, meta.owner, meta.active !== false, meta.d, asSeries(value));
    }
    slim.clear();
    clearViewParseMemo();
  }
  return builder.finalize();
}

/** Stream one repo-bucket pair at a time into a packed window. Prefer a completed persist. */
export async function loadPackedRepoWindow(
  bust: string,
  kind: PackedWindowKind,
  opts: LoadPackedWindowOptions = {},
): Promise<LoadedPackedWindow> {
  const meta = await readRequiredView("canonical/v2/meta.json", CanonicalMeta, { bust });
  const seamPeriod = seamPeriods(meta.seam_date)[kind];
  const persisted = await readPersistedPackedWindow(bust, kind);
  if (persisted) {
    return {
      packed: persisted,
      seamDate: meta.seam_date,
      foldedThrough: meta.folded_through,
      kind,
      fromPersist: true,
    };
  }
  const packed = await buildPackedWindowFromShards(bust, kind, seamPeriod, opts.owner);
  if (opts.persist && opts.owner) {
    await persistPackedWindow(bust, kind, seamPeriod, packed, opts.owner);
  }
  return {
    packed,
    seamDate: meta.seam_date,
    foldedThrough: meta.folded_through,
    kind,
    fromPersist: false,
  };
}

export function collectPeriodsFromSeriesShard(shard: unknown, into: Set<string>): void {
  if (!shard || typeof shard !== "object") return;
  for (const value of Object.values(shard as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const cell of value) {
      if (Array.isArray(cell) && typeof cell[0] === "string" && typeof cell[1] === "number") into.add(cell[0]);
    }
  }
}

export async function collectSeriesPeriods(bust: string, kind: PackedWindowKind): Promise<string[]> {
  const skipSchemaParse = isCloudflareWorkersHost();
  const seriesKind = kind === "week" ? "repo-weekly" : "repo-monthly";
  const seriesSchema = kind === "week" ? RepoWeeklyShard : RepoMonthlyShard;
  const periods = new Set<string>();
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const seriesPath = `canonical/v2/${seriesKind}/${bucket}.json`;
    const seriesShard = await readAuthoritativeView(seriesPath, seriesSchema, { bust, skipSchemaParse });
    if (seriesShard === null) throw new Error(`${seriesPath}: missing required shard`);
    collectPeriodsFromSeriesShard(seriesShard, periods);
    clearViewParseMemo();
  }
  return [...periods].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function packOneSeriesBucket(
  bust: string,
  kind: PackedWindowKind,
  seamPeriod: string,
  periods: readonly string[],
  bucket: number,
): Promise<PackedRepoWindow> {
  const skipSchemaParse = isCloudflareWorkersHost();
  const seriesKind = kind === "week" ? "repo-weekly" : "repo-monthly";
  const seriesSchema = kind === "week" ? RepoWeeklyShard : RepoMonthlyShard;
  const reposPath = `canonical/v2/repos/${bucket}.json`;
  const seriesPath = `canonical/v2/${seriesKind}/${bucket}.json`;
  const reposShard = await readAuthoritativeView(reposPath, ReposShard, { bust, skipSchemaParse });
  if (reposShard === null) throw new Error(`${reposPath}: missing required shard`);
  const seriesShard = await readAuthoritativeView(seriesPath, seriesSchema, { bust, skipSchemaParse });
  if (seriesShard === null) throw new Error(`${seriesPath}: missing required shard`);
  const builder = createPackedWindowBuilder(seamPeriod, periods);
  const slim = new Map<number, RepoMeta>();
  for (const [key, value] of Object.entries(reposShard)) {
    const id = Number(key);
    slim.set(id, slimRankRepoMeta(id, value));
  }
  for (const [key, value] of Object.entries(seriesShard)) {
    const id = Number(key);
    const meta = slim.get(id);
    if (!meta) {
      throw new Error(`${seriesPath}: repo ${id} missing from ${reposPath}`);
    }
    builder.absorb(id, meta.owner, meta.active !== false, meta.d, asSeries(value));
  }
  slim.clear();
  clearViewParseMemo();
  return builder.finalize();
}

/** Pack and persist one repo-bucket at a time. Never assemble the full week window. */
export async function persistPackedWindowIncrementally(
  bust: string,
  kind: PackedWindowKind,
  owner: WorkflowOwnership,
): Promise<PackedWindowMetaFile> {
  const canonical = await readRequiredView("canonical/v2/meta.json", CanonicalMeta, { bust });
  const seamPeriod = seamPeriods(canonical.seam_date)[kind];
  const periods = await collectSeriesPeriods(bust, kind);
  const heartbeat = workflowHeartbeat(owner);
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    await heartbeat();
    const packed = await packOneSeriesBucket(bust, kind, seamPeriod, periods, bucket);
    await putOwnedView(owner, packedWindowBucketPath(bust, kind, bucket), packedWindowAsFlatBucket(packed));
    clearViewParseMemo();
  }
  const meta = packedMetaFile(kind, seamPeriod, { periods }, REPO_BUCKETS);
  await heartbeat();
  await putOwnedView(owner, packedWindowMetaPath(bust, kind), meta);
  return meta;
}

export async function ensurePackedWindowPersisted(
  bust: string,
  kind: PackedWindowKind,
  owner: WorkflowOwnership,
): Promise<PackedWindowMetaFile> {
  const existing = await readPackedWindowMeta(bust, kind);
  if (existing) return existing;
  return persistPackedWindowIncrementally(bust, kind, owner);
}

export async function streamPackedRepoPeriodRows(
  bust: string,
  kind: PackedWindowKind,
  periodFrom: number,
  periodTo: number,
  owner?: WorkflowOwnership,
): Promise<PackedPeriodRepoRow[][]> {
  const into = Array.from({ length: Math.max(0, periodTo - periodFrom) }, () => [] as PackedPeriodRepoRow[]);
  if (into.length === 0) return into;
  const heartbeat = owner ? workflowHeartbeat(owner) : async () => {};
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    await heartbeat();
    const raw = await readAuthoritativeView(packedWindowBucketPath(bust, kind, bucket), UnknownJson, {
      bust,
      skipSchemaParse: true,
    });
    const shard = coercePackedWindowBucket(raw);
    if (!shard) throw new Error(`${packedWindowBucketPath(bust, kind, bucket)}: missing persist shard`);
    appendRepoPeriodRowsFromBucket(shard, periodFrom, periodTo, into);
    clearViewParseMemo();
  }
  return into;
}

export async function streamPackedOrgPeriodRows(
  bust: string,
  kind: PackedWindowKind,
  periodFrom: number,
  periodTo: number,
  carry: Map<number, number>,
  owner?: WorkflowOwnership,
): Promise<PackedPeriodOrgRow[][]> {
  const acc = Array.from({ length: Math.max(0, periodTo - periodFrom) }, () => new Map<string, { flow: number; stock_est: number }>());
  if (acc.length === 0) return [];
  const heartbeat = owner ? workflowHeartbeat(owner) : async () => {};
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    await heartbeat();
    const raw = await readAuthoritativeView(packedWindowBucketPath(bust, kind, bucket), UnknownJson, {
      bust,
      skipSchemaParse: true,
    });
    const shard = coercePackedWindowBucket(raw);
    if (!shard) throw new Error(`${packedWindowBucketPath(bust, kind, bucket)}: missing persist shard`);
    absorbOrgPeriodRowsFromBucket(shard, periodFrom, periodTo, carry, acc);
    clearViewParseMemo();
  }
  return acc.map(orgRowsFromAbsorbed);
}

export type RankCarryFile = {
  v: 1;
  kind: PackedWindowKind;
  dim: "repo" | "org";
  nextPeriod: number;
  flow: Array<[string, number]>;
  stock: Array<[string, number]>;
  orgStock?: Array<[number, number]>;
};

export function rankCarryPath(runId: string, kind: PackedWindowKind, dim: "repo" | "org"): string {
  return `ops/workflows/${runId}/recompute/${kind}-${dim}-carry.json`;
}

function coerceRankCarry(json: unknown, kind: PackedWindowKind, dim: "repo" | "org"): RankCarryFile | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as {
    v?: unknown;
    kind?: unknown;
    dim?: unknown;
    nextPeriod?: unknown;
    flow?: unknown;
    stock?: unknown;
    orgStock?: unknown;
  };
  if (rec.v !== 1 || rec.kind !== kind || rec.dim !== dim || typeof rec.nextPeriod !== "number") return null;
  if (!Array.isArray(rec.flow) || !Array.isArray(rec.stock)) return null;
  const flow: Array<[string, number]> = [];
  const stock: Array<[string, number]> = [];
  for (const row of rec.flow) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "number") return null;
    flow.push([row[0], row[1]]);
  }
  for (const row of rec.stock) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "number") return null;
    stock.push([row[0], row[1]]);
  }
  let orgStock: Array<[number, number]> | undefined;
  if (rec.orgStock !== undefined) {
    if (!Array.isArray(rec.orgStock)) return null;
    orgStock = [];
    for (const row of rec.orgStock) {
      if (!Array.isArray(row) || typeof row[0] !== "number" || typeof row[1] !== "number") return null;
      orgStock.push([row[0], row[1]]);
    }
  }
  return { v: 1, kind, dim, nextPeriod: rec.nextPeriod, flow, stock, orgStock };
}

export async function readRankCarry(
  runId: string,
  kind: PackedWindowKind,
  dim: "repo" | "org",
): Promise<RankCarryFile | null> {
  const raw = await readAuthoritativeView(rankCarryPath(runId, kind, dim), UnknownJson, {
    bust: runId,
    skipSchemaParse: true,
  });
  return coerceRankCarry(raw, kind, dim);
}

export async function writeRankCarry(owner: WorkflowOwnership, carry: RankCarryFile): Promise<void> {
  await putOwnedView(owner, rankCarryPath(owner.runId, carry.kind, carry.dim), carry);
}

export function pairsToRankMap(pairs: Array<[string, number]> | undefined): Map<string, number> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  return new Map(pairs);
}

export function orgStockToMap(pairs: Array<[number, number]> | undefined): Map<number, number> {
  return new Map(pairs ?? []);
}

export async function loadFullReposBucket(bust: string, bucket: number): Promise<Map<number, RepoMeta>> {
  const skipSchemaParse = isCloudflareWorkersHost();
  const path = `canonical/v2/repos/${bucket}.json`;
  const shard = await readAuthoritativeView(path, ReposShard, { bust, skipSchemaParse });
  if (shard === null) throw new Error(`${path}: missing required shard`);
  const out = new Map<number, RepoMeta>();
  for (const [key, value] of Object.entries(shard)) {
    const id = Number(key);
    out.set(id, normalizeRepoMeta(id, value as unknown as RepoMeta));
  }
  return out;
}

export async function loadRecentDailyBucket(bust: string, bucket: number): Promise<Map<number, DailySeries>> {
  const skipSchemaParse = isCloudflareWorkersHost();
  const path = `canonical/v2/repo-recent-daily/${bucket}.json`;
  const shard = await readAuthoritativeView(path, RepoRecentDailyShard, { bust, skipSchemaParse });
  if (shard === null) throw new Error(`${path}: missing required shard`);
  const out = new Map<number, DailySeries>();
  for (const [key, value] of Object.entries(shard)) {
    out.set(Number(key), (value as DailySeries) ?? []);
  }
  return out;
}

async function absorbIdShards<T extends Record<string, unknown>>(
  kind: string,
  schema: Parameters<typeof readAuthoritativeView<T>>[1],
  bust: string,
  shardConcurrency: number,
  skipSchemaParse: boolean,
  mapValue: (id: number, value: T[string]) => T[string],
): Promise<Map<number, T[string]>> {
  const out = new Map<number, T[string]>();
  const missing: number[] = [];
  await mapLimit(
    Array.from({ length: REPO_BUCKETS }, (_, bucket) => bucket),
    shardConcurrency,
    async (bucket) => {
      const path = `canonical/v2/${kind}/${bucket}.json`;
      try {
        const shard = await readAuthoritativeView(path, schema, { bust, skipSchemaParse });
        if (shard === null) {
          missing.push(bucket);
          return;
        }
        for (const [key, value] of Object.entries(shard)) {
          const id = Number(key);
          out.set(id, mapValue(id, value as T[string]));
        }
      } catch (error) {
        throw new Error(`${path}: schema/read failure — ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    },
  );
  if (missing.length > 0) {
    missing.sort((left, right) => left - right);
    throw new Error(`canonical/v2/${kind}: missing required shard(s) ${missing.join(",")}`);
  }
  return out;
}

export function mergeCompleteBucketShards<T extends Record<string, unknown>>(
  kind: string,
  shards: Array<T | null>,
): Record<string, T[string]> {
  const missing = shards.flatMap((shard, bucket) => (shard === null ? [bucket] : []));
  if (missing.length > 0) {
    throw new Error(`canonical/v2/${kind}: missing required shard(s) ${missing.join(",")}`);
  }
  const out: Record<string, unknown> = {};
  for (const shard of shards) Object.assign(out, shard);
  return out as Record<string, T[string]>;
}

export interface LoadedModel {
  model: Model;
  seamDate: string;
  foldedThrough: { month: string; week: string };
}

function identitySeries<T>(_id: number, value: T): T {
  return value;
}

/** Load selected canonical families into Maps. CF hops omit unused families (weekly is ~33 MiB). */
export async function loadCanonicalModel(bust: string, opts?: LoadCanonicalModelOptions): Promise<LoadedModel> {
  const meta = await readRequiredView("canonical/v2/meta.json", CanonicalMeta, { bust });
  const plan = canonicalModelLoadPlan();
  const wanted = wantedCanonicalFamilies(opts);
  const skipSchemaParse = isCloudflareWorkersHost();

  const loadRepos = async (): Promise<Map<number, RepoMeta>> => {
    const raw = await absorbIdShards("repos", ReposShard, bust, plan.shardConcurrency, skipSchemaParse, identitySeries);
    const repos = new Map<number, RepoMeta>();
    for (const [id, value] of raw) repos.set(id, normalizeRepoMeta(id, value as unknown as RepoMeta));
    return repos;
  };
  const loadMonthly = () =>
    absorbIdShards("repo-monthly", RepoMonthlyShard, bust, plan.shardConcurrency, skipSchemaParse, identitySeries) as Promise<
      Map<number, Series>
    >;
  const loadWeekly = () =>
    absorbIdShards("repo-weekly", RepoWeeklyShard, bust, plan.shardConcurrency, skipSchemaParse, identitySeries) as Promise<
      Map<number, Series>
    >;
  const loadRecent = () =>
    absorbIdShards(
      "repo-recent-daily",
      RepoRecentDailyShard,
      bust,
      plan.shardConcurrency,
      skipSchemaParse,
      identitySeries,
    ) as Promise<Map<number, DailySeries>>;
  const loadSite = async (): Promise<DailySeries> => {
    const thisYear = new Date().getUTCFullYear() + 1;
    const years = Array.from({ length: thisYear - SITE_YEAR_MIN + 1 }, (_, i) => String(SITE_YEAR_MIN + i));
    const siteShards = await mapLimit(years, plan.shardConcurrency, (year) =>
      readAuthoritativeView(`canonical/v2/site-daily/${year}.json`, SiteDaily, { bust, skipSchemaParse }),
    );
    const cells: Array<readonly [string, number]> = [];
    for (const shard of siteShards) if (shard) cells.push(...shard.cells);
    cells.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    return cells;
  };

  let repos = new Map<number, RepoMeta>();
  let monthly = new Map<number, Series>();
  let weekly = new Map<number, Series>();
  let recentDaily = new Map<number, DailySeries>();
  let siteDaily: DailySeries = [];

  const jobs: Array<Promise<void>> = [];
  const take = (job: Promise<void>) => {
    if (plan.parallelFamilies) jobs.push(job);
    return job;
  };

  if (wanted.has("repos")) {
    const job = loadRepos().then((value) => {
      repos = value;
    });
    if (!plan.parallelFamilies) await job;
    else take(job);
  }
  if (wanted.has("monthly")) {
    const job = loadMonthly().then((value) => {
      monthly = value;
    });
    if (!plan.parallelFamilies) await job;
    else take(job);
  }
  if (wanted.has("weekly")) {
    const job = loadWeekly().then((value) => {
      weekly = value;
    });
    if (!plan.parallelFamilies) await job;
    else take(job);
  }
  if (wanted.has("recentDaily")) {
    const job = loadRecent().then((value) => {
      recentDaily = value;
    });
    if (!plan.parallelFamilies) await job;
    else take(job);
  }
  if (wanted.has("siteDaily")) {
    const job = loadSite().then((value) => {
      siteDaily = value;
    });
    if (!plan.parallelFamilies) await job;
    else take(job);
  }
  if (jobs.length > 0) await Promise.all(jobs);

  return {
    model: assembleModel(repos, monthly, weekly, recentDaily, siteDaily, meta.seam_date),
    seamDate: meta.seam_date,
    foldedThrough: meta.folded_through,
  };
}

export const ENTITY_WRITE_CHUNK = 32;

export async function writeVersionChunks(
  runId: string,
  entries: Iterable<readonly [string, unknown]>,
  owner?: WorkflowOwnership,
  chunkSize = ENTITY_WRITE_CHUNK,
): Promise<number> {
  const batch = new Map<string, unknown>();
  let files = 0;
  for (const [path, view] of entries) {
    batch.set(path, view);
    if (batch.size >= chunkSize) {
      files += await writeVersion(runId, batch, owner);
      batch.clear();
    }
  }
  if (batch.size > 0) files += await writeVersion(runId, batch, owner);
  return files;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write a view map under views/<run_id>/** with a concurrency pool + write-rate gate. */
export async function writeVersion(runId: string, views: Map<string, unknown>, owner?: WorkflowOwnership): Promise<number> {
  const store = getWriteObjectStore();
  const items = [...views.entries()];
  let i = 0;
  let nextStart = 0;
  const heartbeat = owner ? workflowHeartbeat(owner) : async () => {};
  const gate = async () => {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + 1000 / WRITE_PER_SEC;
    if (wait > 0) await sleep(wait);
  };
  async function worker() {
    while (i < items.length) {
      const [rel, obj] = items[i++];
      await heartbeat();
      await gate();
      assertGeneratedView(rel, obj);
      const payload = JSON.stringify(obj);
      assertPublishedViewJsonSize(rel, payload);
      await store.put(`views/${runId}/${rel}`, payload, {
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 31536000, // versioned path is immutable → cache hard
      });
    }
  }
  await Promise.all(Array.from({ length: canonicalModelLoadPlan().writeConcurrency }, worker));
  return items.length;
}

export async function writeVersionAndClear(
  runId: string,
  views: Map<string, unknown>,
  owner?: WorkflowOwnership,
): Promise<number> {
  if (views.size === 0) return 0;
  const files = await writeVersion(runId, views, owner);
  views.clear();
  return files;
}

function assertGeneratedView(rel: string, obj: unknown): void {
  const schema = rel.startsWith("entity/repo/")
    ? RepoEntity
    : rel.startsWith("entity/org/")
      ? OrgEntity
      : rel === "categories/assignments.json"
        ? CategoryAssignmentsDocument
        : /^categories\/assignments\/shards\/\d+\.json$/.test(rel)
          ? CategoryAssignmentsShard
          : null;
  if (!schema) return;
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(`${rel}: schema — ${parsed.error.message}`);
  }
}
