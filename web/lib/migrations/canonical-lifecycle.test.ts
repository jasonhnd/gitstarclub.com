import { describe, expect, test } from "bun:test";
import type {
  PublishedWhitelist,
  RepoLookupEntry,
  ReposLookup,
  ReposShard,
  ReposShardEntry,
  ViewsPointer,
  WhitelistEntry,
  WhitelistSnapshot,
} from "@/lib/contracts";
import {
  buildCanonicalLifecycleMigration,
  CanonicalLifecycleMigrationError,
  sha256Json,
  verifyCanonicalLifecycleReceipt,
  type CanonicalLifecycleHistoryInventory,
  type CanonicalLifecycleMigrationBundle,
  type CanonicalLifecycleMigrationInput,
  type LoadedCanonicalRepoShard,
  type LoadedWhitelistHistorySnapshot,
} from "@/lib/migrations/canonical-lifecycle";
import {
  canonicalLifecycleReceiptPath,
  canonicalLifecycleShardReceiptPath,
  classifyCanonicalLifecycleShard,
  executeCanonicalLifecycleMigration,
  rollbackCanonicalLifecycleMigration,
  type CanonicalLifecycleExecutionDeps,
} from "@/lib/migrations/canonical-lifecycle-execution";
import { validateCanonicalGeneration } from "@/lib/workflows/canonical-validation";

function repo(id: number, overrides: Partial<ReposShardEntry> = {}): ReposShardEntry {
  return {
    id,
    node_id: `R_${id}`,
    owner: "owner",
    owner_type: "Organization",
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    current_stars: 10_000 + id,
    tracked_since: null,
    ...overrides,
  };
}

function whitelistEntry(id: number): WhitelistEntry {
  return {
    id,
    node_id: `R_${id}`,
    owner: "owner",
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    stars: 10_000 + id,
  };
}

function snapshot(runId: string, generatedAt: string, ids: number[]): WhitelistSnapshot {
  return {
    run_id: runId,
    generated_at: generatedAt,
    count: ids.length,
    entries: ids.map(whitelistEntry),
    diff: { added: [], dropped: [] },
  };
}

function lookupEntry(id: number): RepoLookupEntry {
  return {
    owner: "owner",
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    owner_type: "Organization",
    language: null,
    current_stars: 10_000 + id,
  };
}

async function fixtureInput(): Promise<CanonicalLifecycleMigrationInput> {
  const runs = [
    snapshot("refresh-early", "2026-06-02T01:00:00.000Z", [32, 1]),
    snapshot("refresh-middle", "2026-06-28T01:00:00.000Z", [32, 1, 2]),
    snapshot("refresh-current", "2026-07-19T01:00:00.000Z", [32, 1, 3]),
  ];
  const historySources = await Promise.all(
    runs.map(async (value) => ({
      path: `canonical/v2/whitelist/${value.run_id}.json`,
      run_id: value.run_id,
      generated_at: value.generated_at,
      sha256: await sha256Json(value),
    })),
  );
  const inventory: CanonicalLifecycleHistoryInventory = {
    schema_ver: 1,
    issue: 326,
    expected_bootstrap_generation: null,
    snapshots: historySources,
  };
  const history: LoadedWhitelistHistorySnapshot[] = runs.map((value, index) => ({
    source: historySources[index],
    value,
  }));

  const shardValues = Array.from({ length: 32 }, () => ({} as ReposShard));
  shardValues[0]["32"] = repo(32, { d: 1 });
  shardValues[1]["1"] = repo(1);
  shardValues[2]["2"] = repo(2);
  shardValues[3]["3"] = repo(3, { active: false, tracked_since: "2026-06-01" });
  const repoShards: LoadedCanonicalRepoShard[] = await Promise.all(
    shardValues.map(async (value, bucket) => ({
      bucket,
      path: `canonical/v2/repos/${bucket}.json`,
      value,
      sha256: await sha256Json(value),
    })),
  );

  const viewsPointer: ViewsPointer = {
    version: "refresh-current",
    run_id: "refresh-current",
    published_at: "2026-07-19T02:00:00.000Z",
    prev_version: "refresh-middle",
    schema_ver: 1,
  };
  const publishedWhitelistPointer: PublishedWhitelist = {
    run_id: "refresh-current",
    ids: [32, 1, 3],
  };
  const bootstrapLookup: ReposLookup = { "32": lookupEntry(32) };

  return {
    inventory,
    bootstrapGeneration: null,
    bootstrapPointerSha256: null,
    viewsPointer,
    viewsPointerSha256: await sha256Json(viewsPointer),
    publishedWhitelistPointer,
    publishedWhitelistPointerSha256: await sha256Json(publishedWhitelistPointer),
    bootstrapLookup,
    bootstrapLookupSha256: await sha256Json(bootstrapLookup),
    repoShards,
    history,
  };
}

