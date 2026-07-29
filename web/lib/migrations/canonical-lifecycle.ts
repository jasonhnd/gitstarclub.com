import { z } from "zod";
import {
  PublishedWhitelist,
  ReposLookup,
  ReposShard,
  ViewsPointer,
  WhitelistSnapshot,
  type PublishedWhitelist as PublishedWhitelistType,
  type ReposLookup as ReposLookupType,
  type ReposShard as ReposShardType,
  type ViewsPointer as ViewsPointerType,
  type WhitelistSnapshot as WhitelistSnapshotType,
} from "@/lib/contracts";
import { REPO_BUCKETS, repoBucket } from "@/lib/workflows/buckets";

const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const Bucket = z.number().int().min(0).max(REPO_BUCKETS - 1);
const RepoId = z.number().int().nonnegative();
const WhitelistPath = z.string().regex(/^canonical\/v2\/whitelist\/[^/]+\.json$/);

export const CanonicalLifecycleHistorySource = z
  .object({
    path: WhitelistPath,
    run_id: z.string().min(1),
    generated_at: z.iso.datetime(),
    sha256: SHA256,
  })
  .strict();
export type CanonicalLifecycleHistorySource = z.infer<typeof CanonicalLifecycleHistorySource>;

export const CanonicalLifecycleHistoryInventory = z
  .object({
    schema_ver: z.literal(1),
    issue: z.literal(326),
    expected_bootstrap_generation: z.string().min(1).nullable(),
    snapshots: z.array(CanonicalLifecycleHistorySource).min(1),
  })
  .strict();
export type CanonicalLifecycleHistoryInventory = z.infer<typeof CanonicalLifecycleHistoryInventory>;

const TrackedSinceRecovery = z
  .object({
    id: RepoId,
    tracked_since: z.iso.date(),
  })
  .strict();

export const CanonicalLifecycleMigrationBucketPlan = z
  .object({
    bucket: Bucket,
    path: z.string().regex(/^canonical\/v2\/repos\/(?:[0-9]|[12][0-9]|3[01])\.json$/),
    records: z.number().int().nonnegative(),
    before_sha256: SHA256,
    after_sha256: SHA256,
    changed_repositories: z.number().int().nonnegative(),
    changed_ids: z.array(RepoId),
    active_true: z.number().int().nonnegative(),
    active_false: z.number().int().nonnegative(),
    active_changes: z.number().int().nonnegative(),
    tracked_since_recoveries: z.array(TrackedSinceRecovery),
    tracked_since_null_materialized: z.array(RepoId),
  })
  .strict();
export type CanonicalLifecycleMigrationBucketPlan = z.infer<typeof CanonicalLifecycleMigrationBucketPlan>;

export const CanonicalLifecycleMigrationPlan = z
  .object({
    schema_ver: z.literal(1),
    issue: z.literal(326),
    operation: z.literal("canonical-lifecycle-provenance"),
    source: z
      .object({
        bootstrap_generation: z.string().min(1).nullable(),
        bootstrap_pointer_sha256: SHA256.nullable(),
        views_pointer: ViewsPointer,
        views_pointer_sha256: SHA256,
        published_whitelist_pointer_path: z.literal("canonical/v2/whitelist/latest.json"),
        published_whitelist_pointer_sha256: SHA256,
        published_whitelist_path: WhitelistPath,
        published_whitelist_sha256: SHA256,
        bootstrap_lookup_path: z.literal("lookup/repos.json"),
        bootstrap_lookup_sha256: SHA256,
        history: z.array(CanonicalLifecycleHistorySource).min(1),
      })
      .strict(),
    counts: z
      .object({
        canonical_repositories: z.number().int().nonnegative(),
        bootstrap_repositories: z.number().int().nonnegative(),
        published_whitelist_repositories: z.number().int().nonnegative(),
        active_true: z.number().int().nonnegative(),
        active_false: z.number().int().nonnegative(),
        active_changes: z.number().int().nonnegative(),
        tracked_since_recovered: z.number().int().nonnegative(),
        tracked_since_null_materialized: z.number().int().nonnegative(),
        anchors_preserved: z.number().int().nonnegative(),
        anchors_invented: z.literal(0),
        changed_repositories: z.number().int().nonnegative(),
        changed_buckets: z.number().int().min(0).max(REPO_BUCKETS),
      })
      .strict(),
    buckets: z.array(CanonicalLifecycleMigrationBucketPlan).length(REPO_BUCKETS),
  })
  .strict();
