import { astro, FetchState } from "astro/fetch";
import { cf, finalize } from "@astrojs/cloudflare/fetch";
import { publicationFromBucket, publicationScope, type Publication } from "../../web/lib/workers-host/publication-fence";
import { type CacheKV, type HotCache } from "../../web/lib/workers-host/cache/store";
import type { R2Bucket } from "../../web/lib/storage/r2-binding-store";
import { handleRequest, secureResponse } from "./lib/host";
import { pageData } from "./lib/data";
import { pageCache, invalidatePagePaths } from "./lib/cache";

export type GateEnv = { DATA: R2Bucket; GSC_CACHE: CacheKV; CF_PREVIEW_ORIGIN?: string };
export type GateContext = { waitUntil(pending: Promise<unknown>): void };
declare const __GSC_ASTRO_BUILD__: string;

export default {
  async fetch(request: Request, env: GateEnv, ctx: GateContext): Promise<Response> {
    if (new URL(request.url).pathname === "/.well-known/deployment" && ["GET", "HEAD"].includes(request.method)) {
      const url = new URL(request.url);
      const response = secureResponse(Response.json({ commitSha: __GSC_ASTRO_BUILD__, deploymentUrl: (env.CF_PREVIEW_ORIGIN ?? url.origin).replace(/\/+$/, ""), target: "cf", host: url.host }), request.method, "BYPASS");
      response.headers.set("Cache-Control", "no-store, max-age=0");
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
  },
};
