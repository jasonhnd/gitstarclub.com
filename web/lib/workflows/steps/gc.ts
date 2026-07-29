import { list, del } from "@vercel/blob";
import { readAuthoritativeView } from "@/lib/data/source";
import { BootstrapPublicationPointer, ViewsPointer, WorkflowLease } from "@/lib/contracts";
import { requireBlobWriteToken } from "@/lib/runtime-config";
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
): Promise<{ deleted: string[]; kept: number; error?: string }> {
  "use step";
  try {
    const token = requireBlobWriteToken();
    const ensureOwnership = () => renewWorkflowLease(runId, fencingToken).then(() => undefined);
    await ensureOwnership();
    const protection = await readProtectionContext(runId);
    const keep = new Set<string>([runId]);
    if (protection.currentViewVersion) keep.add(protection.currentViewVersion);
    if (protection.rollbackViewVersion) keep.add(protection.rollbackViewVersion);
    if (protection.activeWorkflowRun) keep.add(protection.activeWorkflowRun);

    const { folders } = await list({ prefix: "views/", mode: "folded", token });
    const versions = [...new Set(folders.map((f) => f.slice("views/".length).replace(/\/+$/, "")).filter(Boolean))]
      .sort()
      .reverse(); // newest first (run_id timestamps sort lexically)
    for (const v of versions.slice(0, KEEP)) keep.add(v);

    const toDelete = versions.filter((v) => !keep.has(v));
    const guard = {
      ensureOwnership,
      readContext: () => readProtectionContext(runId),
    };
    for (const v of toDelete) {
      const prefix = `views/${v}/`;
      const plan = await planBlobPrefixDeletion(prefix, await readProtectionContext(runId), ({ cursor, limit }) =>
        list({ prefix, cursor, limit, token }),
      );
      await executeBlobDeletionPlan(plan, plan.prefix, guard, (urls) => deleteUrls(urls, token), DEL_CHUNK);
    }
    return { deleted: toDelete, kept: versions.length - toDelete.length };
  } catch (err) {
    return { deleted: [], kept: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function deleteUrls(urls: string[], token: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await del(urls, { token });
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
