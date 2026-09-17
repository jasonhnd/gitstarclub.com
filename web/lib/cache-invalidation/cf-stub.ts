import { cloudflareAccessHeaders } from "@/lib/preview/access";
import { getCfAccessClientId, getCfAccessClientSecret, getCfCachePurgeUrl, getCronSecret } from "@/lib/runtime-config";
import { MemoryCacheInvalidation } from "./memory";
import type { CacheInvalidationOp, CacheInvalidationPort, RevalidateTagOptions, RevalidateType } from "./types";

export type CacheInvalidationFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type CacheInvalidationEnv = Record<string, string | undefined>;

export type CfStubCacheInvalidationOptions = {
  recorder?: MemoryCacheInvalidation;
  purgeUrl?: string;
  secret?: string;
  env?: CacheInvalidationEnv;
  fetchImpl?: CacheInvalidationFetch;
  log?: (line: string) => void;
};

function headerRecord(env: CacheInvalidationEnv | undefined): Record<string, string> {
  return cloudflareAccessHeaders({
    CF_ACCESS_CLIENT_ID: getCfAccessClientId(env),
    CF_ACCESS_CLIENT_SECRET: getCfAccessClientSecret(env),
  });
}

/**
 * Non-production CF driver. Records the same path/tag ops as Vercel and emits
 * structured run logs. Does not call Cloudflare Cache Purge (that is P3).
 * When `CF_CACHE_PURGE_URL` is set, POSTs a dual-run envelope to the Worker
 * `/preview/invalidate` stub.
 */
export class CfStubCacheInvalidation implements CacheInvalidationPort {
  readonly recorder: MemoryCacheInvalidation;
  private readonly purgeUrl?: string;
  private readonly secret?: string;
  private readonly env?: CacheInvalidationEnv;
  private readonly fetchImpl: CacheInvalidationFetch;
  private readonly log: (line: string) => void;

  constructor(options: CfStubCacheInvalidationOptions = {}) {
    this.recorder = options.recorder ?? new MemoryCacheInvalidation();
    this.env = options.env;
    this.purgeUrl = options.purgeUrl ?? getCfCachePurgeUrl(options.env);
    this.secret = options.secret ?? getCronSecret(options.env);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.log ?? ((line) => console.log(line));
  }

  async revalidatePath(path: string, type?: RevalidateType): Promise<void> {
    const op: CacheInvalidationOp = type ? { kind: "path", path, type } : { kind: "path", path };
    await this.recorder.revalidatePath(path, type);
    this.emit(op);
    await this.post([op]);
  }

  async revalidateTag(tag: string, options?: RevalidateTagOptions): Promise<void> {
    const op: CacheInvalidationOp = options ? { kind: "tag", tag, options } : { kind: "tag", tag };
    await this.recorder.revalidateTag(tag, options);
    this.emit(op);
    await this.post([op]);
  }

  private emit(op: CacheInvalidationOp): void {
    this.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "cache.invalidate",
        driver: "cf-stub",
        ...op,
      }),
    );
  }

  private async post(ops: CacheInvalidationOp[]): Promise<void> {
    if (!this.purgeUrl) return;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...headerRecord(this.env),
    };
    if (this.secret) headers.authorization = `Bearer ${this.secret}`;
    const response = await this.fetchImpl(this.purgeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ v: 1, driver: "cf-stub", ops }),
    });
    if (!response.ok) {
      throw new Error(`CF cache-invalidation stub -> ${response.status}`);
    }
  }
}
