import { z } from "zod";
import { CATEGORY_ASSIGNMENTS_INDEX_PATH, categoryAssignmentsShardPath } from "@/lib/data/category-assignment-shards";
import { clearViewParseMemo } from "@/lib/data/parse-view";
import { readAuthoritativeView } from "@/lib/data/source";
import type { WorkflowOwnership } from "@/lib/workflows/lease";
import { putOwnedView } from "@/lib/workflows/owned-write";
import { REPO_BUCKETS } from "../buckets";
import { categoryAssignmentShardDocument, categoryAssignmentsIndexDocument, categoryViewsFromAggregates } from "../recompute/categories";
import { loadFullReposBucket, writeVersionAndClear } from "../recompute/io";
import {
  allTimeViewsFromCarry,
  categoryAggregatesFromPartials,
  emptyRestCarry,
  foldRestBucket,
  newcomerViewsFromCarry,
  orgLookupFromCarry,
  type RestBucketPartial,
  type RestCarry,
  type RestNewcomer,
  type RestOrg,
  type RestTopRepo,
} from "../recompute/rest-fold";
import type { OwnerType } from "../recompute/model";

// Rest used to loadCanonicalModel every repo into one isolate. Each hop now
// reads one repos bucket, or finalizes one already-bounded product.

export const REST_INGEST_BUCKETS = REPO_BUCKETS;
export const REST_OFFSET_RANKS = REPO_BUCKETS;
export const REST_OFFSET_LOOKUP = REPO_BUCKETS + 1;
export const REST_OFFSET_SEARCH = REPO_BUCKETS + 2;
export const REST_OFFSET_CATEGORIES = REPO_BUCKETS + 3;

export type RestHopResult = {
  files: number;
  nextRecomputePhase?: "rest";
  nextRecomputeOffset?: number;
};

const UnknownJson = z.unknown();

function restCarryPath(runId: string): string {
  return `ops/workflows/${runId}/recompute/rest-carry.json`;
}

function restPartialPath(runId: string, bucket: number): string {
  return `ops/workflows/${runId}/recompute/rest-part/${bucket}.json`;
}

function isOwnerType(value: unknown): value is OwnerType {
  return value === "User" || value === "Organization";
}

function coerceTop(value: unknown): RestTopRepo[] | null {
  if (!Array.isArray(value)) return null;
  const rows: RestTopRepo[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return null;
    const rec = row as { id?: unknown; stars?: unknown };
    if (typeof rec.id !== "number" || typeof rec.stars !== "number") return null;
    rows.push({ id: rec.id, stars: rec.stars });
  }
  return rows;
}

function coerceNewcomers(value: unknown): Record<string, RestNewcomer[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, RestNewcomer[]> = {};
  for (const [period, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) return null;
    const list: RestNewcomer[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") return null;
      const rec = row as { id?: unknown; stars?: unknown; date?: unknown };
      if (typeof rec.id !== "number" || typeof rec.stars !== "number" || typeof rec.date !== "string") return null;
      list.push({ id: rec.id, stars: rec.stars, date: rec.date });
    }
    out[period] = list;
  }
  return out;
}

function coerceCarry(json: unknown): RestCarry | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as {
    v?: unknown;
    generatedAt?: unknown;
    repoTop?: unknown;
    orgs?: unknown;
    newcomersMonth?: unknown;
    newcomersYear?: unknown;
    doneBuckets?: unknown;
  };
  if (rec.v !== 1 || typeof rec.generatedAt !== "string" || !Array.isArray(rec.orgs) || !Array.isArray(rec.doneBuckets)) {
    return null;
  }
  if (!rec.doneBuckets.every((bucket) => typeof bucket === "number")) return null;
  const repoTop = coerceTop(rec.repoTop);
  const newcomersMonth = coerceNewcomers(rec.newcomersMonth);
  const newcomersYear = coerceNewcomers(rec.newcomersYear);
  if (!repoTop || !newcomersMonth || !newcomersYear) return null;
  const orgs: RestOrg[] = [];
  for (const row of rec.orgs) {
    if (!row || typeof row !== "object") return null;
    const org = row as {
      login?: unknown;
      owner_type?: unknown;
      repo_count?: unknown;
      current_stars_sum?: unknown;
      anchorId?: unknown;
    };
    if (typeof org.login !== "string" || !isOwnerType(org.owner_type)) return null;
    if (typeof org.repo_count !== "number" || typeof org.current_stars_sum !== "number" || typeof org.anchorId !== "number") {
      return null;
    }
    orgs.push({
      login: org.login,
      owner_type: org.owner_type,
      repo_count: org.repo_count,
      current_stars_sum: org.current_stars_sum,
      anchorId: org.anchorId,
    });
  }
  return {
    v: 1,
    generatedAt: rec.generatedAt,
    repoTop,
    orgs,
    newcomersMonth,
    newcomersYear,
    doneBuckets: rec.doneBuckets as number[],
  };
}

function coercePartial(json: unknown): RestBucketPartial | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as RestBucketPartial;
  if (rec.v !== 1 || !rec.lookup || typeof rec.lookup !== "object" || !Array.isArray(rec.search)) return null;
  if (!Array.isArray(rec.active) || !rec.languageLabels || !rec.assignments) return null;
  return rec;
}

