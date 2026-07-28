// One-off Issue #326 canonical lifecycle migration.
//
// Default: read-only production dry-run (BLOB_BASE_URL only).
//   bun scripts/migrate-canonical-lifecycle.ts
//
// Execute an already reviewed plan:
//   bun scripts/migrate-canonical-lifecycle.ts --execute --confirm <plan-sha256>
//
// Roll back from the immutable before-state receipt:
//   bun scripts/migrate-canonical-lifecycle.ts --rollback <plan-sha256> \
//     --execute --confirm <plan-sha256>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import {
  BootstrapPublicationPointer,
  PublishedWhitelist,
  ReposLookup,
  ReposShard,
  ViewsPointer,
  WhitelistSnapshot,
} from "@/lib/contracts";
import {
  buildCanonicalLifecycleMigration,
  CanonicalLifecycleHistoryInventory,
  CanonicalLifecycleMigrationReceipt,
  sha256Json,
  verifyCanonicalLifecycleReceipt,
  type CanonicalLifecycleHistorySource,
  type CanonicalLifecycleMigrationBundle,
  type CanonicalLifecycleMigrationPlan,
  type LoadedCanonicalRepoShard,
  type LoadedWhitelistHistorySnapshot,
} from "@/lib/migrations/canonical-lifecycle";
import {
  canonicalLifecycleReceiptPath,
  canonicalLifecycleShardReceiptPath,
  executeCanonicalLifecycleMigration,
  rollbackCanonicalLifecycleMigration,
  type CanonicalLifecycleExecutionDeps,
} from "@/lib/migrations/canonical-lifecycle-execution";
import { validateCanonicalGeneration } from "@/lib/workflows/canonical-validation";
import { createOwnedView, putOwnedView } from "@/lib/workflows/owned-write";
import {
  claimWorkflowLease,
  releaseWorkflowLease,
} from "@/lib/workflows/lease";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const defaultInventoryPath = fileURLToPath(
  new URL("./migrations/issue-326-whitelist-history.json", import.meta.url),
);
const PUBLIC_READ_RETRIES = 4;
const PUBLIC_READ_TIMEOUT_MS = 15_000;
const IO_CONCURRENCY = 6;

type Args = {
  execute: boolean;
  confirm: string | null;
  rollback: string | null;
  inventoryPath: string;
  planOut: string | null;
  full: boolean;
};

