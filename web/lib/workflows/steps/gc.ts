import { list, del } from "@vercel/blob";
import { readView } from "@/lib/data/source";
import { BootstrapPublicationPointer, ViewsPointer, WorkflowLease } from "@/lib/contracts";
import { requireBlobWriteToken } from "@/lib/runtime-config";
import { assertBlobDeletionAllowed, type BlobDeletionContext } from "@/lib/blob-deletion";

// Version GC. After publish, keep the newest KEEP versions plus the live pointer's
// version + prev_version (the rollback target), and delete older orphan versions under views/.
// Best-effort: never throws — a cleanup failure must not fail an already-published run.
// See docs/VERCEL-DATA-OPERATIONS.md §7 (retain near N).

const KEEP = 4;
const DEL_CHUNK = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gcVersions(runId: string): Promise<{ deleted: string[]; kept: number; error?: string }> {
  "use step";
  try {
    const token = requireBlobWriteToken();

    const [pointer, bootstrap, active] = await Promise.all([
      readView("views/latest.json", ViewsPointer, { bust: runId }),
      readView("bootstrap/latest.json", BootstrapPublicationPointer, { bust: runId }),
      readView("ops/workflows/active.json", WorkflowLease, { bust: runId }),
    ]);
    const keep = new Set<string>([runId]);
    if (pointer) {
      keep.add(pointer.version);
      if (pointer.prev_version) keep.add(pointer.prev_version);
    }
    const activeWorkflowRun =
      active?.status === "running" && Date.parse(active.expires_at) > Date.now() ? active.run_id : null;
    if (activeWorkflowRun) keep.add(activeWorkflowRun);

    const { folders } = await list({ prefix: "views/", mode: "folded", token });
    const versions = [...new Set(folders.map((f) => f.slice("views/".length).replace(/\/+$/, "")).filter(Boolean))]
      .sort()
      .reverse(); // newest first (run_id timestamps sort lexically)
    for (const v of versions.slice(0, KEEP)) keep.add(v);

    const toDelete = versions.filter((v) => !keep.has(v));
    const protection: BlobDeletionContext = {
      currentViewVersion: pointer?.version,
      rollbackViewVersion: pointer?.prev_version,
      activeWorkflowRun,
      currentBootstrapGeneration: bootstrap?.generation,
      rollbackBootstrapGeneration: bootstrap?.previous_generation,
    };
    for (const v of toDelete) {
      const prefix = assertBlobDeletionAllowed(`views/${v}/`, protection);
      await deletePrefix(prefix, token);
    }
    return { deleted: toDelete, kept: versions.length - toDelete.length };
  } catch (err) {
    return { deleted: [], kept: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function deletePrefix(prefix: string, token: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const res = await list({ prefix, cursor, limit: 1000, token });
    for (let i = 0; i < res.blobs.length; i += DEL_CHUNK) {
      const urls = res.blobs.slice(i, i + DEL_CHUNK).map((b) => b.url);
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
    cursor = res.cursor;
  } while (cursor);
}
