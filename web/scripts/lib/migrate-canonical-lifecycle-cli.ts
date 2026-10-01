import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CanonicalLifecycleMigrationBundle,
  CanonicalLifecycleMigrationPlan,
} from "@/lib/migrations/canonical-lifecycle";
import { takeOpsFlags, type OpsSelection } from "@/lib/storage/ops-target";

export type CanonicalLifecycleArgs = {
  execute: boolean;
  dry: boolean;
  confirm: string | null;
  rollback: string | null;
  inventoryPath: string;
  planOut: string | null;
  full: boolean;
};

export type PreparedCanonicalLifecycleRun =
  | { kind: "help" }
  | { kind: "ready"; selection: OpsSelection; args: CanonicalLifecycleArgs };

export function canonicalLifecycleUsage(): string {
  return [
    "Usage:",
    "  bun scripts/migrate-canonical-lifecycle.ts [--store blob|r2] [--target prod|pre] [--full] [--plan-out <file>]",
    "  bun scripts/migrate-canonical-lifecycle.ts --execute --confirm <plan-sha256>",
    "  bun scripts/migrate-canonical-lifecycle.ts --store r2 --target pre --execute --confirm <plan-sha256>",
    "  bun scripts/migrate-canonical-lifecycle.ts --rollback <plan-sha256> --execute --confirm <same-sha256>",
    "",
    "Options:",
    "  --store blob|r2     Default blob. r2 requires --target prod|pre.",
    "  --target prod|pre   Required with --store r2. Refused unless --store r2.",
    "  --inventory <file>  Reviewed immutable whitelist history inventory.",
    "  --plan-out <file>   Create a local full-plan JSON file; existing unequal files are refused.",
    "  --full              Print the full deterministic plan to stdout.",
    "  --execute           Enable guarded object-store mutation. Omitted by default.",
    "  --dry, --dry-run    Force zero writes even when --execute is present.",
    "  --confirm <sha>     Exact reviewed plan SHA-256 required by --execute.",
    "  --rollback <sha>    Restore the immutable before-state receipt for this plan.",
  ].join("\n");
}

export function parseCanonicalLifecycleArgs(
  argv: readonly string[],
  defaultInventoryPath: string,
): { kind: "help" } | { kind: "run"; args: CanonicalLifecycleArgs } {
  let execute = false;
  let dry = false;
  let confirm: string | null = null;
  let rollback: string | null = null;
  let inventoryPath = defaultInventoryPath;
  let planOut: string | null = null;
  let full = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--execute") execute = true;
    else if (arg === "--dry" || arg === "--dry-run") dry = true;
    else if (arg === "--full") full = true;
    else if (arg === "--confirm") confirm = argv[++index] ?? "";
    else if (arg.startsWith("--confirm=")) confirm = arg.slice("--confirm=".length);
    else if (arg === "--rollback") rollback = argv[++index] ?? "";
    else if (arg.startsWith("--rollback=")) rollback = arg.slice("--rollback=".length);
    else if (arg === "--inventory") inventoryPath = resolve(argv[++index] ?? "");
    else if (arg.startsWith("--inventory=")) inventoryPath = resolve(arg.slice("--inventory=".length));
    else if (arg === "--plan-out") planOut = resolve(argv[++index] ?? "");
    else if (arg.startsWith("--plan-out=")) planOut = resolve(arg.slice("--plan-out=".length));
    else if (arg === "-h" || arg === "--help") return { kind: "help" };
    else throw new Error(`unknown argument ${arg}\n\n${canonicalLifecycleUsage()}`);
  }

  const digest = /^[a-f0-9]{64}$/;
  if (confirm !== null && !digest.test(confirm)) throw new Error("--confirm must be a lowercase SHA-256");
  if (rollback !== null && !digest.test(rollback)) throw new Error("--rollback must be a lowercase SHA-256");
  if (execute && confirm === null) throw new Error("--execute requires --confirm <plan-sha256>");
  if (rollback !== null && !execute) throw new Error("--rollback requires --execute");
  if (rollback !== null && rollback !== confirm) {
    throw new Error("--rollback and --confirm must name the same plan SHA-256");
  }
  return {
    kind: "run",
    args: { execute: execute && !dry, dry, confirm, rollback, inventoryPath, planOut, full },
  };
}

/** Help wins before store-target checks, matching the CLI entry. */
export function prepareCanonicalLifecycleRun(
  argv: readonly string[],
  defaultInventoryPath: string,
): PreparedCanonicalLifecycleRun {
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  const { selection, rest } = takeOpsFlags(argv);
  const parsed = parseCanonicalLifecycleArgs(rest, defaultInventoryPath);
  if (parsed.kind === "help") return { kind: "help" };
  return { kind: "ready", selection, args: parsed.args };
}

export async function mapLimit<T, R>(
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

export function writeCanonicalLifecyclePlanFile(path: string, bundle: CanonicalLifecycleMigrationBundle): void {
  const content = `${JSON.stringify({ plan_sha256: bundle.planSha256, plan: bundle.plan }, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error(`refusing to overwrite unequal plan file ${path}`);
    }
    return;
  }
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
}

export function canonicalLifecycleDryRunSummary(bundle: CanonicalLifecycleMigrationBundle) {
  const recoveredByDate: Record<string, number> = {};
  for (const bucket of bundle.plan.buckets) {
    for (const recovery of bucket.tracked_since_recoveries) {
      recoveredByDate[recovery.tracked_since] = (recoveredByDate[recovery.tracked_since] ?? 0) + 1;
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

export async function canonicalPhysicalPaths(
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
