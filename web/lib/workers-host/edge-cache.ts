import { cfBuildCommitSha } from "../cf-build-identity";

/** Cloudflare Cache API storage is local to each data center. */
export const EDGE_CACHE_MAX_TTL_SECONDS = 86400;
const EDGE_CACHE_DEFAULT_TTL_SECONDS = 3600;
const ORIGIN_CACHE_CONTROL_HEADER = "x-gsc-cache-origin-control";

export type EdgeCacheEnv = {
  EDGE_CACHE_VERSION?: string;
  EDGE_CACHE_TTL?: string;
  VIEWS_VERSION_FALLBACK?: string;
  CF_PREVIEW_COMMIT_SHA?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
};

export type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

function defaultCache(): EdgeCache | undefined {
  return (globalThis as typeof globalThis & { caches?: { default?: EdgeCache } }).caches?.default;
}

function eligibleRequest(request: Request): boolean {
  const path = new URL(request.url).pathname.toLowerCase();
  return request.method === "GET"
    && !path.startsWith("/api")
    && !path.includes("refresh")
    && !/^\/(start|enqueue)(\/|$)/.test(path)
    && !/^\/(preview|\.well-known)(\/|$)/.test(path)
    && !["authorization", "cookie", "range"].some((header) => request.headers.has(header));
}

export function edgeCacheTtl(response: Response, env: EdgeCacheEnv = {}): number | undefined {
  if (response.status !== 200 || response.headers.has("set-cookie")) return undefined;
  if (response.headers.get("vary")?.split(",").some((value) => value.trim() === "*")) return undefined;
  const directives = (response.headers.get("cache-control") ?? "").split(",").map((value) => value.trim());
  if (directives.some((value) => /^(private|no-store|no-cache)(?:\s*=|$)/i.test(value))) return undefined;
  const shared = directives.filter((value) => /^s-maxage\s*=/i.test(value));
  if (shared.length !== 1) return undefined;
  const match = /^s-maxage\s*=\s*(?:"(\d+)"|(\d+))$/i.exec(shared[0]);
  const seconds = match ? Number(match[1] ?? match[2]) : 0;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  const value = env.EDGE_CACHE_TTL ?? "";
  const storageSeconds = /^[0-9]+$/.test(value) && value.trim() === value ? Number(value) : 0;
  return storageSeconds > 0
    ? Math.min(storageSeconds, EDGE_CACHE_MAX_TTL_SECONDS)
    : EDGE_CACHE_DEFAULT_TTL_SECONDS;
}

export async function edgeCacheKey(request: Request, env: EdgeCacheEnv): Promise<Request> {
  const url = new URL(request.url);
  // Fixed positions preserve every original query parameter, including _rsc.
  const version = JSON.stringify([
    env.EDGE_CACHE_VERSION || "v1",
    env.VIEWS_VERSION_FALLBACK || "",
    cfBuildCommitSha || env.VERCEL_GIT_COMMIT_SHA || env.CF_PREVIEW_COMMIT_SHA || "",
  ]);
  url.searchParams.append("__gsc_cv", version);
  // Hash the full router state: a boolean RSC marker alone cannot isolate patches.
  const representation = JSON.stringify([
    "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url", "accept",
  ].map((header) => request.headers.get(header)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(representation));
  url.searchParams.append("__gsc_variant", Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  return new Request(url, { method: "GET" });
}

function withCacheStatus(response: Response, status: "HIT" | "MISS" | "BYPASS"): Response {
  const result = new Response(response.body, response);
  if (status === "HIT") {
    const originalPolicy = result.headers.get(ORIGIN_CACHE_CONTROL_HEADER);
    if (originalPolicy !== null) result.headers.set("cache-control", originalPolicy);
  }
  result.headers.delete(ORIGIN_CACHE_CONTROL_HEADER);
  result.headers.set("x-gsc-cache", status);
  return result;
}

export async function handleEdgeCachedNext(
  request: Request,
  env: EdgeCacheEnv,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  next: () => Response | Promise<Response>,
  cache: EdgeCache | undefined = defaultCache(),
): Promise<Response> {
  if (!cache || !eligibleRequest(request)) return withCacheStatus(await next(), "BYPASS");
  let key: Request;
  try {
    key = await edgeCacheKey(request, env);
    const cached = await cache.match(key);
    if (cached) return withCacheStatus(cached, "HIT");
  } catch (error) {
    console.warn("Worker edge cache lookup failed", error);
    return withCacheStatus(await next(), "BYPASS");
  }

  const response = await next();
  const ttl = edgeCacheTtl(response, env);
  if (ttl === undefined) return withCacheStatus(response, "BYPASS");
  const result = withCacheStatus(response, "MISS");
  // Set the independent storage lifetime only on the stored copy; preserve the origin policy.
  try {
    const stored = result.clone();
    stored.headers.set(ORIGIN_CACHE_CONTROL_HEADER, result.headers.get("cache-control")!);
    stored.headers.set("cache-control", `public, max-age=${ttl}, s-maxage=${ttl}`);
    stored.headers.delete("expires");
    ctx.waitUntil(Promise.resolve().then(() => cache.put(key, stored)).catch((error: unknown) => {
      console.warn("Worker edge cache write failed", error);
    }));
  } catch (error) {
    console.warn("Worker edge cache write failed", error);
  }
  return result;
}
