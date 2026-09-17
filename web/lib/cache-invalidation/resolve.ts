import {
  assertCacheInvalidationAllowed,
  getCacheInvalidationKind,
  type CacheInvalidationKind,
} from "@/lib/runtime-config";
import { CfStubCacheInvalidation } from "./cf-stub";
import { MemoryCacheInvalidation } from "./memory";
import type { CacheInvalidationPort } from "./types";
import { VercelCacheInvalidation } from "./vercel";

export type ResolveCacheInvalidationOptions = {
  env?: NodeJS.ProcessEnv;
  kind?: CacheInvalidationKind;
  vercel?: VercelCacheInvalidation;
  memory?: MemoryCacheInvalidation;
  cfStub?: CfStubCacheInvalidation;
};

export function resolveCacheInvalidation(
  opts: ResolveCacheInvalidationOptions = {},
): CacheInvalidationPort {
  const env = opts.env ?? process.env;
  assertCacheInvalidationAllowed(env);
  const kind = opts.kind ?? getCacheInvalidationKind(env);
  switch (kind) {
    case "vercel":
      return opts.vercel ?? new VercelCacheInvalidation();
    case "memory":
      return opts.memory ?? new MemoryCacheInvalidation();
    case "cf-stub":
      return opts.cfStub ?? new CfStubCacheInvalidation({ env });
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unsupported CACHE_INVALIDATION_DRIVER: ${String(_exhaustive)}`);
    }
  }
}

export function describeCacheInvalidation(opts: ResolveCacheInvalidationOptions = {}): {
  kind: CacheInvalidationKind;
} {
  return { kind: opts.kind ?? getCacheInvalidationKind(opts.env) };
}
