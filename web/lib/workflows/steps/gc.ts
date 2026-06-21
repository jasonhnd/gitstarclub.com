import { list, del } from "@vercel/blob";
import { readView } from "@/lib/data/source";
import { ViewsPointer } from "@/lib/contracts";

// Version GC. After publish, keep the newest KEEP versions plus the live pointer's
// version + prev_version (the rollback target), and delete older orphan versions under views/.
// Best-effort: never throws — a cleanup failure must not fail an already-published run.
// See docs/VERCEL-DATA-OPERATIONS.md §7 (retain near N).

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const KEEP = 4;
const DEL_CHUNK = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gcVersions(runId: string): Promise<{ deleted: string[]; kept: number; error?: string }> {
  "use step";
  try {
    if (!TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set");

    const pointer = await readView("views/latest.json", ViewsPointer, { bust: runId });
    const keep = new Set<string>([runId]);
    if (pointer) {
      keep.add(pointer.version);
      if (pointer.prev_version) keep.add(pointer.prev_version);
    }

    const { folders } = await list({ prefix: "views/", mode: "folded", token: TOKEN });
    const versions = [...new Set(folders.map((f) => f.slice("views/".length).replace(/\/+$/, "")).filter(Boolean))]
      .sort()
      .reverse(); // newest first (run_id timestamps sort lexically)
    for (const v of versions.slice(0, KEEP)) keep.add(v);

    const toDelete = versions.filter((v) => !keep.has(v));
    for (const v of toDelete) await deletePrefix(`views/${v}/`);
    return { deleted: toDelete, kept: versions.length - toDelete.length };
  } catch (err) {
    return { deleted: [], kept: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function deletePrefix(prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const res = await list({ prefix, cursor, limit: 1000, token: TOKEN });
    for (let i = 0; i < res.blobs.length; i += DEL_CHUNK) {
      const urls = res.blobs.slice(i, i + DEL_CHUNK).map((b) => b.url);
      for (let attempt = 0; ; attempt++) {
        try {
          await del(urls, { token: TOKEN });
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
