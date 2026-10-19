import app from "vinext/server/fetch-handler";
export * from "vinext/server/fetch-handler";
import { proofContext, proofNow } from "./context";
import { securityHeaders } from "../lib/csp";

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    // Test clock is local-only instrumentation and must never ship in migration.
    const offset = Number(request.headers.get("x-spike-clock-ms") ?? 0);
    const path = new URL(request.url).pathname;
    const bypass = request.method !== "GET" || ["cookie", "authorization", "range"].some(h => request.headers.has(h));
    return proofContext.run({ env, offset, path, bypass, status: "BYPASS", startedAt: Date.now() + offset }, async () => {
      const response = await app.fetch(request, env, ctx);
      const result = new Response(response.body, response);
      const state = proofContext.getStore()!;
      for (const { key, value } of securityHeaders) result.headers.set(key, value);
      if (bypass) result.headers.set("Cache-Control", "private, no-store");
      if (state.revalidate !== undefined) result.headers.set("x-spike-revalidate", String(state.revalidate));
      if (state.cachedAt !== undefined) result.headers.set("x-spike-cached-at", String(state.cachedAt));
      result.headers.set("x-gsc-cache", state.status);
      result.headers.set("x-spike-layer", state.layer ?? "none");
      result.headers.set("x-spike-now", String(proofNow()));
      return result;
    });
  },
};