export type CanonicalLifecycleMigrationPlan = z.infer<typeof CanonicalLifecycleMigrationPlan>;

export const CanonicalLifecycleMigrationReceipt = z
  .object({
    schema_ver: z.literal(1),
    operation: z.literal("canonical-lifecycle-provenance"),
    plan_sha256: SHA256,
    plan: CanonicalLifecycleMigrationPlan,
  })
  .strict();
export type CanonicalLifecycleMigrationReceipt = z.infer<typeof CanonicalLifecycleMigrationReceipt>;

export interface LoadedCanonicalRepoShard {
  bucket: number;
  path: string;
  value: ReposShardType;
  sha256: string;
}

export interface LoadedWhitelistHistorySnapshot {
  source: CanonicalLifecycleHistorySource;
  value: WhitelistSnapshotType;
}

export interface CanonicalLifecycleMigrationInput {
  inventory: CanonicalLifecycleHistoryInventory;
  bootstrapGeneration: string | null;
  bootstrapPointerSha256: string | null;
  viewsPointer: ViewsPointerType;
  viewsPointerSha256: string;
  publishedWhitelistPointer: PublishedWhitelistType;
  publishedWhitelistPointerSha256: string;
  bootstrapLookup: ReposLookupType;
  bootstrapLookupSha256: string;
  repoShards: LoadedCanonicalRepoShard[];
  history: LoadedWhitelistHistorySnapshot[];
}

export interface CanonicalLifecycleMigrationBundle {
  plan: CanonicalLifecycleMigrationPlan;
  planSha256: string;
  before: LoadedCanonicalRepoShard[];
  after: LoadedCanonicalRepoShard[];
}

export class CanonicalLifecycleMigrationError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CanonicalLifecycleMigrationError";
    this.details = details;
  }
}