describe("canonical lifecycle migration planner", () => {
  test("derives active membership and recovers newcomer provenance without inventing anchors", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());

    expect(bundle.plan.counts).toEqual({
      canonical_repositories: 4,
      bootstrap_repositories: 1,
      published_whitelist_repositories: 3,
      active_true: 3,
      active_false: 1,
      active_changes: 4,
      tracked_since_recovered: 2,
      tracked_since_null_materialized: 0,
      anchors_preserved: 1,
      anchors_invented: 0,
      changed_repositories: 4,
      changed_buckets: 4,
    });
    expect(bundle.after[0].value["32"]).toMatchObject({
      active: true,
      tracked_since: null,
      d: 1,
    });
    expect(bundle.after[1].value["1"]).toMatchObject({
      active: true,
      tracked_since: "2026-06-02",
    });
    expect(bundle.after[1].value["1"].d).toBeUndefined();
    expect(bundle.after[2].value["2"]).toMatchObject({
      active: false,
      tracked_since: "2026-06-28",
    });
    expect(bundle.after[3].value["3"]).toMatchObject({
      active: true,
      tracked_since: "2026-06-01",
    });
  });

  test("keeps the plan digest stable when loaded shards and history are reordered", async () => {
    const first = await buildCanonicalLifecycleMigration(await fixtureInput());
    const reordered = await fixtureInput();
    reordered.repoShards.reverse();
    reordered.history.reverse();
    reordered.inventory.snapshots.reverse();
    const second = await buildCanonicalLifecycleMigration(reordered);

    expect(second.planSha256).toBe(first.planSha256);
    expect(second.plan).toEqual(first.plan);
  });

  test("is idempotent after every planned value has already been applied", async () => {
    const input = await fixtureInput();
    const first = await buildCanonicalLifecycleMigration(input);
    const reappliedInput = await fixtureInput();
    reappliedInput.repoShards = first.after.map((shard) => ({
      ...shard,
      value: structuredClone(shard.value),
    }));

    const second = await buildCanonicalLifecycleMigration(reappliedInput);
    expect(second.plan.counts).toMatchObject({
      active_changes: 0,
      tracked_since_recovered: 0,
      anchors_invented: 0,
      changed_repositories: 0,
      changed_buckets: 0,
    });
    expect(second.before.map((shard) => shard.sha256)).toEqual(
      second.after.map((shard) => shard.sha256),
    );
  });

  test("produces repository shards accepted by the canonical preflight validator", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const byPath = new Map(bundle.after.map((shard) => [shard.path, shard.value]));
    const validation = await validateCanonicalGeneration("issue-326-fixture", {
      scope: "repositories",
      generatedAt: "2026-07-28T00:00:00.000Z",
      reader: async (path) => byPath.get(path) ?? null,
    });

    expect(validation.manifest.complete).toBe(true);
    expect(validation.failures).toEqual([]);
  });

  test("materializes an explicit null provenance field for an anchored bootstrap row", async () => {
    const input = await fixtureInput();
    delete input.repoShards[0].value["32"].tracked_since;
    input.repoShards[0].sha256 = await sha256Json(input.repoShards[0].value);
    const bundle = await buildCanonicalLifecycleMigration(input);

    expect(bundle.plan.counts.tracked_since_null_materialized).toBe(1);
    expect(bundle.after[0].value["32"].tracked_since).toBeNull();
    expect("tracked_since" in bundle.after[0].value["32"]).toBe(true);
  });

  test("fails instead of relabeling a bootstrap repository whose frozen d is missing", async () => {
    const input = await fixtureInput();
    delete input.repoShards[0].value["32"].d;
    input.repoShards[0].sha256 = await sha256Json(input.repoShards[0].value);

    try {
      await buildCanonicalLifecycleMigration(input);
      throw new Error("expected planner failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalLifecycleMigrationError);
      expect((error as CanonicalLifecycleMigrationError).details).toEqual({
        historical_missing_d: [32],
        newcomer_missing_history: [],
      });
    }
  });

  test("fails when a newcomer has no immutable whitelist provenance", async () => {
    const input = await fixtureInput();
    input.repoShards[4].value["4"] = repo(4);
    input.repoShards[4].sha256 = await sha256Json(input.repoShards[4].value);

    await expect(buildCanonicalLifecycleMigration(input)).rejects.toMatchObject({
      details: {
        historical_missing_d: [],
        newcomer_missing_history: [4],
      },
    });
  });

  test("fails closed when the published pointer ids differ from its immutable snapshot", async () => {
    const input = await fixtureInput();
    input.publishedWhitelistPointer.ids = [32, 1];
    input.publishedWhitelistPointerSha256 = await sha256Json(
      input.publishedWhitelistPointer,
    );

    await expect(buildCanonicalLifecycleMigration(input)).rejects.toThrow(
      "published whitelist pointer ids do not match",
    );
  });

  test("verifies a receipt against the deterministic plan digest", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const receipt = {
      schema_ver: 1 as const,
      operation: "canonical-lifecycle-provenance" as const,
      plan_sha256: bundle.planSha256,
      plan: bundle.plan,
    };
    expect(await verifyCanonicalLifecycleReceipt(receipt)).toEqual(receipt);

    await expect(
      verifyCanonicalLifecycleReceipt({ ...receipt, plan_sha256: "0".repeat(64) }),
    ).rejects.toThrow("migration receipt plan SHA-256 changed");
  });
});