type LoadedJson<T> = {
  value: T;
  sha256: string;
};

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/migrate-canonical-lifecycle.ts [--full] [--plan-out <file>]",
    "  bun scripts/migrate-canonical-lifecycle.ts --execute --confirm <plan-sha256>",
    "  bun scripts/migrate-canonical-lifecycle.ts --rollback <plan-sha256> --execute --confirm <same-sha256>",
    "",
    "Options:",
    "  --inventory <file>  Reviewed immutable whitelist history inventory.",
    "  --plan-out <file>   Create a local full-plan JSON file; existing unequal files are refused.",
    "  --full              Print the full deterministic plan to stdout.",
    "  --execute           Enable guarded Blob mutation. Omitted by default.",
    "  --confirm <sha>     Exact reviewed plan SHA-256 required by --execute.",
    "  --rollback <sha>    Restore the immutable before-state receipt for this plan.",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  let execute = false;
  let confirm: string | null = null;
  let rollback: string | null = null;
  let inventoryPath = defaultInventoryPath;
  let planOut: string | null = null;
  let full = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--execute") execute = true;
    else if (arg === "--full") full = true;
    else if (arg === "--confirm") confirm = argv[++index] ?? "";
    else if (arg.startsWith("--confirm=")) confirm = arg.slice("--confirm=".length);
    else if (arg === "--rollback") rollback = argv[++index] ?? "";
    else if (arg.startsWith("--rollback=")) rollback = arg.slice("--rollback=".length);
    else if (arg === "--inventory") inventoryPath = resolve(argv[++index] ?? "");
    else if (arg.startsWith("--inventory=")) {
      inventoryPath = resolve(arg.slice("--inventory=".length));
    } else if (arg === "--plan-out") planOut = resolve(argv[++index] ?? "");
    else if (arg.startsWith("--plan-out=")) planOut = resolve(arg.slice("--plan-out=".length));
    else if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown argument ${arg}\n\n${usage()}`);
    }
  }

  const digest = /^[a-f0-9]{64}$/;
  if (confirm !== null && !digest.test(confirm)) throw new Error("--confirm must be a lowercase SHA-256");
  if (rollback !== null && !digest.test(rollback)) throw new Error("--rollback must be a lowercase SHA-256");
  if (execute && confirm === null) throw new Error("--execute requires --confirm <plan-sha256>");
  if (rollback !== null && !execute) throw new Error("--rollback requires --execute");
  if (rollback !== null && rollback !== confirm) {
    throw new Error("--rollback and --confirm must name the same plan SHA-256");
  }
  return { execute, confirm, rollback, inventoryPath, planOut, full };
}

function loadReadEnv(): void {
  loadWebEnvFiles(webDir, {
    keys: ["BLOB_BASE_URL"],
    onDiagnostic: warnEnvFileDiagnostic,
  });
  if (!process.env.BLOB_BASE_URL) throw new Error("BLOB_BASE_URL not set");
}

function loadWriteEnv(): string {
  loadWebEnvFiles(webDir, {
    keys: ["BLOB_READ_WRITE_TOKEN"],
    onDiagnostic: warnEnvFileDiagnostic,
  });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  return token;
}

function publicUrl(path: string, attempt: number): string {
  const base = process.env.BLOB_BASE_URL!.replace(/\/+$/, "");
  return `${base}/${path}?v=issue-326-${attempt}-${Date.now().toString(36)}`;
}

async function readPublicJson<T>(
  path: string,
  schema: ZodType<T>,
  options: { optional?: boolean } = {},
): Promise<LoadedJson<T> | null> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PUBLIC_READ_RETRIES + 1; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(publicUrl(path, attempt), {
        cache: "no-store",
        signal: AbortSignal.timeout(PUBLIC_READ_TIMEOUT_MS),
      });
      if (response.status === 404) {
        if (options.optional) return null;
        throw new Error(`${path} -> 404`);
      }
      if (response.ok) {
        const value = schema.parse(await response.json());
        return { value, sha256: await sha256Json(value) };
      }
      const retryable =
        response.status === 403 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt > PUBLIC_READ_RETRIES) {
        throw new Error(`${path} -> ${response.status}`);
      }
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
      if (attempt > PUBLIC_READ_RETRIES) break;
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, Math.min(300 * 2 ** (attempt - 1), 2_500)),
    );
  }
  throw lastError instanceof Error ? lastError : new Error(`${path} could not be read`);
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

function loadInventory(path: string) {
  return CanonicalLifecycleHistoryInventory.parse(JSON.parse(readFileSync(path, "utf8")));
}

async function loadLiveBundle(inventoryPath: string): Promise<CanonicalLifecycleMigrationBundle> {
  const inventory = loadInventory(inventoryPath);
  const [bootstrap, views, publishedPointer, bootstrapLookup] = await Promise.all([
    readPublicJson("bootstrap/latest.json", BootstrapPublicationPointer, { optional: true }),
    readPublicJson("views/latest.json", ViewsPointer),
    readPublicJson("canonical/v2/whitelist/latest.json", PublishedWhitelist),
    readPublicJson("lookup/repos.json", ReposLookup),
  ]);
  if (!views || !publishedPointer || !bootstrapLookup) throw new Error("required source missing");
  const bootstrapGeneration = bootstrap?.value.generation ?? null;
  if (bootstrapGeneration !== inventory.expected_bootstrap_generation) {
    throw new Error(
      `bootstrap layout changed: inventory=${inventory.expected_bootstrap_generation ?? "legacy-flat"} current=${bootstrapGeneration ?? "legacy-flat"}`,
    );
  }

  const repoShards = await mapLimit(
    Array.from({ length: 32 }, (_, bucket) => bucket),
    IO_CONCURRENCY,
    async (bucket): Promise<LoadedCanonicalRepoShard> => {
      const path = `canonical/v2/repos/${bucket}.json`;
      const loaded = await readPublicJson(path, ReposShard);
      if (!loaded) throw new Error(`${path} missing`);
      return { bucket, path, value: loaded.value, sha256: loaded.sha256 };
    },
  );

  const history = await mapLimit(
    inventory.snapshots,
    IO_CONCURRENCY,
    async (source): Promise<LoadedWhitelistHistorySnapshot> => {
      const loaded = await readPublicJson(source.path, WhitelistSnapshot);
      if (!loaded) throw new Error(`${source.path} missing`);
      return {
        source: { ...source, sha256: loaded.sha256 },
        value: loaded.value,
      };
    },
  );

  return buildCanonicalLifecycleMigration({
    inventory,
    bootstrapGeneration,
    bootstrapPointerSha256: bootstrap?.sha256 ?? null,
    viewsPointer: views.value,
    viewsPointerSha256: views.sha256,
    publishedWhitelistPointer: publishedPointer.value,
    publishedWhitelistPointerSha256: publishedPointer.sha256,
    bootstrapLookup: bootstrapLookup.value,
    bootstrapLookupSha256: bootstrapLookup.sha256,
    repoShards,
    history,
  });
}

function writePlanFile(path: string, bundle: CanonicalLifecycleMigrationBundle): void {
  const content = `${JSON.stringify(
    { plan_sha256: bundle.planSha256, plan: bundle.plan },
    null,
    2,
  )}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error(`refusing to overwrite unequal plan file ${path}`);
    }
    return;
  }
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
}

