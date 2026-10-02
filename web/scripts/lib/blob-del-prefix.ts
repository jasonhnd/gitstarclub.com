import type { BlobDeletionContext } from "@/lib/blob-deletion";
import { firstPositional, splitConfirmArg, takeOpsFlags, type OpsSelection } from "@/lib/storage/ops-target";

export const BLOB_DEL_PREFIX_USAGE =
  "usage: bun scripts/blob-del-prefix.ts [--store blob|r2] [--target prod|pre] <specific-prefix/> [--execute --confirm <same-prefix/>]\n--target requires --store r2.";

export type BlobDelPrefixDecision =
  | { action: "help" }
  | { action: "error"; message: string }
  | {
      action: "run";
      selection: OpsSelection;
      prefix: string;
      execute: boolean;
      confirmation: string | undefined;
    };

type ViewsPointerLike = { version?: string | null; prev_version?: string | null } | null;
type BootstrapPointerLike = { generation?: string | null; previous_generation?: string | null } | null;
type ActiveLeaseLike = { status: string; expires_at: string; run_id: string } | null;

/** Same argv decisions as the prefix-deletion CLI, without touching a store. */
export function interpretBlobDelPrefixArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): BlobDelPrefixDecision {
  if (argv.includes("--help") || argv.includes("-h")) return { action: "help" };
  const { selection, rest } = takeOpsFlags(argv);
  const dry = rest.includes("--dry") || rest.includes("--dry-run");
  const execute = rest.includes("--execute") && !dry;
  const { confirm: confirmation } = splitConfirmArg(rest);
  const prefix = firstPositional(rest);
  if (selection.store === "blob" && !env.BLOB_READ_WRITE_TOKEN) {
    return { action: "error", message: "BLOB_READ_WRITE_TOKEN not set" };
  }
  if (!prefix) return { action: "error", message: BLOB_DEL_PREFIX_USAGE };
  return { action: "run", selection, prefix, execute, confirmation };
}

/** Map the three protection pointers into the deletion context the CLI sends. */
export function deletionContextFromPointers(
  views: ViewsPointerLike,
  bootstrap: BootstrapPointerLike,
  active: ActiveLeaseLike,
  now: number,
): BlobDeletionContext {
  const activeWorkflowRun =
    active?.status === "running" && Date.parse(active.expires_at) > now ? active.run_id : null;
  return {
    currentViewVersion: views?.version,
    rollbackViewVersion: views?.prev_version,
    activeWorkflowRun,
    currentBootstrapGeneration: bootstrap?.generation,
    rollbackBootstrapGeneration: bootstrap?.previous_generation,
  };
}

export function assertDeleteConfirmation(
  confirmation: string | undefined,
  prefix: string,
): asserts confirmation is string {
  if (confirmation !== prefix) {
    throw new Error(`--confirm must exactly equal "${prefix}"`);
  }
}
