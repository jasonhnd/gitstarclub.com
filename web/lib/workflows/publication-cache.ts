import { resolveCacheInvalidation, type CacheInvalidationPort } from "@/lib/cache-invalidation";
import { BOOTSTRAP_POINTER_CACHE_TAG, PUBLISHED_VIEWS_CACHE_TAG } from "@/lib/data/publication-cache-contract";
import { corePublicationRevalidatePaths } from "@/lib/data/core-revalidate-paths";
import { invalidatePublishedVersionMemo } from "@/lib/data/source";

/**
 * Make a pointer switch observable to both data-cache consumers and rendered
 * core routes. Long-tail repo/org/category pages stay on their ISR TTL instead
 * of a site-wide layout purge that rewrites every crawled segment.
 *
 * Default driver is Vercel `revalidatePath` / `revalidateTag`. Tests and the
 * non-production CF stub inject `CacheInvalidationPort`.
 */
export async function invalidatePublishedViews(
  cache: CacheInvalidationPort = resolveCacheInvalidation(),
): Promise<void> {
  invalidatePublishedVersionMemo();
  await cache.revalidateTag(PUBLISHED_VIEWS_CACHE_TAG, { expire: 0 });
  await cache.revalidateTag(BOOTSTRAP_POINTER_CACHE_TAG, { expire: 0 });
  for (const path of corePublicationRevalidatePaths()) {
    await cache.revalidatePath(path);
  }
}
