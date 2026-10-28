import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startWorker } from "../../scripts/local-worker";
import { fixtureRecords } from "../../scripts/fixture";
import { LOCALES } from "../../src/lib/i18n";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { publicationFromBucket } from "../../../web/lib/workers-host/publication-fence";
import { assertAggregateImportGuards, IMPORT_GUARD_CONFIGS, IMPORT_TEST_SECRET } from "./aggregate-import";

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
      expect(response.headers.has("x-gsc-publication")).toBe(false);
      expect(response.headers.has("x-robots-tag")).toBe(false);
      expect(response.headers.get("x-vinext-build-id")).toMatch(/^[a-f0-9]{32}$/);
      expect(response.headers.get("vary")).toContain("Next-Router-State-Tree");
    }
  });
  test("implicit HEAD, OPTIONS and wrong methods retain the old framework behavior", async () => {
    for (const [path, method] of [...endpoints, ["/api/lang", "GET"]]) {
      const options = await call(path, "OPTIONS");
      expect(options.status).toBe(204);
      expect(options.headers.get("allow")).toBe(method === "GET" ? "GET, HEAD, OPTIONS" : "OPTIONS, POST");
      expect(options.headers.has("x-gsc-publication")).toBe(false);
      const wrong = await call(path, method === "GET" ? "POST" : "GET");
      expect(wrong.status).toBe(405); expect(await wrong.text()).toBe("");
      expect(wrong.headers.has("x-gsc-publication")).toBe(false);
      const head = await call(path, "HEAD");
      expect(head.status).toBe(method === "GET" ? (path === "/api/lang" ? 307 : 401) : 405);
      expect(await head.text()).toBe("");
      expect(head.headers.has("x-gsc-publication")).toBe(false);
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
  test("callback preserves the same publication and a new publication selects a fresh page cache", async () => {
    const isolated = await startWorker(fixtureRecords(), { CRON_SECRET: "fixture-secret", DEPLOY_ENV: "pre" });
    try {
      const data = await isolated.getR2Bucket("DATA") as unknown as R2Bucket;
      const localCall = async (path: string, method = "GET", auth = false) => fetch(new URL(path, await isolated.ready), {
        method, redirect: "manual", headers: auth ? { authorization: "Bearer fixture-secret" } : {},
      });
      const callback = async () => {
        const response = await localCall("/api/workflows/refresh/revalidate", "POST", true);
        expect(response.status).toBe(200); expect(await response.text()).toBe('{"ok":true}');
      };
      const path = "/privacy?p7-publication-contract=859";
      const initial = await localCall(path);
      expect(initial.status).toBe(200);
      expect(initial.headers.get("x-gsc-cache")).toBe("MISS");
      const initialPublication = initial.headers.get("x-gsc-publication");
      expect(initialPublication).toMatch(/^[a-f0-9]{64}$/);
      const before = await publicationFromBucket(data);
      expect(before.views?.version).toBe("fixture-v1");
      expect(initialPublication).toBe(before.id);
      const initialBody = await initial.text();
      const warm = await localCall(path);
      expect(warm.status).toBe(200);
      expect(warm.headers.get("x-gsc-cache")).toBe("HIT");
      expect(warm.headers.get("x-gsc-publication")).toBe(initialPublication);
      expect(await warm.text()).toBe(initialBody);

      await callback();
      const same = await localCall(path);
      expect(same.status).toBe(200);
      expect(same.headers.get("x-gsc-cache")).toBe("HIT");
      expect(same.headers.get("x-gsc-publication")).toBe(initialPublication);
      expect(await same.text()).toBe(initialBody);

      for (const [key, body] of fixtureRecords("fixture-v2", "2026-10-21T00:00:00.000Z")) await data.put(key, body);
      const after = await publicationFromBucket(data);
      expect(after.views?.version).toBe("fixture-v2");
      expect(after.id).not.toBe(initialPublication);
      await callback();
      const changed = await localCall(path);
      expect(changed.status).toBe(200);
      expect(changed.headers.get("x-gsc-cache")).toBe("MISS");
      expect(changed.headers.get("x-gsc-publication")).toBe(after.id);
      expect(changed.headers.get("x-gsc-publication")).not.toBe(initialPublication);
      await changed.text();
    } finally { await isolated.dispose(); }
  }, 30_000);
  test("only language GET/HEAD and revalidation POST are independent of pointers", async () => {
    await bucket.put("views/latest.json", "invalid");
    for (const locale of LOCALES) {
      const response = await call(`/api/lang?lang=${locale}&next=/fr/rankings`);
      expect(response.status).toBe(307);
      expect(response.headers.has("x-gsc-publication")).toBe(false);
      expect(response.headers.get("location")).toBe(`${(await worker.ready).origin}${locale === "en" ? "" : `/${locale}`}/rankings`);
      expect(response.headers.get("set-cookie")).toContain("Expires=");
      expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
      expect((await call(`/api/lang?lang=${locale}`, "HEAD")).status).toBe(307);
    }
    expect((await call("/api/workflows/refresh/revalidate", "POST")).status).toBe(401);
    expect((await call("/api/workflows/refresh/revalidate", "POST", true)).status).toBe(200);
    for (const [path, method] of endpoints.filter(([path]) => !path.endsWith("/revalidate"))) {
      const response = await call(path, method);
      expect(response.status).toBe(503); expect(response.headers.has("x-vinext-build-id")).toBe(false); expect(await response.text()).toBe("Publication changed or unavailable; retry");
    }
  });
});

if (process.env.GSC_P7_WORKER_TEST === "1") describe("P7 built aggregate import shell boundary", () => {
  for (const config of IMPORT_GUARD_CONFIGS) test(config.name, async () => {
    const worker = await startWorker(fixtureRecords(), { CRON_SECRET: IMPORT_TEST_SECRET, ...config.strings });
    try { await assertAggregateImportGuards(worker, config.enabled, config.secretConfigured); }
    finally { await worker.dispose(); }
  }, 30_000);
});
