import { StaticAssetsCacheAdapter } from "@vinext/cloudflare/cache/static-assets-adapter.runtime";
import { DefaultCdnCacheAdapter } from "vinext/shims/cdn-cache";
import type { CacheHandlerValue, IncrementalCacheValue } from "vinext/shims/cache";
import { cacheScope } from "./context";
import { ArtifactStore, cacheValue, type CacheKV, type HotCache, type StoredEntry } from "./store";
import { boundedTags, isLongTail, pathTags, TAIL_EXPIRE_SECONDS, TAIL_FRESH_SECONDS } from "./policy";

type Env = { GSC_CACHE: CacheKV; ASSETS: { fetch(input: string | Request): Promise<Response> }; DEPLOY_ENV?: string };
const pointerTags = new Set(["published-views-pointer", "bootstrap-publication-pointer"]);

export class HybridPageCache extends DefaultCdnCacheAdapter {
  readonly hasPrerenderedPages = true;
  readonly store: ArtifactStore;
  readonly snapshots: StaticAssetsCacheAdapter;
  constructor(env: Env, readonly snapshotFence: string, hot?: HotCache) {
    super(process.env.__VINEXT_RSC_BUILD_IDENTITY || process.env.__VINEXT_BUILD_ID);
    this.store = new ArtifactStore(env.GSC_CACHE, `gsc:${env.DEPLOY_ENV}:pages:v1`, hot);
    this.snapshots = new StaticAssetsCacheAdapter(env.ASSETS);
  }
  async get(key: string): Promise<CacheHandlerValue | null> {
    const scope = cacheScope.getStore();
    if (!scope || scope.bypass) return null;
    const tail = isLongTail(scope.path);
    const fence = tail ? "tail" : scope.publication.id;
    const storageKey = `${fence}:${key}`;
    let entry: StoredEntry | null = null;
    let snapshot = false;
    try {
      entry = await this.store.get(storageKey);
      if (!entry && !tail && scope.publication.id === this.snapshotFence) {
        const value = await this.snapshots.get(key);
        if (value) {
          entry = { ...value, v: 1, fence, tags: pathTags(scope.path) };
          if (await this.store.invalid(entry)) entry = null;
          snapshot = entry !== null;
        }
      }
      if (entry?.fence !== fence) entry = null;
    } catch (error) {
      console.warn("[host-cache] page read failed", error instanceof Error ? error.name : "unknown");
    }
    if (!entry) { scope.status = "MISS"; return null; }
    const age = (Date.now() - entry.lastModified) / 1000;
    const policy = entry.cacheControl;
    if (policy?.expire !== undefined && age >= policy.expire) { scope.status = "MISS"; return null; }
    const stale = typeof policy?.revalidate === "number" && age >= policy.revalidate;
    scope.status = stale ? "STALE" : snapshot ? "SNAPSHOT" : "HIT";
    return { ...entry, cacheState: stale ? "stale" : "fresh" };
  }
  async set(key: string, data: IncrementalCacheValue | null, ctx: Record<string, unknown> = {}): Promise<void> {
    const scope = cacheScope.getStore();
    if (!scope || scope.bypass) return;
    const tail = isLongTail(scope.path);
    const tags = boundedTags([...new Set([...boundedTags(ctx.tags ?? []), ...pathTags(scope.path)])])
      .filter((tag) => !tail || !pointerTags.has(tag));
    const fence = tail ? "tail" : scope.publication.id;
    const entry = cacheValue(data, ctx, fence, tags);
    if (tail) entry.cacheControl = { revalidate: TAIL_FRESH_SECONDS, expire: TAIL_EXPIRE_SECONDS };
    try {
      if (!tail && (await scope.checkPublication()).id !== scope.publication.id) return;
      if (await this.store.invalid({ ...entry, lastModified: scope.startedAt })) return;
      await this.store.set(`${fence}:${key}`, entry);
    } catch (error) {
      console.warn("[host-cache] page write failed", error instanceof Error ? error.name : "unknown");
    }
  }
  async revalidateTag(tags: string | string[]): Promise<void> { await this.store.revalidateTag(tags); }
}

export default function pageAdapter({ env, options }: { env?: Env; options?: { snapshotFence?: string } } = {}) {
  if (process.env.VINEXT_PRERENDER === "1") return new DefaultCdnCacheAdapter();
  if (!env?.GSC_CACHE || !env.ASSETS) throw new Error("Host cache/asset bindings required");
  const hot = (globalThis.caches as unknown as { default?: HotCache })?.default;
  return new HybridPageCache(env, options?.snapshotFence ?? "", hot);
}
