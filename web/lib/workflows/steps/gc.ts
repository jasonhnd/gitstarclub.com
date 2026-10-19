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
