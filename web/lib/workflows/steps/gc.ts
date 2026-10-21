import { z } from "zod";
import { putOwnedView } from "../owned-write";
import type { RefreshCursor } from "../runtime/types";
import { isSubrequestLimitError } from "../runtime/subrequest-limit";
import { readAuthoritativeView } from "@/lib/data/source";
import { BootstrapPublicationPointer, ViewsPointer, WorkflowLease } from "@/lib/contracts";
import { getWriteObjectStore } from "@/lib/storage";
import { listObjectFolders } from "@/lib/storage/list-folders";
import {
  executeBlobDeletionPlan,
  planBlobPrefixDeletion,
  type BlobDeletionContext,
} from "@/lib/blob-deletion";
import { renewWorkflowLease } from "@/lib/workflows/lease";

// Version GC. After publish, keep the newest KEEP versions plus the live pointer's
// version + prev_version (the rollback target), and delete older orphan versions under views/.
// Best-effort: never throws — a cleanup failure must not fail an already-published run.
// See docs/VERCEL-DATA-OPERATIONS.md §7 (retain near N).

const GcProgressSchema = z.object({
  phase: z.enum(["list", "delete"]),
  cursor: z.string().optional(),
  versions: z.array(z.string()),
  targets: z.array(z.string()),
  deleted: z.array(z.string()),
  kept: z.number().int().nonnegative(),
});
type GcProgress = z.infer<typeof GcProgressSchema>;

const KEEP = 4;
const DEL_CHUNK = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GcResult {
  /** Versions whose deletion plan completed in full. */
  deleted: string[];
  /** Listed versions not confirmed fully deleted, including failed/unattempted ones. */
  kept: number;
  failed: Array<{ version: string; error: string }>;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readProtectionContext(runId: string): Promise<BlobDeletionContext> {
  const [pointer, bootstrap, active] = await Promise.all([
    readAuthoritativeView("views/latest.json", ViewsPointer, { bust: runId }),
    readAuthoritativeView("bootstrap/latest.json", BootstrapPublicationPointer, { bust: runId }),
    readAuthoritativeView("ops/workflows/active.json", WorkflowLease, { bust: runId }),
  ]);
  const activeWorkflowRun =
    active?.status === "running" && Date.parse(active.expires_at) > Date.now() ? active.run_id : null;
  return {
    currentViewVersion: pointer?.version,
    rollbackViewVersion: pointer?.prev_version,
    activeWorkflowRun,
    currentBootstrapGeneration: bootstrap?.generation,
    rollbackBootstrapGeneration: bootstrap?.previous_generation,
  };
}

export async function gcVersions(
  runId: string,
  fencingToken: number,
): Promise<GcResult> {
  const result: GcResult = { deleted: [], kept: 0, failed: [] };
  try {
    const store = getWriteObjectStore();
    const ensureOwnership = () => renewWorkflowLease(runId, fencingToken).then(() => undefined);
    await ensureOwnership();
    const protection = await readProtectionContext(runId);
    const keep = new Set<string>([runId]);
    if (protection.currentViewVersion) keep.add(protection.currentViewVersion);
    if (protection.rollbackViewVersion) keep.add(protection.rollbackViewVersion);
    if (protection.activeWorkflowRun) keep.add(protection.activeWorkflowRun);

    const folders = await listObjectFolders(store, "views/");
    const versions = [...new Set(folders.map((f) => f.slice("views/".length).replace(/\/+$/, "")).filter(Boolean))]
      .sort()
      .reverse(); // newest first (run_id timestamps sort lexically)
    result.kept = versions.length;
    for (const v of versions.slice(0, KEEP)) keep.add(v);

    const toDelete = versions.filter((v) => !keep.has(v));
    const guard = {
      ensureOwnership,
      readContext: () => readProtectionContext(runId),
    };
    for (const v of toDelete) {
      try {
        const prefix = `views/${v}/`;
        const plan = await planBlobPrefixDeletion(prefix, await readProtectionContext(runId), ({ cursor, limit }) =>
          store.list({ prefix, cursor, limit }),
        );
        await executeBlobDeletionPlan(plan, plan.prefix, guard, (urls) => deleteUrls(urls, store), DEL_CHUNK);
        result.deleted.push(v);
        result.kept--;
      } catch (err) {
        result.failed.push({ version: v, error: errorMessage(err) });
        throw err; // Stop after a failure; a later retry re-lists the remaining objects.
      }
    }
    return result;
  } catch (err) {
    result.error = errorMessage(err);
    return result;
  }
}

async function deleteUrls(urls: string[], store: ReturnType<typeof getWriteObjectStore>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await store.del(urls);
      break;
    } catch (err) {
      const retryAfter = (err as { retryAfter?: number })?.retryAfter;
      if (retryAfter && attempt < 5) {
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      throw err;
    }
  }
  await sleep(250); // throttle under the Blob delete-rate limit
}

