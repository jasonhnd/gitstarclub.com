import { isWorkerShellRequest } from "../../../web/lib/workers-host/shell-routes";
import { withWorkerEnv } from "../../../web/lib/workers-host/runtime-env";
import { cacheScope } from "../../../web/lib/workers-host/cache/context";
import { bypassPageCache, isLongTail } from "../../../web/lib/workers-host/cache/policy";
import { publicationFromBucket, publicationScope } from "../../../web/lib/workers-host/publication-fence";
import { securityHeaders } from "../../../web/lib/csp";
import type { RefreshJob, WorkerEnv } from "./env";
import { handleNextRequest } from "./next-app";
import { emitRunLog, handleQueue, handleScheduled, handleShellFetch } from "./shell";

function headers(response: Response, status: string, bypass: boolean): Response {
  const result = new Response(response.body, response);
  for (const { key, value } of securityHeaders) result.headers.set(key, value);
  result.headers.set("x-gsc-cache", status);
  if (bypass) result.headers.set("Cache-Control", "private, no-store");
  return result;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    return withWorkerEnv(env, async () => {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/_vinext/static-cache/")) return new Response("Not found", { status: 404 });
      if (isWorkerShellRequest(url.pathname, request.method)) return headers(await handleShellFetch(request, env), "BYPASS", true);
      emitRunLog({ event: "host.vinext", path: url.pathname, method: request.method });
      // Local unit tests can delegate without platform bindings; real cache factories fail closed.
      if (!env.GSC_CACHE) return headers(await handleNextRequest(request, env, ctx), "BYPASS", true);
      if (!env.DATA) return new Response("Publication binding unavailable", { status: 503 });
      const bucket = env.DATA;
      const checkPublication = () => publicationFromBucket(bucket);
      const bypass = bypassPageCache(request);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const publication = await checkPublication();
          const scope = { path: url.pathname, bypass, startedAt: Date.now(), publication, checkPublication, status: "BYPASS" as const };
          const response = await publicationScope.run(publication, () => cacheScope.run(scope, async () => {
            const result = await handleNextRequest(request, env, ctx);
            // Core HTML/RSC must finish rendering before its serving fence is checked.
            if (!bypass && !isLongTail(url.pathname)) return new Response(await result.arrayBuffer(), result);
            return result;
          }));
          if (!bypass && !isLongTail(url.pathname) && (await checkPublication()).id !== publication.id) {
            await response.body?.cancel();
            continue;
          }
          return headers(response, scope.status, bypass);
        }
      } catch (error) {
        console.error("[publication-fence] request failed", error instanceof Error ? error.name : "unknown");
      }
      return headers(new Response("Publication changed or unavailable; retry", { status: 503 }), "BYPASS", true);
    });
  },
  async scheduled(event: { cron: string }, env: WorkerEnv): Promise<void> {
    await withWorkerEnv(env, () => handleScheduled(event, env));
  },
  async queue(batch: { messages: Array<{ body: RefreshJob }> }, env: WorkerEnv): Promise<void> {
    await withWorkerEnv(env, () => handleQueue(batch, env));
  },
};