/** Canonical JSON used for source, plan, and receipt digests. */
export function stableJson(value: unknown): string {
  if (value === undefined) throw new Error("stable JSON does not accept undefined");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export async function sha256Json(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSha(label: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new CanonicalLifecycleMigrationError(`${label} SHA-256 changed`, { expected, actual });
  }
}

function numericIdSort(a: number, b: number): number {
  return a - b;
}

function sourceSort(
  a: LoadedWhitelistHistorySnapshot,
  b: LoadedWhitelistHistorySnapshot,
): number {
  return (
    a.value.generated_at.localeCompare(b.value.generated_at) ||
    a.value.run_id.localeCompare(b.value.run_id)
  );
}

function uniqueNumericIds(ids: number[], label: string): Set<number> {
  const set = new Set(ids);
  if (set.size !== ids.length) {
    throw new CanonicalLifecycleMigrationError(`${label} contains duplicate repository ids`);
  }
  return set;
}

function historySourceByRun(
  history: LoadedWhitelistHistorySnapshot[],
): Map<string, LoadedWhitelistHistorySnapshot> {
  const result = new Map<string, LoadedWhitelistHistorySnapshot>();
  for (const loaded of history) {
    if (result.has(loaded.value.run_id)) {
      throw new CanonicalLifecycleMigrationError(
        `duplicate whitelist history run ${loaded.value.run_id}`,
      );
    }
    result.set(loaded.value.run_id, loaded);
  }
  return result;
}

function canonicalRepoIds(repoShards: LoadedCanonicalRepoShard[]): Set<number> {
  const ids = new Set<number>();
  for (const loaded of repoShards) {
    for (const [key, repo] of Object.entries(loaded.value)) {
      const id = Number(key);
      if (!Number.isSafeInteger(id) || id < 0 || repo.id !== id) {
        throw new CanonicalLifecycleMigrationError(
          `${loaded.path}: repository key ${key} does not match its id`,
        );
      }
      if (repoBucket(id) !== loaded.bucket) {
        throw new CanonicalLifecycleMigrationError(
          `${loaded.path}: repository ${id} belongs in bucket ${repoBucket(id)}`,
        );
      }
      if (ids.has(id)) {
        throw new CanonicalLifecycleMigrationError(`repository ${id} appears in multiple shards`);
      }
      ids.add(id);
    }
  }
  return ids;
}

async function validateInputs(input: CanonicalLifecycleMigrationInput): Promise<{
  repoShards: LoadedCanonicalRepoShard[];
  history: LoadedWhitelistHistorySnapshot[];
  published: LoadedWhitelistHistorySnapshot;
}> {
  const inventory = CanonicalLifecycleHistoryInventory.parse(input.inventory);
  if (input.bootstrapGeneration !== inventory.expected_bootstrap_generation) {
    throw new CanonicalLifecycleMigrationError("bootstrap layout changed since inventory review", {
      expected: inventory.expected_bootstrap_generation,
      actual: input.bootstrapGeneration,
    });
  }
  if ((input.bootstrapGeneration === null) !== (input.bootstrapPointerSha256 === null)) {
    throw new CanonicalLifecycleMigrationError(
      "bootstrap pointer generation and checksum must both be present or absent",
    );
  }

  ViewsPointer.parse(input.viewsPointer);
  PublishedWhitelist.parse(input.publishedWhitelistPointer);
  ReposLookup.parse(input.bootstrapLookup);

  assertSha(
    "views/latest.json",
    await sha256Json(input.viewsPointer),
    input.viewsPointerSha256,
  );
  assertSha(
    "canonical/v2/whitelist/latest.json",
    await sha256Json(input.publishedWhitelistPointer),
    input.publishedWhitelistPointerSha256,
  );
  assertSha(
    "lookup/repos.json",
    await sha256Json(input.bootstrapLookup),
    input.bootstrapLookupSha256,
  );

  if (input.viewsPointer.run_id !== input.publishedWhitelistPointer.run_id) {
    throw new CanonicalLifecycleMigrationError(
      "published whitelist pointer does not match views/latest.json",
      {
        views_run_id: input.viewsPointer.run_id,
        whitelist_run_id: input.publishedWhitelistPointer.run_id,
      },
    );
  }

  const repoShards = [...input.repoShards].sort((a, b) => a.bucket - b.bucket);
  if (repoShards.length !== REPO_BUCKETS) {
    throw new CanonicalLifecycleMigrationError(
      `expected ${REPO_BUCKETS} canonical repository shards, received ${repoShards.length}`,
    );
  }
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const loaded = repoShards[bucket];
    const expectedPath = `canonical/v2/repos/${bucket}.json`;
    if (loaded.bucket !== bucket || loaded.path !== expectedPath) {
      throw new CanonicalLifecycleMigrationError(
        `canonical repository shard ${bucket} must use ${expectedPath}`,
      );
    }
    loaded.value = ReposShard.parse(loaded.value);
    assertSha(expectedPath, await sha256Json(loaded.value), loaded.sha256);
  }

  const inventoryByRun = new Map(inventory.snapshots.map((source) => [source.run_id, source]));
  if (inventoryByRun.size !== inventory.snapshots.length) {
    throw new CanonicalLifecycleMigrationError("history inventory contains duplicate run ids");
  }
  if (input.history.length !== inventory.snapshots.length) {
    throw new CanonicalLifecycleMigrationError("loaded whitelist history is incomplete", {
      expected: inventory.snapshots.length,
      actual: input.history.length,
    });
  }

  const history = [...input.history].sort(sourceSort);
  const loadedByRun = historySourceByRun(history);
  for (const source of inventory.snapshots) {
    const loaded = loadedByRun.get(source.run_id);
    if (!loaded) {
      throw new CanonicalLifecycleMigrationError(
        `whitelist history ${source.run_id} was not loaded`,
      );
    }
    loaded.value = WhitelistSnapshot.parse(loaded.value);
    if (
      loaded.source.path !== source.path ||
      loaded.source.generated_at !== source.generated_at ||
      loaded.value.run_id !== source.run_id ||
      loaded.value.generated_at !== source.generated_at
    ) {
      throw new CanonicalLifecycleMigrationError(
        `whitelist history metadata mismatch for ${source.run_id}`,
      );
    }
    const expectedPath = `canonical/v2/whitelist/${source.run_id}.json`;
    if (source.path !== expectedPath) {
      throw new CanonicalLifecycleMigrationError(
        `whitelist history ${source.run_id} must use ${expectedPath}`,
      );
    }
    uniqueNumericIds(
      loaded.value.entries.map((entry) => entry.id),
      `whitelist history ${source.run_id}`,
    );
    const actualSha = await sha256Json(loaded.value);
    assertSha(source.path, actualSha, source.sha256);
    assertSha(source.path, actualSha, loaded.source.sha256);
  }

  const published = loadedByRun.get(input.viewsPointer.run_id);
  if (!published) {
    throw new CanonicalLifecycleMigrationError(
      `published whitelist snapshot ${input.viewsPointer.run_id} is absent from the reviewed history inventory`,
    );
  }
  const publishedIds = uniqueNumericIds(
    published.value.entries.map((entry) => entry.id),
    "published whitelist snapshot",
  );
  const pointerIds = uniqueNumericIds(
    input.publishedWhitelistPointer.ids,
    "published whitelist pointer",
  );
  if (
    publishedIds.size !== pointerIds.size ||
    [...publishedIds].some((id) => !pointerIds.has(id))
  ) {
    throw new CanonicalLifecycleMigrationError(
      "published whitelist pointer ids do not match its immutable snapshot",
    );
  }

  return { repoShards, history, published };
}

