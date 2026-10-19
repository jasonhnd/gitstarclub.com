import { getCronSecret, getDeployEnv, getHostingTarget, isProductionDeployment } from "@/lib/runtime-config";
import { resolveRuntimeEnv, type RuntimeEnv } from "@/lib/workers-host/runtime-env";

export const PUBLICATION_INVALIDATION_PATH = "/api/workflows/refresh/revalidate";
/** Bounded well inside the 15 min Queue consumer wall, so a hung callback fails the step instead of the hop. */
export const PUBLICATION_INVALIDATION_TIMEOUT_MS = 30_000;

const PRODUCTION_SITE_HOSTS: ReadonlySet<string> = new Set(["gitstarclub.com", "www.gitstarclub.com"]);
const CLOSED_PRODUCTION_WORKERS_DEV_HOST = "gitstarclub-web.worldgo.workers.dev";
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type InvalidationFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PublicationInvalidationTarget = {
  url: string;
  secret: string;
};

export type PublicationInvalidationOptions = {
  env?: RuntimeEnv;
  fetchImpl?: InvalidationFetch;
  timeoutMs?: number;
};

function parseOrigin(name: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute https origin (got ${JSON.stringify(raw)})`);
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) throw new Error(`${name} must be an https origin (got ${url.protocol}//${url.host})`);
  // A trailing-dot host names the same site but would slip past the host checks below.
  const extra = url.username || url.password || url.pathname !== "/" || url.search || url.hash;
  if (extra || url.hostname.endsWith(".")) {
    throw new Error(`${name} must be a bare origin without credentials, path, query, fragment, or trailing dot`);
  }
  return url;
}

/** Cloudflare: the Worker's own deployment origin, the same var its cron self-calls use. */
function cloudflareOrigin(env: RuntimeEnv): URL {
  const raw = env.CF_CRON_ORIGIN?.trim();
  if (!raw) {
    throw new Error(
      "CF_CRON_ORIGIN is required for publication cache invalidation on Cloudflare; " +
        "set https://pre.gitstarclub.com on preview or https://gitstarclub.com on production",
    );
  }
  return parseOrigin("CF_CRON_ORIGIN", raw);
}

/** Vercel: the running deployment URL, then the configured site URL. Never a hard-coded host. */
function vercelOrigin(env: RuntimeEnv): URL {
  const host = env.VERCEL_URL?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (host) return parseOrigin("VERCEL_URL", `https://${host}`);
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return parseOrigin("NEXT_PUBLIC_SITE_URL", site);
  throw new Error(
    "publication cache invalidation origin is not configured; " +
      "set CF_CRON_ORIGIN on Cloudflare, or VERCEL_URL / NEXT_PUBLIC_SITE_URL on Vercel",
  );
}

/**
 * Origin of the deployment that owns the published views: preview invalidates
 * preview, production invalidates production. Missing or mismatched config
 * throws instead of guessing, so a preview publish can never call production.
 */
export function resolvePublicationInvalidationOrigin(env: RuntimeEnv = resolveRuntimeEnv()): string {
  const deploy = getDeployEnv(env);
  const onCloudflare = getHostingTarget(env) === "cf";
  const url = onCloudflare ? cloudflareOrigin(env) : vercelOrigin(env);
  if (url.hostname === CLOSED_PRODUCTION_WORKERS_DEV_HOST) {
    throw new Error("publication cache invalidation must not target the closed production workers.dev host");
  }
  const productionHost = PRODUCTION_SITE_HOSTS.has(url.hostname);
  if (deploy === "pre" && productionHost) {
    throw new Error(`DEPLOY_ENV=pre must not invalidate the production site (${url.origin})`);
  }
  if (onCloudflare && isProductionDeployment(env) && !productionHost) {
    throw new Error(`a production deployment must invalidate the production site (got ${url.origin})`);
  }
  return url.origin;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Callback URL and bearer for the running deployment. Publication calls this
 * before the pointer switch too, so bad config fails before anything goes live.
 */
export function resolvePublicationInvalidationTarget(
  env: RuntimeEnv = resolveRuntimeEnv(),
): PublicationInvalidationTarget {
  const secret = getCronSecret(env);
  if (!secret) throw new Error("CRON_SECRET not set for publication cache invalidation");
  return { url: `${resolvePublicationInvalidationOrigin(env)}${PUBLICATION_INVALIDATION_PATH}`, secret };
}

/** Ask the owning deployment to invalidate its data/route caches. */
export async function requestPublishedViewsInvalidation(options: PublicationInvalidationOptions = {}): Promise<void> {
  const { url: target, secret } = resolvePublicationInvalidationTarget(options.env ?? resolveRuntimeEnv());
  const timeoutMs = options.timeoutMs ?? PUBLICATION_INVALIDATION_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const fetchImpl: InvalidationFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  let response: Response;
  try {
    response = await fetchImpl(target, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`publication cache invalidation POST ${target} timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw new Error(`publication cache invalidation POST ${target} failed: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`publication cache invalidation POST ${target} -> ${response.status}`);
}