class MemoryExecution {
  readonly current = new Map<number, ReposShard>();
  readonly stored = new Map<string, unknown>();
  readonly releaseStatuses: Array<"published" | "failed"> = [];
  sourceChecks = 0;
  claimCount = 0;
  failWriteBucket: number | null = null;
  failWriteOnce = false;
  sourceError: Error | null = null;
  validationComplete = true;
  releaseResult = true;
  releaseError: Error | null = null;
  postWriteStaleReads = 0;
  readConsistencyWaits = 0;
  readonly staleReads = new Map<
    number,
    { remaining: number; value: ReposShard }
  >();

  constructor(readonly bundle: CanonicalLifecycleMigrationBundle) {
    for (const shard of bundle.before) {
      this.current.set(shard.bucket, structuredClone(shard.value));
    }
  }

  deps(): CanonicalLifecycleExecutionDeps {
    return {
      claim: async () => {
        this.claimCount++;
        return { runId: `memory-${this.claimCount}`, fencingToken: this.claimCount };
      },
      release: async (_owner, status) => {
        this.releaseStatuses.push(status);
        if (this.releaseError) throw this.releaseError;
        return this.releaseResult;
      },
      assertSource: async () => {
        this.sourceChecks++;
        if (this.sourceError) throw this.sourceError;
      },
      createExact: async (_owner, path, value, expectedSha256) => {
        expect(await sha256Json(value)).toBe(expectedSha256);
        const existing = this.stored.get(path);
        if (existing !== undefined) {
          expect(await sha256Json(existing)).toBe(expectedSha256);
        } else {
          this.stored.set(path, structuredClone(value));
        }
      },
      readRepoShard: async (bucket) => {
        const stale = this.staleReads.get(bucket);
        if (stale && stale.remaining > 0) {
          stale.remaining--;
          return structuredClone(stale.value);
        }
        return structuredClone(this.current.get(bucket) ?? {});
      },
      writeRepoShard: async (_owner, bucket, value) => {
        if (this.failWriteBucket === bucket) {
          if (this.failWriteOnce) this.failWriteBucket = null;
          throw new Error(`interrupted at bucket ${bucket}`);
        }
        const previous = structuredClone(this.current.get(bucket) ?? {});
        this.current.set(bucket, structuredClone(value));
        if (this.postWriteStaleReads > 0) {
          this.staleReads.set(bucket, {
            remaining: this.postWriteStaleReads,
            value: previous,
          });
        }
      },
      waitForShardReadConsistency: async () => {
        this.readConsistencyWaits++;
      },
      validateFull: async () => ({
        complete: this.validationComplete,
        failures: this.validationComplete ? [] : ["fixture validation failed"],
      }),
    };
  }
}

