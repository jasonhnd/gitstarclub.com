import app from "vinext/server/fetch-handler";
export * from "vinext/server/fetch-handler";
import { proofContext, proofNow } from "./context";

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    // Test clock is local-only instrumentation and must never ship in migration.
    const offset = Number(request.headers.get("x-spike-clock-ms") ?? 0);
    return proofContext.run({ env, offset, status: "BYPASS", startedAt: Date.now() + offset }, async () => {
      const response = await app.fetch(request, env, ctx);
      const result = new Response(response.body, response);
      const state = proofContext.getStore()!;
      result.headers.set("x-gsc-cache", state.status);
      result.headers.set("x-spike-layer", state.layer ?? "none");
      result.headers.set("x-spike-now", String(proofNow()));
      return result;
    });
  },
};
