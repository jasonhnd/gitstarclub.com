import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startWorker } from "../../scripts/local-worker";
import { fixtureRecords } from "../../scripts/fixture";
import { LOCALES } from "../../src/lib/i18n";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";

// Run after building: GSC_P7_WORKER_TEST=1 bun test tests/p7/worker.test.ts
// The ordinary suite runs before the build, so it only registers these cases.
if (process.env.GSC_P7_WORKER_TEST === "1") describe("P7 actual Worker endpoints with isolated local bindings", () => {
  let worker: Awaited<ReturnType<typeof startWorker>>;
  let bucket: R2Bucket;
  beforeAll(async () => {
    worker = await startWorker(fixtureRecords(), { CRON_SECRET: "fixture-secret", DEPLOY_ENV: "pre" });
    bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
  }, 30_000);
  afterAll(async () => { await worker?.dispose(); });
  async function call(path: string, method = "GET", auth = false, body?: string) {
    return fetch(new URL(path, await worker.ready), {
      method, redirect: "manual", body,
      headers: auth ? { authorization: "Bearer fixture-secret", "content-type": "application/json" } : {},
    });
  }
  const endpoints = [
    ["/api/cron/daily", "GET"], ["/api/cron/weekly", "GET"], ["/api/workflows/refresh/start", "GET"],
    ["/api/workflows/refresh/step", "POST"], ["/api/workflows/refresh/revalidate", "POST"], ["/api/workflows/refresh/rollback", "POST"],
  ];
  test("all six protected routes reach their real auth and keep response headers", async () => {
    for (const [path, method] of endpoints) {
      const response = await call(path, method);
      expect(response.status).toBe(401); expect(await response.text()).toBe("Unauthorized");
      expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("x-robots-tag")).toBe(false);
    }
  });
  test("implicit HEAD, OPTIONS and wrong methods retain the old framework behavior", async () => {
    for (const [path, method] of [...endpoints, ["/api/lang", "GET"]]) {
      const options = await call(path, "OPTIONS");
      expect(options.status).toBe(204);
      expect(options.headers.get("allow")).toBe(method === "GET" ? "GET, HEAD, OPTIONS" : "OPTIONS, POST");
      const wrong = await call(path, method === "GET" ? "POST" : "GET");
      expect(wrong.status).toBe(405); expect(await wrong.text()).toBe("");
      const head = await call(path, "HEAD");
      expect(head.status).toBe(method === "GET" ? (path === "/api/lang" ? 307 : 401) : 405);
      expect(await head.text()).toBe("");
    }
  });
  test("authenticated malformed requests stop before enqueue or data writes", async () => {
    for (const [path, method, body] of [
      ["/api/cron/daily?idempotency_key=invalid%20key", "GET"],
      ["/api/cron/weekly?idempotency_key=invalid%20key", "GET"],
      ["/api/workflows/refresh/start?dry=1", "GET"],
      ["/api/workflows/refresh/step", "POST", "{"],
      ["/api/workflows/refresh/rollback", "POST", "{}"],
    ]) expect((await call(path, method, true, body)).status).toBe(400);
  });
  test("authorized callback invalidates real Astro page cache and awaits KV writes", async () => {
    const path = "/privacy?p7-invalidation=1";
    await (await call(path)).text();
    expect((await call(path)).headers.get("x-gsc-cache")).toBe("HIT");
    const response = await call("/api/workflows/refresh/revalidate", "POST", true);
    expect(response.status).toBe(200); expect(await response.text()).toBe('{"ok":true}');
    expect((await call(path)).headers.get("x-gsc-cache")).toBe("MISS");
  });
  test("only language GET/HEAD and revalidation POST are independent of pointers", async () => {
    await bucket.put("views/latest.json", "invalid");
    for (const locale of LOCALES) {
      const response = await call(`/api/lang?lang=${locale}&next=/fr/rankings`);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${(await worker.ready).origin}${locale === "en" ? "" : `/${locale}`}/rankings`);
      expect(response.headers.get("set-cookie")).toContain("Expires=");
      expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
      expect((await call(`/api/lang?lang=${locale}`, "HEAD")).status).toBe(307);
    }
    expect((await call("/api/workflows/refresh/revalidate", "POST")).status).toBe(401);
    expect((await call("/api/workflows/refresh/revalidate", "POST", true)).status).toBe(200);
    for (const [path, method] of endpoints.filter(([path]) => !path.endsWith("/revalidate"))) {
      const response = await call(path, method);
      expect(response.status).toBe(503); expect(await response.text()).toBe("Publication changed or unavailable; retry");
    }
  });
});