async function expectCurrentState(
  memory: MemoryExecution,
  expected: LoadedCanonicalRepoShard[],
): Promise<void> {
  for (const shard of expected) {
    expect(await sha256Json(memory.current.get(shard.bucket))).toBe(shard.sha256);
  }
}

describe("canonical lifecycle migration execution", () => {
  test("classifies only exact before/after states and rejects drift", () => {
    expect(classifyCanonicalLifecycleShard("a", "a", "b")).toBe("before");
    expect(classifyCanonicalLifecycleShard("b", "a", "b")).toBe("after");
    expect(classifyCanonicalLifecycleShard("a", "a", "a")).toBe("after");
    expect(() => classifyCanonicalLifecycleShard("c", "a", "b")).toThrow(
      "matches neither before",
    );
  });

  test("stages immutable receipts, applies changed buckets, and validates before release", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    const result = await executeCanonicalLifecycleMigration(
      bundle,
      bundle.planSha256,
      memory.deps(),
    );

    expect(result).toEqual({
      plan_sha256: bundle.planSha256,
      applied_buckets: 4,
      already_applied_buckets: 28,
    });
    expect(memory.sourceChecks).toBe(2);
    expect(memory.releaseStatuses).toEqual(["published"]);
    expect(memory.stored.has(canonicalLifecycleReceiptPath(bundle.planSha256))).toBe(true);
    expect(
      memory.stored.has(
        canonicalLifecycleShardReceiptPath(bundle.planSha256, "before", 0),
      ),
    ).toBe(true);
    expect(
      memory.stored.has(canonicalLifecycleShardReceiptPath(bundle.planSha256, "after", 31)),
    ).toBe(true);
    await expectCurrentState(memory, bundle.after);
  });

  test("retries transient stale reads after a successful canonical overwrite", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    memory.postWriteStaleReads = 2;

    const result = await executeCanonicalLifecycleMigration(
      bundle,
      bundle.planSha256,
      memory.deps(),
    );

    expect(result.applied_buckets).toBe(bundle.plan.counts.changed_buckets);
    expect(memory.readConsistencyWaits).toBe(bundle.plan.counts.changed_buckets * 2);
    expect(memory.releaseStatuses).toEqual(["published"]);
    await expectCurrentState(memory, bundle.after);
  });

  test("fails closed when stale reads outlast bounded write verification", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    memory.postWriteStaleReads = 100;

    await expect(
      executeCanonicalLifecycleMigration(bundle, bundle.planSha256, memory.deps()),
    ).rejects.toThrow("canonical shard 0 write verification failed");
    expect(memory.releaseStatuses).toEqual(["failed"]);
  });

  test("retries an interrupted partial application idempotently", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    memory.failWriteBucket = 2;
    memory.failWriteOnce = true;

    await expect(
      executeCanonicalLifecycleMigration(bundle, bundle.planSha256, memory.deps()),
    ).rejects.toThrow("interrupted at bucket 2");
    expect(memory.releaseStatuses).toEqual(["failed"]);
    expect(await sha256Json(memory.current.get(0))).toBe(bundle.after[0].sha256);
    expect(await sha256Json(memory.current.get(1))).toBe(bundle.after[1].sha256);
    expect(await sha256Json(memory.current.get(2))).toBe(bundle.before[2].sha256);

    const retried = await executeCanonicalLifecycleMigration(
      bundle,
      bundle.planSha256,
      memory.deps(),
    );
    expect(retried.applied_buckets).toBe(2);
    expect(retried.already_applied_buckets).toBe(30);
    expect(memory.releaseStatuses).toEqual(["failed", "published"]);
    await expectCurrentState(memory, bundle.after);
  });

  test("rolls an applied plan back to its immutable before state", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    await executeCanonicalLifecycleMigration(bundle, bundle.planSha256, memory.deps());

    const result = await rollbackCanonicalLifecycleMigration(
      bundle,
      bundle.planSha256,
      memory.deps(),
    );
    expect(result).toEqual({
      plan_sha256: bundle.planSha256,
      rolled_back_buckets: 4,
      already_rolled_back_buckets: 28,
    });
    await expectCurrentState(memory, bundle.before);
  });

  test("rejects the wrong confirmation before acquiring a lease", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);

    await expect(
      executeCanonicalLifecycleMigration(bundle, "0".repeat(64), memory.deps()),
    ).rejects.toThrow("--confirm must exactly equal");
    expect(memory.claimCount).toBe(0);
    expect(memory.releaseStatuses).toEqual([]);
  });

  test("releases failed when source drift or post-write validation fails", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const sourceDrift = new MemoryExecution(bundle);
    sourceDrift.sourceError = new Error("source drift");
    await expect(
      executeCanonicalLifecycleMigration(bundle, bundle.planSha256, sourceDrift.deps()),
    ).rejects.toThrow("source drift");
    expect(sourceDrift.releaseStatuses).toEqual(["failed"]);

    const invalid = new MemoryExecution(bundle);
    invalid.validationComplete = false;
    await expect(
      executeCanonicalLifecycleMigration(bundle, bundle.planSha256, invalid.deps()),
    ).rejects.toThrow("fixture validation failed");
    expect(invalid.releaseStatuses).toEqual(["failed"]);
  });

  test("refuses a repository shard that matches neither reviewed state", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    memory.current.get(1)!["1"].current_stars++;

    await expect(
      executeCanonicalLifecycleMigration(bundle, bundle.planSha256, memory.deps()),
    ).rejects.toThrow("canonical shard drift");
    expect(memory.releaseStatuses).toEqual(["failed"]);
  });

  test("reports lease loss instead of claiming a successful release", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    memory.releaseResult = false;

    await expect(
      executeCanonicalLifecycleMigration(bundle, bundle.planSha256, memory.deps()),
    ).rejects.toThrow("lost lease");
    expect(memory.releaseStatuses).toEqual(["published"]);
  });

  test("preserves the original failure when failed lease release also throws", async () => {
    const bundle = await buildCanonicalLifecycleMigration(await fixtureInput());
    const memory = new MemoryExecution(bundle);
    memory.sourceError = new Error("source drift");
    memory.releaseError = new Error("release transport failed");

    try {
      await executeCanonicalLifecycleMigration(bundle, bundle.planSha256, memory.deps());
      throw new Error("expected migration failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).message).toContain(
        "source drift; failed lease release threw: release transport failed",
      );
      expect((error as AggregateError).errors).toEqual([
        memory.sourceError,
        memory.releaseError,
      ]);
    }
    expect(memory.releaseStatuses).toEqual(["failed"]);
  });
});
