import { revalidatePath, revalidateTag } from "next/cache";
import { readView, VIEWS_LATEST_POINTER_TAG } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { LatestSuccess, ViewsPointer } from "@/lib/contracts";
import { SCHEMA_VER } from "@/lib/data/meta";
import { submitWorkflowPublishIndexNow } from "@/lib/indexnow";

// Publish step: atomically flips views/latest.json to the new version (a single-file
// overwrite), after which the read side resolves the new version. prev_version is retained
// so rollback is one pointer write back. Runs only after validateVersion passes.
// See docs/VERCEL-DATA-OPERATIONS.md §7.

/** Paths that read the base publish pointer and must not serve a pre-publish ISR shell. */
const REVALIDATE_AFTER_PUBLISH = ["/", "/about", "/search-index", "/rankings", "/pulse", "/categories", "/o"];

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

  // Best-effort: drop ISR shells + the tagged publish-pointer fetch cache so
  // About/search resolve the new version immediately. Failures must never undo
  // a successful pointer flip.
  try {
    revalidateTag(VIEWS_LATEST_POINTER_TAG, "max");
  } catch (error) {
    console.warn("[workflow-publish] revalidateTag failed", {
      tag: VIEWS_LATEST_POINTER_TAG,
      run_id: runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  for (const path of REVALIDATE_AFTER_PUBLISH) {
    try {
      revalidatePath(path);
    } catch (error) {
      console.warn("[workflow-publish] revalidatePath failed", {
        path,
        run_id: runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { version: runId, prev_version: prevVersion, published_at: publishedAt };
}
