import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkerEnv } from "../../../workers/gitstarclub-web/src/env";
import { publicationScope } from "./publication-fence";
import { cacheScope } from "./cache/context";
import { workerBindings } from "./runtime-env";
import type { R2Bucket } from "../storage/r2-binding-store";

let current = "a";
let calls = 0;
let change: "once" | "always" | "never" = "never";
let fail = false;
let observedBinding = false;
mock.module("../../../workers/gitstarclub-web/src/next-app.ts", () => ({
  handleNextRequest() {
    calls++;
    observedBinding = !!workerBindings().DATA;
    const captured = publicationScope.getStore()?.views?.version ?? "missing";
    const scope = cacheScope.getStore();
    if (scope) scope.status = "MISS";
    return new Response(new ReadableStream({
      start(controller) {
        queueMicrotask(() => {
          if (change === "always" || (change === "once" && calls === 1)) current = current === "a" ? "b" : "a";
          controller.enqueue(new TextEncoder().encode(captured)); controller.close();
        });
      },
    }), { headers: { "Content-Type": "text/html" } });
  },
}));
const { default: worker } = await import("../../../workers/gitstarclub-web/src/index");
const env: WorkerEnv = {
  MEDIA: {}, JOBS: { send: async () => {} }, GSC_CACHE: { get: async () => null, put: async () => {} } as unknown as WorkerEnv["GSC_CACHE"],
  DATA: { get: async (path: string) => {
    if (fail) throw new Error("R2 unavailable");
    if (path !== "views/latest.json") return null;
    const body = JSON.stringify({ version: current, run_id: current, published_at: "2026-10-19T00:00:00Z", prev_version: null, schema_ver: 2 });
    return { size: body.length, etag: current, text: async () => body };
  } } as R2Bucket,
};
const ctx = { waitUntil: () => {} };
beforeEach(() => { current = "a"; calls = 0; change = "never"; fail = false; observedBinding = false; });
describe("Worker serving publication fence", () => {
  test("captures native bindings, consumes core streams and retries a publish race", async () => {
    change = "once";
    const response = await worker.fetch(new Request("https://local.invalid/rankings"), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("b");
    expect(calls).toBe(2);
    expect(observedBinding).toBe(true);
    expect(workerBindings()).toEqual({});
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
  });
  test("continuous publication changes fail closed after one retry", async () => {
    change = "always";
    const response = await worker.fetch(new Request("https://local.invalid/"), env, ctx);
    expect(response.status).toBe(503);
    expect(calls).toBe(2);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  test("an unreadable authoritative pointer never serves a cache or renders", async () => {
    fail = true;
    const response = await worker.fetch(new Request("https://local.invalid/"), env, ctx);
    expect(response.status).toBe(503);
    expect(calls).toBe(0);
  });
  test("tail lifetime remains independent of an ordinary publication", async () => {
    change = "once";
    const response = await worker.fetch(new Request("https://local.invalid/example/repo"), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("a");
    expect(calls).toBe(1);
  });
  test("private snapshot files cannot be fetched from the public Worker", async () => {
    const response = await worker.fetch(new Request("https://local.invalid/_vinext/static-cache/gsc-host.json"), env, ctx);
    expect(response.status).toBe(404);
    expect(calls).toBe(0);
    expect(response.headers.get("content-security-policy")).toContain("font-src 'self'");
  });
});
