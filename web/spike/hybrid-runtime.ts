import { StaticAssetsCacheAdapter } from "@vinext/cloudflare/cache/static-assets-adapter.runtime";
import { DefaultCdnCacheAdapter } from "vinext/shims/cdn-cache";
// Snapshot paths in this proof are ASCII; runtime tags come pre-encoded from vinext.
const encodeCacheTag = (tag: string) => tag;
import { proofContext, proofNow } from "./context";

const PREFIX = "gsc-0074:pages:v1:";
export const REVALIDATE_SECONDS = 604800;
const RETENTION_SECONDS = 2592000;
type Entry = { lastModified: number; value: any; cacheControl?: any; tags: string[] };

export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    b => b.toString(16).padStart(2, "0")).join("");
}
function encode(value: unknown) {
  return JSON.stringify(value, (_key, item) => item instanceof ArrayBuffer
    ? { __buffer: Array.from(new Uint8Array(item)) } : item);
}
function decode(raw: string): Entry {
  return JSON.parse(raw, (_key, item) => item?.__buffer
    ? new Uint8Array(item.__buffer).buffer : item);
}
function pathFromKey(key: string) {
  return key.match(/:(\/.*?):(?:html|rsc|route)(?::.*)?$/)?.[1] ?? proofContext.getStore()?.path;
}
export function isLongTail(path: string | undefined) {
  const segments = path?.split("/").filter(Boolean) ?? [];
  if (["ja", "zh", "zh-TW", "ko", "es", "fr"].includes(segments[0])) segments.shift();
  if (segments[0] === "o") return segments.length === 2 && segments[1] !== "page";
  if (segments[0] === "categories") return segments.length >= 3;
  return segments.length === 2 && !["api", "rankings", "data", "search-index", "repo-curve"].includes(segments[0]);
}
function mark(status: string, layer: string) {
  const state = proofContext.getStore();
  if (state) Object.assign(state, { status, layer });
}

// One artifact identity and one tag ledger for the hot, persistent, and snapshot layers.
export class HybridCache extends DefaultCdnCacheAdapter {
  hasPrerenderedPages = true;
  ownsBackgroundRevalidation = true;
  snapshots: StaticAssetsCacheAdapter;
  constructor(private env: any, private hot = globalThis.caches?.default) {
    super(process.env.__VINEXT_RSC_BUILD_IDENTITY || process.env.__VINEXT_BUILD_ID);
    this.snapshots = new StaticAssetsCacheAdapter(env.ASSETS);
  }
  async markers(tags: string[]) {
    if (!tags.length) return [];
    const keys = await Promise.all(tags.map(async tag => PREFIX + "tag:" + await digest(tag)));
    const values = await this.env.GSC_CACHE.get(keys);
    return keys.map(key => Number(values.get(key) ?? 0));
  }
  async invalid(entry: Entry) {
    return (await this.markers(entry.tags)).some(marker => marker >= entry.lastModified && marker > 0);
  }
  async get(key: string) {
    if (proofContext.getStore()?.bypass) return null;
    const id = await digest(key);
    const hotKey = new Request("https://gsc-0074-cache.invalid/" + id);
    let raw = await (await this.hot?.match(hotKey))?.text();
    let layer = "cache-api";
    if (!raw) {
      raw = await this.env.GSC_CACHE.get(PREFIX + "entry:" + id);
      layer = "kv";
    }
    let entry: Entry | null = raw ? decode(raw) : null;
    if (entry && await this.invalid(entry)) entry = null;
    if (!entry) {
      const snapshot = await this.snapshots.get(key);
      const path = pathFromKey(key);
      if (snapshot && path) {
        entry = { ...snapshot, tags: [encodeCacheTag("_N_T_" + path)] } as Entry;
        layer = "build-snapshot";
        if (await this.invalid(entry)) entry = null;
      }
    }
    if (!entry) {
      mark("MISS", "render");
      return null;
    }
    const policy = entry.cacheControl;
    const state = proofContext.getStore();
    if (state) { state.revalidate = policy?.revalidate; state.cachedAt = entry.lastModified; }
    const age = (proofNow() - entry.lastModified) / 1000;
    const revalidate = policy?.revalidate;
    if (typeof policy?.expire === "number" && age > policy.expire) {
      mark("MISS", "expired");
      return null;
    }
    const stale = typeof revalidate === "number" && Number.isFinite(revalidate) && age > revalidate;
    mark(stale ? "STALE" : layer === "build-snapshot" ? "SNAPSHOT" : "HIT", layer);
    return { ...entry, cacheState: stale ? "stale" as const : "fresh" as const };
  }
  async set(key: string, value: any, context: any = {}) {
    if (proofContext.getStore()?.bypass) return;
    const tail = isLongTail(pathFromKey(key));
    // Keep data pointer invalidation separate from the long-tail page lifetime.
    const tags: string[] = [...new Set<string>(context.tags ?? [])].filter(tag => !tail ||
      !["published-views-pointer", "bootstrap-publication-pointer"].includes(tag));
    const now = proofNow();
    // A publish during this render must not allow the old result into the cache.
    const started = proofContext.getStore()?.startedAt ?? now;
    if ((await this.markers(tags)).some(marker => marker >= started && marker > 0)) return;
    const cacheControl = tail ? { ...context.cacheControl, revalidate: REVALIDATE_SECONDS,
      expire: REVALIDATE_SECONDS + 86400 } : context.cacheControl;
    const entry: Entry = { lastModified: now, value, tags, cacheControl };
    const id = await digest(key);
    const raw = encode(entry);
    await this.env.GSC_CACHE.put(PREFIX + "entry:" + id, raw, { expirationTtl: RETENTION_SECONDS });
    // Tag validation always runs after a hot hit. A purge cannot be bypassed by this layer.
    await this.hot?.put(new Request("https://gsc-0074-cache.invalid/" + id), new Response(raw, {
      headers: { "Cache-Control": "max-age=86400" },
    }));
  }
  async revalidateTag(tags: string | string[]) {
    const now = String(proofNow());
    await Promise.all((Array.isArray(tags) ? tags : [tags]).map(async tag => {
      await this.env.GSC_CACHE.put(PREFIX + "tag:" + await digest(tag), now);
    }));
  }
}

export default function createHybrid({ env }: { env: any }) {
  if (process.env.VINEXT_PRERENDER === "1") return new DefaultCdnCacheAdapter();
  if (!env?.GSC_CACHE || !env?.ASSETS) throw new Error("Local cache and assets bindings required");
  return new HybridCache(env);
}
