import { cloudflareAccessHeaders } from "@/lib/preview/access";
import { getCfAccessClientId, getCfAccessClientSecret, getCfCachePurgeUrl, getCronSecret } from "@/lib/runtime-config";
import { MemoryCacheInvalidation } from "./memory";
import type { CacheInvalidationOp, CacheInvalidationPort, RevalidateTagOptions, RevalidateType } from "./types";

export type CacheInvalidationFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type CacheInvalidationEnv = Record<string, string | undefined>;

/** Same bound as the preview identity GET. Covers the POST and the body read. */
export const CF_STUB_POST_DEADLINE_MS = 15_000;

export type CfStubCacheInvalidationOptions = {
  recorder?: MemoryCacheInvalidation;
  purgeUrl?: string;
  secret?: string;
  env?: CacheInvalidationEnv;
  fetchImpl?: CacheInvalidationFetch;
  /** Test hook. Production uses `CF_STUB_POST_DEADLINE_MS`. */
  deadlineMs?: number;
  log?: (line: string) => void;
};

type Deadline = {
  signal: AbortSignal;
  close: () => void;
};

function positiveDeadline(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("deadlineMs must be a positive finite number");
  }
  return value;
}

function openDeadline(ms: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  return {
    signal: controller.signal,
    close: () => {
      clearTimeout(timer);
    },
  };
}

function waitFor<T>(work: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  const fail = () => {
    try {
      onAbort?.();
    } catch {
      // Body cancellation must not replace the deadline error.
    }
    return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  };
  if (signal.aborted) return Promise.reject(fail());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      settle();
    };
    const handleAbort = () => {
      finish(() => reject(fail()));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

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
 * `/preview/invalidate` stub. The POST and its response body share one
 * deadline so a stalled Worker cannot hold the caller open.
 */
export class CfStubCacheInvalidation implements CacheInvalidationPort {
  readonly recorder: MemoryCacheInvalidation;
  private readonly purgeUrl?: string;
  private readonly secret?: string;
  private readonly env?: CacheInvalidationEnv;
  private readonly fetchImpl: CacheInvalidationFetch;
  private readonly deadlineMs: number;
  private readonly log: (line: string) => void;

  constructor(options: CfStubCacheInvalidationOptions = {}) {
    this.recorder = options.recorder ?? new MemoryCacheInvalidation();
    this.env = options.env;
    this.purgeUrl = options.purgeUrl ?? getCfCachePurgeUrl(options.env);
    this.secret = options.secret ?? getCronSecret(options.env);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.deadlineMs = positiveDeadline(options.deadlineMs, CF_STUB_POST_DEADLINE_MS);
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
    const deadline = openDeadline(this.deadlineMs);
    try {
      const response = await waitFor(
        this.fetchImpl(this.purgeUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ v: 1, driver: "cf-stub", ops }),
          signal: deadline.signal,
        }),
        deadline.signal,
      );
      if (!response.ok) {
        throw new Error(`CF cache-invalidation stub -> ${response.status}`);
      }
      await waitFor(response.text(), deadline.signal, () => {
        void response.body?.cancel().catch(() => undefined);
      });
    } finally {
      deadline.close();
    }
  }
}
