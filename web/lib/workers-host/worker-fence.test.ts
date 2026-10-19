import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkerEnv } from "../../../workers/gitstarclub-web/src/env";
import { publicationScope } from "./publication-fence";
import { cacheScope } from "./cache/context";
import { workerBindings } from "./runtime-env";
import type { R2Bucket } from "../storage/r2-binding-store";
import { GET as setLanguage } from "../../app/api/lang/route";
import { POST as revalidatePublication } from "../../app/api/workflows/refresh/revalidate/route";
import { securityHeaders } from "../csp";
import { LOCALES } from "../i18n/locales";

let current = "a";
let calls = 0;
let change: "once" | "always" | "never" = "never";
let fail = false;
let observedBinding = false;
let pointerReads: string[] = [];
let observedPublication = false;
let observedCache = false;
mock.module("../../../workers/gitstarclub-web/src/next-app.ts", () => ({
  handleNextRequest(request: Request) {
    calls++;
    observedBinding = !!workerBindings().DATA;
    observedPublication = !!publicationScope.getStore();
    observedCache = !!cacheScope.getStore();
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (path === "/api/lang") return setLanguage(request);
    if (path === "/api/workflows/refresh/revalidate") return revalidatePublication(request);
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
    pointerReads.push(path);
    if (fail) throw new Error("R2 unavailable");
    if (path !== "views/latest.json") return null;
    const body = JSON.stringify({ version: current, run_id: current, published_at: "2026-10-19T00:00:00Z", prev_version: null, schema_ver: 2 });
    return { size: body.length, etag: current, text: async () => body };
  } } as R2Bucket,
};
const ctx = { waitUntil: () => {} };
beforeEach(() => {
  current = "a"; calls = 0; change = "never"; fail = false; observedBinding = false;
  pointerReads = []; observedPublication = false; observedCache = false;
});
describe("Worker serving publication fence", () => {
  test("language redirects keep their real handler and headers when R2 pointer reads throw", async () => {
    fail = true;
    for (const locale of LOCALES) {
      const request = new Request(`https://local.invalid/api/lang?lang=${locale}&next=${encodeURIComponent("/fr/rankings?period=month#top")}`, {
        headers: { cookie: "gsc_lang=fr" },
      });
      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://local.invalid${locale === "en" ? "" : `/${locale}`}/rankings?period=month#top`);
      expect(response.headers.get("set-cookie")).toContain(`gsc_lang=${locale}`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
      for (const { key, value } of securityHeaders) expect(response.headers.get(key)).toBe(value);
    }
    expect(calls).toBe(LOCALES.length);
    expect(observedBinding).toBe(true);
    expect(observedPublication).toBe(false);
    expect(observedCache).toBe(false);
    expect(pointerReads).toEqual([]);
  });
  test("language redirects work without DATA and keep hostile destinations on-site", async () => {
    const response = await worker.fetch(new Request("https://local.invalid/api/lang/?lang=ja&next=/fr//evil.example/path"), { ...env, DATA: undefined }, ctx);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://local.invalid/ja");
    expect(response.headers.get("set-cookie")).toContain("gsc_lang=ja");
    expect(pointerReads).toEqual([]);
    expect(observedCache).toBe(false);
  });
  test("HEAD language redirects also avoid publication reads", async () => {
    fail = true;
    const response = await worker.fetch(new Request("https://local.invalid/api/lang/?lang=fr&next=/rankings", { method: "HEAD" }), env, ctx);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://local.invalid/fr/rankings");
    expect(pointerReads).toEqual([]);
  });
  test("the revalidation callback reaches its authentication without reading publication pointers", async () => {
    fail = true;
    const response = await worker.fetch(new Request("https://local.invalid/api/workflows/refresh/revalidate", { method: "POST" }), env, ctx);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
    expect(calls).toBe(1);
    expect(observedPublication).toBe(false);
    expect(observedCache).toBe(false);
    expect(pointerReads).toEqual([]);
  });
  test("authorized revalidation still invalidates both cache layers during a pointer outage", async () => {
    fail = true;
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-revalidation-secret";
    try {
      const invalidated: string[] = [];
      const response = await worker.fetch(new Request("https://local.invalid/api/workflows/refresh/revalidate/", {
        method: "POST", headers: { authorization: "Bearer test-revalidation-secret" },
      }), { ...env, GSC_CACHE: { get: env.GSC_CACHE!.get, put: async (key) => { invalidated.push(key); } } }, ctx);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(invalidated.some((key) => key.includes(":data:v1:tag:"))).toBe(true);
      expect(invalidated.some((key) => key.includes(":pages:v1:tag:"))).toBe(true);
      expect(invalidated.every((key) => key.includes(":tag:"))).toBe(true);
      expect(observedPublication).toBe(false);
      expect(observedCache).toBe(false);
      expect(pointerReads).toEqual([]);
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    }
  });
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
    expect(pointerReads).toContain("views/latest.json");
    for (const { key, value } of securityHeaders) expect(response.headers.get(key)).toBe(value);
  });
  test("page cache bypass and data endpoints still fail closed on pointer failure", async () => {
    fail = true;
    const requests = [
      ...["cookie", "authorization", "range"].map((header) => new Request("https://local.invalid/rankings", { headers: { [header]: "test" } })),
      new Request("https://local.invalid/rankings", { method: "HEAD" }),
      new Request("https://local.invalid/example/repo", { method: "POST" }),
      ...["/search-index", "/repo-curve?id=1", "/api/cron/daily", "/api/cron/weekly", "/api/workflows/refresh/start", "/api/lang/extra"]
        .map((path) => new Request(`https://local.invalid${path}`)),
      ...["step", "rollback"].map((path) => new Request(`https://local.invalid/api/workflows/refresh/${path}`, { method: "POST" })),
    ];
    for (const request of requests) {
      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(calls).toBe(0);
    expect(pointerReads).toHaveLength(requests.length * 3);
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