function dryRunSummary(bundle: CanonicalLifecycleMigrationBundle) {
  const recoveredByDate: Record<string, number> = {};
  for (const bucket of bundle.plan.buckets) {
    for (const recovery of bucket.tracked_since_recoveries) {
      recoveredByDate[recovery.tracked_since] =
        (recoveredByDate[recovery.tracked_since] ?? 0) + 1;
    }
  }
  return {
    mode: "dry-run",
    production_writes: 0,
    plan_sha256: bundle.planSha256,
    source: {
      layout: bundle.plan.source.bootstrap_generation ?? "legacy-flat",
      published_run_id: bundle.plan.source.views_pointer.run_id,
      whitelist_history_snapshots: bundle.plan.source.history.length,
    },
    counts: bundle.plan.counts,
    tracked_since_recovered_by_date: recoveredByDate,
    execute_requires: `--execute --confirm ${bundle.planSha256}`,
  };
}

let blobModulePromise: Promise<typeof import("@vercel/blob")> | null = null;
function blobModule() {
  blobModulePromise ??= import("@vercel/blob");
  return blobModulePromise;
}

async function readStoredJson<T>(
  path: string,
  schema: ZodType<T>,
  token: string,
  optional = false,
): Promise<LoadedJson<T> | null> {
  const { get } = await blobModule();
  const result = await get(path, { access: "public", token });
  if (!result) {
    if (optional) return null;
    throw new Error(`${path} missing`);
  }
  if (result.statusCode !== 200 || !result.stream) {
    throw new Error(`${path} -> ${result.statusCode}`);
  }
  const value = schema.parse(JSON.parse(await new Response(result.stream).text()));
  return { value, sha256: await sha256Json(value) };
}

async function loadStoredBundle(
  planSha256: string,
  token: string,
): Promise<CanonicalLifecycleMigrationBundle | null> {
  const receiptLoaded = await readStoredJson(
    canonicalLifecycleReceiptPath(planSha256),
    CanonicalLifecycleMigrationReceipt,
    token,
    true,
  );
  if (!receiptLoaded) return null;
  const receipt = await verifyCanonicalLifecycleReceipt(receiptLoaded.value);
  if (receipt.plan_sha256 !== planSha256) throw new Error("stored receipt plan id mismatch");

  const before = await mapLimit(receipt.plan.buckets, IO_CONCURRENCY, async (bucket) => {
    const loaded = await readStoredJson(
      canonicalLifecycleShardReceiptPath(planSha256, "before", bucket.bucket),
      ReposShard,
      token,
    );
    if (!loaded) throw new Error(`stored before bucket ${bucket.bucket} missing`);
    if (loaded.sha256 !== bucket.before_sha256) {
      throw new Error(`stored before bucket ${bucket.bucket} checksum mismatch`);
    }
    return {
      bucket: bucket.bucket,
      path: bucket.path,
      value: loaded.value,
      sha256: loaded.sha256,
    };
  });
  const after = await mapLimit(receipt.plan.buckets, IO_CONCURRENCY, async (bucket) => {
    const loaded = await readStoredJson(
      canonicalLifecycleShardReceiptPath(planSha256, "after", bucket.bucket),
      ReposShard,
      token,
    );
    if (!loaded) throw new Error(`stored after bucket ${bucket.bucket} missing`);
    if (loaded.sha256 !== bucket.after_sha256) {
      throw new Error(`stored after bucket ${bucket.bucket} checksum mismatch`);
    }
    return {
      bucket: bucket.bucket,
      path: bucket.path,
      value: loaded.value,
      sha256: loaded.sha256,
    };
  });
  return { plan: receipt.plan, planSha256, before, after };
}

async function assertPlanSource(plan: CanonicalLifecycleMigrationPlan): Promise<void> {
  const bootstrap = await readPublicJson("bootstrap/latest.json", BootstrapPublicationPointer, {
    optional: true,
  });
  const generation = bootstrap?.value.generation ?? null;
  if (
    generation !== plan.source.bootstrap_generation ||
    (bootstrap?.sha256 ?? null) !== plan.source.bootstrap_pointer_sha256
  ) {
    throw new Error("bootstrap pointer drifted from the reviewed migration plan");
  }

  const [views, publishedPointer, bootstrapLookup] = await Promise.all([
    readPublicJson("views/latest.json", ViewsPointer),
    readPublicJson(plan.source.published_whitelist_pointer_path, PublishedWhitelist),
    readPublicJson(plan.source.bootstrap_lookup_path, ReposLookup),
  ]);
  if (
    !views ||
    views.sha256 !== plan.source.views_pointer_sha256 ||
    !publishedPointer ||
    publishedPointer.sha256 !== plan.source.published_whitelist_pointer_sha256 ||
    !bootstrapLookup ||
    bootstrapLookup.sha256 !== plan.source.bootstrap_lookup_sha256
  ) {
    throw new Error("published pointer or bootstrap lookup drifted from the reviewed plan");
  }

  await mapLimit(
    plan.source.history,
    IO_CONCURRENCY,
    async (source: CanonicalLifecycleHistorySource) => {
      const loaded = await readPublicJson(source.path, WhitelistSnapshot);
      if (!loaded || loaded.sha256 !== source.sha256) {
        throw new Error(`${source.path} drifted from the reviewed plan`);
      }
    },
  );
}

