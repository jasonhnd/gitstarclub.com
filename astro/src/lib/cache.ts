import { ArtifactStore, type CacheKV, type HotCache } from "../../../web/lib/workers-host/cache/store";

export function pageCache(kv: CacheKV, build: string, hot?: HotCache) {
  return new ArtifactStore(kv, `gsc:astro:gate0:${build}`, hot);
}

/** P7 authenticates the callback, then awaits this shared path invalidation. */
export async function invalidatePagePaths(store: ArtifactStore, paths: string[]): Promise<void> {
  if (paths.some((path) => !path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path))) throw new Error("Invalid cache path");
  await store.revalidateTag([...new Set(paths)]);
}
