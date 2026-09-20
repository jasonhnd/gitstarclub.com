import {
  CategoryAssignmentsDocument,
  CategoryAssignmentsShard,
  OrgEntity,
  RepoEntity,
} from "@/lib/contracts";
import { mapLimit } from "@/lib/data/map-limit";
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
import { assembleModel, normalizeRepoMeta, type DailySeries, type Model, type RepoMeta, type Series } from "./model";
import { workflowHeartbeat } from "@/lib/workflows/owned-write";
import type { WorkflowOwnership } from "@/lib/workflows/lease";

// Blob I/O for the recompute steps: load the canonical/v2 model and write a versioned
// view set (views/<run_id>/**). Reads bust Blob's short cache with the run id so a step
// sees the canonical shards written earlier in the same run. See VERCEL-DATA-OPERATIONS §3/§7.

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
