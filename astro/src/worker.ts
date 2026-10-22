import { astro, FetchState } from "astro/fetch";
import { cf, finalize } from "@astrojs/cloudflare/fetch";
import { publicationFromBucket, publicationScope, type Publication } from "../../web/lib/workers-host/publication-fence";
import { type CacheKV, type HotCache } from "../../web/lib/workers-host/cache/store";
import type { R2Bucket } from "../../web/lib/storage/r2-binding-store";
import { handleRequest, secureResponse } from "./lib/host";
import { pageData } from "./lib/data";
import { pageCache, invalidatePagePaths } from "./lib/cache";
import { withWorkerEnv } from "../../web/lib/workers-host/runtime-env";
import { isWorkerShellRequest, normalizeWorkerPathname } from "../../web/lib/workers-host/shell-routes";
import { handleQueue, handleScheduled, handleShellFetch } from "../../workers/gitstarclub-web/src/shell";
import type { RefreshJob, WorkerEnv } from "../../workers/gitstarclub-web/src/env";

export type GateEnv = WorkerEnv & { DATA: R2Bucket; GSC_CACHE: CacheKV };
export type GateContext = { waitUntil(pending: Promise<unknown>): void };
declare const __GSC_ASTRO_BUILD__: string;
declare const __GSC_ASTRO_EXPORT_DATE__: string | null;

export default {
  async fetch(request: Request, env: GateEnv, ctx: GateContext): Promise<Response> {
    return withWorkerEnv(env, async () => {
      const assetUrl = new URL(request.url);
      const pathname = normalizeWorkerPathname(assetUrl.pathname);
      if (new URL(request.url).pathname === "/.well-known/deployment" && ["GET", "HEAD"].includes(request.method)) {
        const url = new URL(request.url);
        const response = secureResponse(Response.json({ commitSha: __GSC_ASTRO_BUILD__, deploymentUrl: (env.CF_PREVIEW_ORIGIN ?? url.origin).replace(/\/+$/, ""), target: "cf", host: url.host }), request.method, "BYPASS");
        response.headers.set("Cache-Control", "no-store, max-age=0");
        return response;
      }
      // The shared classifier owns every aggregate-import verb, including
      // production refusals, before publication reads or Astro asset routing.
      if (isWorkerShellRequest(pathname, request.method)) {
        const shellEnv = { ...env, CF_PREVIEW_COMMIT_SHA: __GSC_ASTRO_BUILD__ };
        const response = await handleShellFetch(request, shellEnv);
        if (pathname === "/preview/health" && response.ok) {
          return secureResponse(Response.json({ ...await response.json() as object, hosting: "astro" }), request.method, "BYPASS", true);
        }
        return secureResponse(response, request.method, "BYPASS", true);
      }
      if (__GSC_ASTRO_EXPORT_DATE__ && assetUrl.pathname.startsWith("/data/exports/v1/latest/") && ["GET", "HEAD"].includes(request.method) && env.ASSETS) {
        // Preserve Next's beforeFiles rewrite without copying dated export payloads.
        assetUrl.pathname = assetUrl.pathname.replace("/data/exports/v1/latest/", `/data/exports/v1/${__GSC_ASTRO_EXPORT_DATE__}/`);
        const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
        const response = secureResponse(asset, request.method, "BYPASS");
        if (asset.headers.has("cache-control")) response.headers.set("cache-control", asset.headers.get("cache-control")!);
        return response;
      }
      const store = pageCache(env.GSC_CACHE, __GSC_ASTRO_BUILD__, (caches as unknown as { default: HotCache }).default);
      async function render(publication?: Publication) {
        const state = new FetchState(request);
        const asset = await cf(state, env as Parameters<typeof cf>[1], ctx as Parameters<typeof cf>[2]);
        if (asset) return asset;
        state.locals.invalidatePaths = (paths) => invalidatePagePaths(store, paths);
        if (publication) {
          state.locals.publication = publication;
          state.locals.data = pageData(env.DATA, publication);
          return publicationScope.run(publication, async () => finalize(state, await astro(state)));
        }
        return finalize(state, await astro(state));
      }
      return handleRequest(request, {
        build: __GSC_ASTRO_BUILD__,
        publication: () => publicationFromBucket(env.DATA), store,
        waitUntil: (pending) => ctx.waitUntil(pending), render,
        unscopedRender: () => render(),
      });
    });
  },
  async scheduled(event: { cron: string }, env: GateEnv): Promise<void> {
    await withWorkerEnv(env, () => handleScheduled(event, env));
  },
  async queue(batch: { messages: Array<{ body: RefreshJob }> }, env: GateEnv): Promise<void> {
    await withWorkerEnv(env, () => handleQueue(batch, env));
  },
};