export async function buildCanonicalLifecycleMigration(
  input: CanonicalLifecycleMigrationInput,
): Promise<CanonicalLifecycleMigrationBundle> {
  const { repoShards, history, published } = await validateInputs(input);
  const canonicalIds = canonicalRepoIds(repoShards);
  const bootstrapIds = new Set(Object.keys(input.bootstrapLookup).map(Number));
  const activeIds = new Set(published.value.entries.map((entry) => entry.id));
  const missingCanonical = [...activeIds].filter((id) => !canonicalIds.has(id)).sort(numericIdSort);
  if (missingCanonical.length > 0) {
    throw new CanonicalLifecycleMigrationError(
      `published whitelist contains ${missingCanonical.length} repositories absent from canonical shards`,
      { ids: missingCanonical },
    );
  }

  const firstObserved = new Map<number, string>();
  for (const loaded of history) {
    const date = loaded.value.generated_at.slice(0, 10);
    for (const entry of loaded.value.entries) {
      if (!firstObserved.has(entry.id)) firstObserved.set(entry.id, date);
    }
  }

  const unresolvedHistorical: number[] = [];
  const unresolvedNewcomers: number[] = [];
  const before: LoadedCanonicalRepoShard[] = [];
  const after: LoadedCanonicalRepoShard[] = [];
  const bucketPlans: CanonicalLifecycleMigrationBucketPlan[] = [];
  const changedRepoIds = new Set<number>();
  let activeTrue = 0;
  let activeFalse = 0;
  let activeChanges = 0;
  let trackedSinceRecovered = 0;
  let trackedSinceNullMaterialized = 0;
  let anchorsPreserved = 0;

  for (const loaded of repoShards) {
    const previous = ReposShard.parse(structuredClone(loaded.value));
    const next: ReposShardType = {};
    const changedIds: number[] = [];
    const recoveries: Array<{ id: number; tracked_since: string }> = [];
    const materializedNull: number[] = [];
    let bucketActiveTrue = 0;
    let bucketActiveFalse = 0;
    let bucketActiveChanges = 0;

    for (const [key, repo] of Object.entries(previous).sort(
      (a, b) => Number(a[0]) - Number(b[0]),
    )) {
      const id = Number(key);
      const desiredActive = activeIds.has(id);
      if (desiredActive) {
        activeTrue++;
        bucketActiveTrue++;
      } else {
        activeFalse++;
        bucketActiveFalse++;
      }

      let desiredTrackedSince = repo.tracked_since;
      const hasFiniteAnchor = typeof repo.d === "number" && Number.isFinite(repo.d);
      if (hasFiniteAnchor) anchorsPreserved++;

      if (desiredTrackedSince == null && !hasFiniteAnchor) {
        if (bootstrapIds.has(id)) {
          unresolvedHistorical.push(id);
        } else {
          const observed = firstObserved.get(id);
          if (!observed) unresolvedNewcomers.push(id);
          else {
            desiredTrackedSince = observed;
            trackedSinceRecovered++;
            recoveries.push({ id, tracked_since: observed });
          }
        }
      } else if (!("tracked_since" in repo)) {
        desiredTrackedSince = null;
        trackedSinceNullMaterialized++;
        materializedNull.push(id);
      }

      const activeChanged = repo.active !== desiredActive;
      const trackedChanged =
        !("tracked_since" in repo) || repo.tracked_since !== desiredTrackedSince;
      if (activeChanged) {
        activeChanges++;
        bucketActiveChanges++;
      }
      if (activeChanged || trackedChanged) {
        changedIds.push(id);
        changedRepoIds.add(id);
      }

      next[key] = {
        ...repo,
        active: desiredActive,
        tracked_since: desiredTrackedSince ?? null,
      };
    }

    const parsedNext = ReposShard.parse(next);
    const beforeSha = await sha256Json(previous);
    const afterSha = await sha256Json(parsedNext);
    assertSha(loaded.path, beforeSha, loaded.sha256);
    const plan = CanonicalLifecycleMigrationBucketPlan.parse({
      bucket: loaded.bucket,
      path: loaded.path,
      records: Object.keys(previous).length,
      before_sha256: beforeSha,
      after_sha256: afterSha,
      changed_repositories: changedIds.length,
      changed_ids: changedIds.sort(numericIdSort),
      active_true: bucketActiveTrue,
      active_false: bucketActiveFalse,
      active_changes: bucketActiveChanges,
      tracked_since_recoveries: recoveries.sort((a, b) => a.id - b.id),
      tracked_since_null_materialized: materializedNull.sort(numericIdSort),
    });
    bucketPlans.push(plan);
    before.push({ ...loaded, value: previous, sha256: beforeSha });
    after.push({ ...loaded, value: parsedNext, sha256: afterSha });
  }

  if (unresolvedHistorical.length > 0 || unresolvedNewcomers.length > 0) {
    throw new CanonicalLifecycleMigrationError(
      "canonical lifecycle migration has unresolved anchoring/provenance rows",
      {
        historical_missing_d: unresolvedHistorical.sort(numericIdSort),
        newcomer_missing_history: unresolvedNewcomers.sort(numericIdSort),
      },
    );
  }

  const publishedSource = input.inventory.snapshots.find(
    (source) => source.run_id === input.viewsPointer.run_id,
  );
  if (!publishedSource) {
    throw new CanonicalLifecycleMigrationError("published whitelist source disappeared");
  }

  const plan = CanonicalLifecycleMigrationPlan.parse({
    schema_ver: 1,
    issue: 326,
    operation: "canonical-lifecycle-provenance",
    source: {
      bootstrap_generation: input.bootstrapGeneration,
      bootstrap_pointer_sha256: input.bootstrapPointerSha256,
      views_pointer: input.viewsPointer,
      views_pointer_sha256: input.viewsPointerSha256,
      published_whitelist_pointer_path: "canonical/v2/whitelist/latest.json",
      published_whitelist_pointer_sha256: input.publishedWhitelistPointerSha256,
      published_whitelist_path: publishedSource.path,
      published_whitelist_sha256: publishedSource.sha256,
      bootstrap_lookup_path: "lookup/repos.json",
      bootstrap_lookup_sha256: input.bootstrapLookupSha256,
      history: [...input.inventory.snapshots].sort(
        (a, b) =>
          a.generated_at.localeCompare(b.generated_at) || a.run_id.localeCompare(b.run_id),
      ),
    },
    counts: {
      canonical_repositories: canonicalIds.size,
      bootstrap_repositories: bootstrapIds.size,
      published_whitelist_repositories: activeIds.size,
      active_true: activeTrue,
      active_false: activeFalse,
      active_changes: activeChanges,
      tracked_since_recovered: trackedSinceRecovered,
      tracked_since_null_materialized: trackedSinceNullMaterialized,
      anchors_preserved: anchorsPreserved,
      anchors_invented: 0,
      changed_repositories: changedRepoIds.size,
      changed_buckets: bucketPlans.filter(
        (bucket) => bucket.before_sha256 !== bucket.after_sha256,
      ).length,
    },
    buckets: bucketPlans.sort((a, b) => a.bucket - b.bucket),
  });

  return {
    plan,
    planSha256: await sha256Json(plan),
    before: before.sort((a, b) => a.bucket - b.bucket),
    after: after.sort((a, b) => a.bucket - b.bucket),
  };
}

export async function verifyCanonicalLifecycleReceipt(
  value: unknown,
): Promise<CanonicalLifecycleMigrationReceipt> {
  const receipt = CanonicalLifecycleMigrationReceipt.parse(value);
  const actual = await sha256Json(receipt.plan);
  assertSha("migration receipt plan", actual, receipt.plan_sha256);
  return receipt;
}
