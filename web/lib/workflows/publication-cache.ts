import { BOOTSTRAP_POINTER_CACHE_TAG, PUBLISHED_VIEWS_CACHE_TAG } from "@/lib/data/publication-cache-contract";
import { corePublicationRevalidatePaths } from "@/lib/data/core-revalidate-paths";
import { invalidatePublishedVersionMemo } from "@/lib/data/source";

/**
 * Make a pointer switch observable to both data-cache consumers and rendered
 * core routes. Long-tail repo/org/category pages stay on their ISR TTL instead
 * of a site-wide layout purge that rewrites every crawled segment.
 */
export async function invalidatePublishedViews(): Promise<void> {
  invalidatePublishedVersionMemo();
  // Dynamic import keeps Bun's test runner compatible with next/cache's CJS
  // wrapper. This module is used only by the authenticated Next route, never
  // bundled into a Workflow function.
  const nextCache = await import("next/cache");
  nextCache.revalidateTag(PUBLISHED_VIEWS_CACHE_TAG, { expire: 0 });
  nextCache.revalidateTag(BOOTSTRAP_POINTER_CACHE_TAG, { expire: 0 });
  for (const path of corePublicationRevalidatePaths()) {
    nextCache.revalidatePath(path);
  }
}
