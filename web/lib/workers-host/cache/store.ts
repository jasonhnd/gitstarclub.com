import { Buffer } from "node:buffer";
import type { CacheHandlerValue, IncrementalCacheValue } from "vinext/shims/cache";
import { sha256 } from "../publication-fence";
import { boundedTags, MAX_ENTRY_BYTES, RETENTION_SECONDS } from "./policy";

export type CacheKV = {
  get(key: string): Promise<string | null>;
  get(keys: string[]): Promise<Map<string, string | null>>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
};
export type HotCache = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };
export type StoredEntry = CacheHandlerValue & { v: 1; fence: string; tags: string[] };
const writes = new Map<string, { pending: Promise<void>; at: number }>();

/** Binary values use base64 rather than allocating JSON arrays of byte numbers. */
export function encodeEntry(entry: StoredEntry): string {
  const raw = JSON.stringify(entry, (_key, value) => value instanceof ArrayBuffer
    ? { $gscBytes: Buffer.from(value).toString("base64") } : value);
  if (Buffer.byteLength(raw) > MAX_ENTRY_BYTES) throw new Error("Cache entry too large");
  return raw;
}

export function decodeEntry(raw: string): StoredEntry | null {
  if (Buffer.byteLength(raw) > MAX_ENTRY_BYTES) return null;
  try {
    const value = JSON.parse(raw, (_key, item) => {
      if (item && typeof item === "object" && "$gscBytes" in item) {
        if (Object.keys(item).length !== 1 || typeof item.$gscBytes !== "string"
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.$gscBytes)) throw new Error("Invalid bytes");
        const bytes = Buffer.from(item.$gscBytes, "base64");
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      return item;
    }) as StoredEntry;
    if (!value || value.v !== 1 || typeof value.fence !== "string" || !Number.isFinite(value.lastModified)
      || value.lastModified < 0 || !Array.isArray(value.tags)) return null;
    boundedTags(value.tags);
    const artifact = value.value;
    if (artifact !== null && (!artifact || !["APP_PAGE", "APP_ROUTE", "FETCH", "IMAGE", "PAGES", "REDIRECT"].includes(artifact.kind))) return null;
    if (artifact?.kind === "APP_PAGE" && (typeof artifact.html !== "string"
      || (artifact.rscData !== undefined && !(artifact.rscData instanceof ArrayBuffer)))) return null;
    if (artifact?.kind === "APP_ROUTE" && (!(artifact.body instanceof ArrayBuffer) || !Number.isInteger(artifact.status))) return null;
    if (artifact?.kind === "FETCH" && (!artifact.data || typeof artifact.data.body !== "string")) return null;
    if (value.cacheControl && (typeof value.cacheControl !== "object"
      || (value.cacheControl.revalidate !== false && (!Number.isFinite(value.cacheControl.revalidate) || value.cacheControl.revalidate < 0))
      || (value.cacheControl.expire !== undefined && (!Number.isFinite(value.cacheControl.expire) || value.cacheControl.expire < 0)))) return null;
    return value;
  } catch { return null; }
}

export class ArtifactStore {
  constructor(readonly kv: CacheKV, readonly prefix: string, readonly hot?: HotCache) {}
  async key(key: string): Promise<string> { return `${this.prefix}:entry:${await sha256(key)}`; }
  hotKey(key: string): Request { return new Request(`https://gsc-cache.invalid/${encodeURIComponent(key)}`); }
  async get(key: string): Promise<StoredEntry | null> {
    const storageKey = await this.key(key);
    try {
      const hot = await this.hot?.match(this.hotKey(storageKey));
      const entry = hot ? decodeEntry(await hot.text()) : null;
      if (entry && !await this.invalid(entry)) return entry;
    } catch { /* Regional eviction/errors fall through to persistent storage. */ }
    const raw = await this.kv.get(storageKey);
    const entry = raw ? decodeEntry(raw) : null;
    return entry && !await this.invalid(entry) ? entry : null;
  }
  async invalid(entry: StoredEntry): Promise<boolean> {
    const tags = boundedTags(entry.tags);
    for (let offset = 0; offset < tags.length; offset += 100) {
      const keys = await Promise.all(tags.slice(offset, offset + 100).map((tag) => this.tagKey(tag)));
      const values = await this.kv.get(keys);
      if (keys.some((key) => {
        const raw = values.get(key);
        if (raw === null || raw === undefined) return false;
        const timestamp = Number(raw);
        return !Number.isFinite(timestamp) || timestamp >= entry.lastModified;
      })) return true;
    }
    return false;
  }
  async set(key: string, entry: StoredEntry): Promise<void> {
    const storageKey = await this.key(key);
    const raw = encodeEntry(entry);
    await this.kv.put(storageKey, raw, { expirationTtl: RETENTION_SECONDS });
    try {
      await this.hot?.put(this.hotKey(storageKey), new Response(raw, { headers: { "Cache-Control": "max-age=86400" } }));
    } catch { /* KV remains available when the regional cache is full. */ }
  }
  async tagKey(tag: string): Promise<string> { return `${this.prefix}:tag:${await sha256(tag)}`; }
  async revalidateTag(tags: string | string[]): Promise<void> {
    const issuedAt = Date.now();
    for (const tag of boundedTags(Array.isArray(tags) ? tags : [tags])) {
      const key = await this.tagKey(tag);
      const previous = writes.get(key);
      const record = { pending: Promise.resolve(), at: previous?.at ?? 0 };
      record.pending = (async () => {
        await previous?.pending.catch(() => {});
        const delay = 1001 - (Date.now() - (previous?.at ?? 0));
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        for (let attempt = 0; ; attempt++) {
          try { await this.kv.put(key, String(issuedAt)); record.at = Date.now(); break; }
          catch (error) {
            if (attempt >= 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1100 * (attempt + 1)));
          }
        }
      })();
      writes.set(key, record);
      try { await record.pending; } finally { if (writes.get(key) === record) writes.delete(key); }
    }
  }
}

export function cacheValue(data: IncrementalCacheValue | null, ctx: Record<string, unknown>, fence: string, tags: string[]): StoredEntry {
  return { v: 1, lastModified: Date.now(), value: data, fence, tags,
    ...(ctx.cacheControl ? { cacheControl: ctx.cacheControl as CacheHandlerValue["cacheControl"] } : {}) };
}