async function canonicalPhysicalPaths(
  logicalPath: string,
  plan: CanonicalLifecycleMigrationPlan,
): Promise<string[]> {
  const generation = plan.source.bootstrap_generation;
  if (!generation) return [logicalPath];
  return [
    `bootstrap/overlays/${generation}/${logicalPath}`,
    `bootstrap/generations/${generation}/${logicalPath}`,
  ];
}

function executionDeps(
  token: string,
  plan: CanonicalLifecycleMigrationPlan,
): CanonicalLifecycleExecutionDeps {
  async function readCanonicalExact<T>(path: string, schema: ZodType<T>): Promise<T> {
    for (const physicalPath of await canonicalPhysicalPaths(path, plan)) {
      const loaded = await readStoredJson(physicalPath, schema, token, true);
      if (loaded) return loaded.value;
    }
    throw new Error(`${path} missing`);
  }

  return {
    claim: async ({ runId, idempotencyKey, trigger }) => {
      const acquiredAt = new Date().toISOString();
      const claim = await claimWorkflowLease({
        runId,
        acquiredAt,
        idempotencyKey,
        trigger,
      });
      if (claim.status !== "acquired") {
        throw new Error(
          `cannot migrate while workflow ${claim.lease.run_id} owns the shared lease until ${claim.lease.expires_at}`,
        );
      }
      return { runId: claim.lease.run_id, fencingToken: claim.lease.fencing_token };
    },
    release: (owner, status) =>
      releaseWorkflowLease(
        owner.runId,
        status,
        undefined,
        undefined,
        owner.fencingToken,
      ),
    assertSource: assertPlanSource,
    createExact: async (owner, path, value, expectedSha256) => {
      await createOwnedView(owner, path, value);
      const loaded = await readStoredJson(path, CanonicalLifecycleMigrationReceipt.or(ReposShard), token);
      if (!loaded || loaded.sha256 !== expectedSha256) {
        throw new Error(`${path} immutable receipt checksum mismatch`);
      }
    },
    readRepoShard: (bucket) =>
      readCanonicalExact(`canonical/v2/repos/${bucket}.json`, ReposShard),
    writeRepoShard: (owner, bucket, value) =>
      putOwnedView(owner, `canonical/v2/repos/${bucket}.json`, ReposShard.parse(value)),
    validateFull: async () => {
      const result = await validateCanonicalGeneration(
        `canonical-lifecycle-${plan.source.views_pointer.run_id}`,
        {
          reader: async (path, schema) => {
            for (const physicalPath of await canonicalPhysicalPaths(path, plan)) {
              const loaded = await readStoredJson(physicalPath, schema, token, true);
              if (loaded) return loaded.value;
            }
            return null;
          },
        },
      );
      return { complete: result.manifest.complete, failures: result.failures };
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadReadEnv();

  if (!args.execute) {
    const bundle = await loadLiveBundle(args.inventoryPath);
    if (args.planOut) writePlanFile(args.planOut, bundle);
    console.log(
      JSON.stringify(
        args.full
          ? { ...dryRunSummary(bundle), plan: bundle.plan }
          : dryRunSummary(bundle),
        null,
        2,
      ),
    );
    return;
  }

  const token = loadWriteEnv();
  const confirmed = args.confirm!;
  let bundle = await loadStoredBundle(confirmed, token);
  if (!bundle) {
    if (args.rollback) {
      throw new Error(`rollback receipt ${canonicalLifecycleReceiptPath(confirmed)} is missing`);
    }
    bundle = await loadLiveBundle(args.inventoryPath);
    if (bundle.planSha256 !== confirmed) {
      throw new Error(
        `live plan changed: confirmed ${confirmed}, current ${bundle.planSha256}; run dry-run again`,
      );
    }
  }
  if (args.planOut) writePlanFile(args.planOut, bundle);

  const deps = executionDeps(token, bundle.plan);
  const result = args.rollback
    ? await rollbackCanonicalLifecycleMigration(bundle, confirmed, deps)
    : await executeCanonicalLifecycleMigration(bundle, confirmed, deps);
  console.log(JSON.stringify({ mode: args.rollback ? "rollback" : "execute", ...result }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