async function readCarry(runId: string): Promise<RestCarry | null> {
  const raw = await readAuthoritativeView(restCarryPath(runId), UnknownJson, { bust: runId, skipSchemaParse: true });
  if (raw === null) return null;
  const carry = coerceCarry(raw);
  if (!carry) throw new Error(`${restCarryPath(runId)}: invalid rest carry`);
  return carry;
}

async function readPartial(runId: string, bucket: number): Promise<RestBucketPartial> {
  const path = restPartialPath(runId, bucket);
  const raw = await readAuthoritativeView(path, UnknownJson, { bust: runId, skipSchemaParse: true });
  const partial = coercePartial(raw);
  if (!partial) throw new Error(`${path}: missing rest partial`);
  return partial;
}

async function ingestBucket(
  runId: string,
  owner: WorkflowOwnership,
  bucket: number,
  generatedAt: string,
): Promise<RestHopResult> {
  const existing = await readCarry(runId);
  const carry = existing ?? emptyRestCarry(generatedAt);
  if (carry.doneBuckets.includes(bucket)) {
    return { files: 0, nextRecomputePhase: "rest", nextRecomputeOffset: bucket + 1 };
  }
  const repos = await loadFullReposBucket(runId, bucket);
  const partial = foldRestBucket(carry, repos.values());
  repos.clear();
  clearViewParseMemo();
  await putOwnedView(owner, restPartialPath(runId, bucket), partial);
  carry.doneBuckets = [...carry.doneBuckets, bucket].sort((left, right) => left - right);
  await putOwnedView(owner, restCarryPath(runId), carry);
  const views = new Map<string, unknown>([
    [categoryAssignmentsShardPath(bucket), categoryAssignmentShardDocument(bucket, carry.generatedAt, partial.assignments)],
  ]);
  const files = await writeVersionAndClear(runId, views, owner);
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: bucket + 1 };
}

async function writeRankViews(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const carry = await readCarry(runId);
  if (!carry) throw new Error(`${restCarryPath(runId)}: missing rest carry`);
  const views = new Map<string, unknown>();
  for (const [path, view] of allTimeViewsFromCarry(carry)) views.set(path, view);
  for (const [path, view] of newcomerViewsFromCarry(carry)) views.set(path, view);
  views.set("lookup/orgs.json", orgLookupFromCarry(carry));
  const files = await writeVersionAndClear(runId, views, owner);
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: REST_OFFSET_LOOKUP };
}

async function writeRepoLookup(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const lookup: RestBucketPartial["lookup"] = {};
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const partial = await readPartial(runId, bucket);
    Object.assign(lookup, partial.lookup);
    clearViewParseMemo();
  }
  const files = await writeVersionAndClear(runId, new Map<string, unknown>([["lookup/repos.json", lookup]]), owner);
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: REST_OFFSET_SEARCH };
}

async function writeSearch(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const carry = await readCarry(runId);
  if (!carry) throw new Error(`${restCarryPath(runId)}: missing rest carry`);
  const repos: RestBucketPartial["search"] = [];
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const partial = await readPartial(runId, bucket);
    repos.push(...partial.search);
    clearViewParseMemo();
  }
  repos.sort((left, right) => left.id - right.id);
  const files = await writeVersionAndClear(
    runId,
    new Map<string, unknown>([["search/index.json", { generated_at: carry.generatedAt, count: repos.length, repos }]]),
    owner,
  );
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: REST_OFFSET_CATEGORIES };
}

async function writeCategories(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const carry = await readCarry(runId);
  if (!carry) throw new Error(`${restCarryPath(runId)}: missing rest carry`);
  const counts = new Map<string, number>();
  const languageLabels = new Map<string, string>();
  const members = new Map<string, Array<{ id: number; stars: number }>>();
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const partial = await readPartial(runId, bucket);
    const folded = categoryAggregatesFromPartials([partial]);
    for (const [slug, label] of folded.languageLabels) languageLabels.set(slug, label);
    for (const [category, count] of folded.counts) counts.set(category, (counts.get(category) ?? 0) + count);
    for (const [category, rows] of folded.members) {
      const list = members.get(category) ?? [];
      list.push(...rows);
      members.set(category, list);
    }
    clearViewParseMemo();
  }
  const views = categoryViewsFromAggregates(carry.generatedAt, counts, languageLabels, members);
  views.set(CATEGORY_ASSIGNMENTS_INDEX_PATH, categoryAssignmentsIndexDocument(carry.generatedAt));
  const files = await writeVersionAndClear(runId, views, owner);
  return { files };
}

export async function runRestRankHop(
  runId: string,
  owner: WorkflowOwnership,
  offset: number,
  generatedAt: string,
): Promise<RestHopResult> {
  if (offset < REST_INGEST_BUCKETS) return ingestBucket(runId, owner, offset, generatedAt);
  if (offset === REST_OFFSET_RANKS) return writeRankViews(runId, owner);
  if (offset === REST_OFFSET_LOOKUP) return writeRepoLookup(runId, owner);
  if (offset === REST_OFFSET_SEARCH) return writeSearch(runId, owner);
  if (offset === REST_OFFSET_CATEGORIES) return writeCategories(runId, owner);
  return { files: 0 };
}
