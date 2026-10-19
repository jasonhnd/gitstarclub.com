import { MemoryCacheHandler, type CacheHandlerValue, type IncrementalCacheValue } from "vinext/shims/cache";
import { cacheScope } from "./context";
import { ArtifactStore, cacheValue, type CacheKV } from "./store";
import { boundedTags } from "./policy";

/** All pointer-dependent fetch/function data is scoped to the captured strong publication. */
export class FencedDataCache {
  readonly store: ArtifactStore;
  constructor(env: { GSC_CACHE: CacheKV; DEPLOY_ENV?: string }) {
    this.store = new ArtifactStore(env.GSC_CACHE, `gsc:${env.DEPLOY_ENV}:data:v1`);
  }
  async get(key: string): Promise<CacheHandlerValue | null> {
    const scope = cacheScope.getStore();
    if (!scope) return null;
    try {
      const entry = await this.store.get(`${scope.publication.id}:${key}`);
      return entry?.fence === scope.publication.id ? entry : null;
    } catch { return null; }
  }
  async set(key: string, data: IncrementalCacheValue | null, ctx: Record<string, unknown> = {}): Promise<void> {
    const scope = cacheScope.getStore();
    if (!scope) return;
    try {
      if ((await scope.checkPublication()).id !== scope.publication.id) return;
      const entry = cacheValue(data, ctx, scope.publication.id, boundedTags(ctx.tags ?? []));
      if (await this.store.invalid({ ...entry, lastModified: scope.startedAt })) return;
      await this.store.set(`${scope.publication.id}:${key}`, entry);
    } catch (error) {
      console.warn("[host-cache] data write failed", error instanceof Error ? error.name : "unknown");
    }
  }
  async revalidateTag(tags: string | string[]): Promise<void> { await this.store.revalidateTag(tags); }
}
export default function dataAdapter({ env }: { env?: { GSC_CACHE: CacheKV; DEPLOY_ENV?: string } } = {}) {
  if (process.env.VINEXT_PRERENDER === "1") return new MemoryCacheHandler();
  if (!env?.GSC_CACHE) throw new Error("Host data cache binding required");
  return new FencedDataCache(env);
}