/** One inventory page or one guarded delete batch per queue invocation. */
export async function runGcStep(runId: string, fencingToken: number, cursor: RefreshCursor = {}): Promise<GcResult & { nextWorkOffset?: number }> {
  const offset = cursor.workOffset ?? 0;
  const owner = { runId, fencingToken };
  const statePath = (page: number) => `ops/workflows/${runId}/gc/progress-${page}.json`;
  let state: GcProgress = { phase: "list", versions: [], targets: [], deleted: [], kept: 0 };
  try {
    const store = getWriteObjectStore();
    const ensureOwnership = () => renewWorkflowLease(runId, fencingToken).then(() => undefined);
    await ensureOwnership();
    if (offset > 0) {
      const previous = await readAuthoritativeView(statePath(offset), GcProgressSchema, { bust: runId });
      if (!previous) throw new Error(`gc page ${offset}: missing predecessor checkpoint`);
      state = previous;
    }
    const protection = await readProtectionContext(runId);
    if (state.phase === "list") {
      const page = await store.list({ prefix: "views/", mode: "folded", limit: 1000, cursor: state.cursor });
      state.versions = [...new Set([...state.versions, ...page.folders.map((folder) => folder.slice("views/".length).replace(/\/+$/, "")).filter(Boolean)])];
      if (page.hasMore) {
        if (!page.cursor || page.cursor === state.cursor) throw new Error("gc inventory: invalid pagination cursor");
        state.cursor = page.cursor;
      } else {
        state.versions.sort().reverse();
        const keep = new Set([runId, protection.currentViewVersion, protection.rollbackViewVersion, protection.activeWorkflowRun, ...state.versions.slice(0, KEEP)]);
        state.targets = state.versions.filter((version) => !keep.has(version));
        state.kept = state.versions.length;
        state.phase = "delete";
        delete state.cursor;
      }
    } else if (state.targets.length > 0) {
      const version = state.targets[0]!;
      const prefix = `views/${version}/`;
      // Re-list from the start after each deletion: opaque/index cursors may
      // skip objects when the preceding page has just been removed.
      const page = await store.list({ prefix, limit: DEL_CHUNK });
      if (page.hasMore && page.blobs.length === 0) throw new Error(`gc ${version}: empty truncated deletion page`);
      const plan = await planBlobPrefixDeletion(prefix, protection, async () => ({ blobs: page.blobs }));
      await executeBlobDeletionPlan(plan, prefix, { ensureOwnership, readContext: () => readProtectionContext(runId) }, (urls) => deleteUrls(urls, store), DEL_CHUNK);
      if (!page.hasMore) {
        state.deleted.push(version);
        state.targets.shift();
        state.kept--;
      }
    }
    const result = { deleted: state.deleted, kept: state.kept, failed: [] };
    if (state.phase === "delete" && state.targets.length === 0) return result;
    await putOwnedView(owner, statePath(offset + 1), state);
    return { ...result, nextWorkOffset: offset + 1 };
  } catch (error) {
    if (isSubrequestLimitError(error)) throw error;
    const message = errorMessage(error);
    return { deleted: state.deleted, kept: state.kept, failed: state.phase === "delete" && state.targets[0] ? [{ version: state.targets[0], error: message }] : [], error: message };
  }
}
