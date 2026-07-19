import { PUBLISHED_VIEWS_CACHE_TAG } from "@/lib/data/publication-cache-contract";
import { invalidatePublishedVersionMemo } from "@/lib/data/source";

/**
 * Make a pointer switch observable to both data-cache consumers and rendered
 * routes. Other warm function instances retain only the bounded 60s memo.
 */
export async function invalidatePublishedViews(): Promise<void> {
  invalidatePublishedVersionMemo();
  // Dynamic import keeps Bun's test runner compatible with next/cache's CJS
  // wrapper. This module is used only by the authenticated Next route, never
  // bundled into a Workflow function.
  const nextCache = await import("next/cache");
  nextCache.revalidateTag(PUBLISHED_VIEWS_CACHE_TAG, { expire: 0 });
  nextCache.revalidatePath("/", "layout");
}
