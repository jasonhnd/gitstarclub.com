export type RefreshStepFetchEnv = {
  REFRESH_STEP_URL?: string;
  CRON_SECRET?: string;
  WORKER_SELF_REFERENCE?: { fetch(request: Request): Promise<Response> };
};

export type RefreshStepFetchVia = "self-reference" | "public";

export type RefreshStepFetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function refreshStepFetchVia(env: RefreshStepFetchEnv): RefreshStepFetchVia {
  return env.WORKER_SELF_REFERENCE ? "self-reference" : "public";
}

/**
 * POST one refresh step. Prefer the OpenNext `WORKER_SELF_REFERENCE` binding so
 * the Queue consumer does not hop `pre.gitstarclub.com` (Cloudflare 524 ~100–125s
 * on the public proxy). A 524 retries the Queue message while the first isolate
 * is still in GitHub Search and two consumers then fight the same fencing token.
 */
export async function fetchRefreshStep(
  env: RefreshStepFetchEnv,
  job: unknown,
  fetchImpl: RefreshStepFetchImpl = fetch,
): Promise<Response> {
  if (!env.REFRESH_STEP_URL || !env.CRON_SECRET) {
    throw new Error("REFRESH_STEP_URL and CRON_SECRET are required to consume a refresh step");
  }
  const request = new Request(env.REFRESH_STEP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CRON_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(job),
    cache: "no-store",
  });
  if (env.WORKER_SELF_REFERENCE) return env.WORKER_SELF_REFERENCE.fetch(request);
  return fetchImpl(request);
}
