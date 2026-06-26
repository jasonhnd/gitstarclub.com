import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { LatestSuccess, ViewsPointer } from "@/lib/contracts";
import { SCHEMA_VER } from "@/lib/data/meta";
import { submitWorkflowPublishIndexNow } from "@/lib/indexnow";

// Publish step: atomically flips views/latest.json to the new version (a single-file
// overwrite), after which the read side resolves the new version. prev_version is retained
// so rollback is one pointer write back. Runs only after validateVersion passes.
// See docs/VERCEL-DATA-OPERATIONS.md §7.

export async function publishVersion(runId: string): Promise<{ version: string; prev_version: string | null; published_at: string }> {
  "use step";

  // current pointer becomes prev_version; tolerate absent/legacy pointer on first publish.
  let prevVersion: string | null = null;
  try {
    const prev = await readView("views/latest.json", ViewsPointer, { bust: runId });
    prevVersion = prev?.version ?? null;
  } catch {
    prevVersion = null;
  }

  const publishedAt = new Date().toISOString();
  const pointer = { version: runId, run_id: runId, published_at: publishedAt, prev_version: prevVersion, schema_ver: SCHEMA_VER };
  ViewsPointer.parse(pointer);
  await putView("views/latest.json", pointer); // atomic switch

  const recovery = { run_id: runId, version: runId, published_at: publishedAt };
  LatestSuccess.parse(recovery);
  await putView("ops/workflows/latest-success.json", recovery);
  await submitWorkflowPublishIndexNow({ runId, prevVersion, publishedAt });

  return { version: runId, prev_version: prevVersion, published_at: publishedAt };
}
