import { afterAll, beforeAll, expect, test } from "bun:test";
import { startWorker } from "../scripts/local-worker";
import { fixtureRecords } from "../scripts/fixture";
import { LOCALES, localizedPath, toHreflang } from "../src/lib/i18n";
import type { R2Bucket } from "../../web/lib/storage/r2-binding-store";

let worker: Awaited<ReturnType<typeof startWorker>>;
beforeAll(async () => { worker = await startWorker(); }, 30_000);
afterAll(async () => { await worker?.dispose(); });
// Exercise the listening HTTP server; Bun does not apply Undici's synthetic-origin dispatcher.
const get = async (path: string) => fetch(new URL(path, await worker.ready), { redirect: "manual" });

test("the built Astro Worker renders all seven URL locales and existing shell translations", async () => {
  for (const locale of LOCALES) {
    const response = await get(localizedPath(locale, "/privacy"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`<html lang="${toHreflang(locale)}"`);
    expect(html).toContain("/api/lang?lang=ja");
    expect(html).toContain("2026-07-17T00:00:00.000Z");
    expect(html).toContain("<header"); expect(html).toContain("<footer");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
  }
}, 30_000);
test("the real Worker caches cold long tails, fences core publication, and preserves warm tails", async () => {
  const path = "/example/repo?worker-proof=1";
  const cold = await get(path);
  const coldHtml = await cold.text();
  expect(cold.headers.get("x-gsc-cache")).toBe("MISS");
  const warm = await get(path);
  expect(warm.headers.get("x-gsc-cache")).toBe("HIT");
  expect(await warm.text()).toBe(coldHtml);
  const core = await get("/pulse"); await core.text();
  const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
  for (const [key, body] of fixtureRecords("fixture-v2", "2026-10-21T00:00:00.000Z")) await bucket.put(key, body);
  const changed = await get("/pulse");
  expect(changed.headers.get("x-gsc-cache")).toBe("MISS");
  expect(await changed.text()).toContain("2026-10-21T00:00:00.000Z");
  expect(await (await get(path)).text()).toBe(coldHtml);
});
test("language redirects and deployment identity survive a broken DATA pointer", async () => {
  const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
  await bucket.put("views/latest.json", "invalid");
  const redirect = await get("/api/lang?lang=ja&next=/example/repo");
  expect(redirect.status).toBe(307);
  const origin = (await worker.ready).origin;
  expect(redirect.headers.get("location")).toBe(`${origin}/ja/example/repo`);
  expect(redirect.headers.get("set-cookie")).toContain("gsc_lang=ja");
  const identity = await get("/.well-known/deployment");
  expect(identity.status).toBe(200);
  expect(identity.headers.get("cache-control")).toBe("no-store, max-age=0");
  expect(await identity.json()).toMatchObject({ target: "cf", host: new URL(origin).host, deploymentUrl: origin });
  expect((await get("/pulse")).status).toBe(503);
});
