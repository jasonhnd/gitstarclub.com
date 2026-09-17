import type { CacheInvalidationPort, NextCacheApi, RevalidateTagOptions, RevalidateType } from "./types";

/**
 * Load next/cache at call time. Documented dynamic import: Bun's test runner
 * cannot statically evaluate next/cache's CJS wrapper, and this module is only
 * used by the authenticated Next revalidate route / live cron — never bundled
 * into a Workflow function.
 */
async function loadNextCache(): Promise<NextCacheApi> {
  return import("next/cache");
}

/** Production default: wrap Next.js `revalidatePath` / `revalidateTag`. */
export class VercelCacheInvalidation implements CacheInvalidationPort {
  constructor(private readonly nextCache?: NextCacheApi) {}

  async revalidatePath(path: string, type?: RevalidateType): Promise<void> {
    const nextCache = this.nextCache ?? (await loadNextCache());
    nextCache.revalidatePath(path, type);
  }

  async revalidateTag(tag: string, options?: RevalidateTagOptions): Promise<void> {
    const nextCache = this.nextCache ?? (await loadNextCache());
    nextCache.revalidateTag(tag, options ?? { expire: 0 });
  }
}
