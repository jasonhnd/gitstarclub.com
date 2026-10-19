import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HybridCache, REVALIDATE_SECONDS } from "./hybrid-runtime";
import { proofContext } from "./context";

function harness() {
  const records = new Map<string, string>();
  const responses = new Map<string, Response>();
  const kv = {
    async get(key: string | string[]) {
      return Array.isArray(key) ? new Map(key.map(k => [k, records.get(k) ?? null])) : records.get(key) ?? null;
    },
    async put(key: string, value: string) { records.set(key, value); },
  };
  const hot = {
    async match(request: Request) { return responses.get(request.url)?.clone(); },
    async put(request: Request, response: Response) { responses.set(request.url, response.clone()); },
  };
  const env = { GSC_CACHE: kv, ASSETS: {
    async fetch(url: string) {
      const file = Bun.file(".cloudflare/output/v0/workers/default/assets" + new URL(url).pathname);
      return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
    },
  } };
  const adapter = new HybridCache(env, hot as any);
  const at = <T>(offset: number, fn: () => T, bypass = false) => proofContext.run({
    env, offset, status: "BYPASS", startedAt: Date.now() + offset, bypass,
  }, fn);
  return { adapter, records, responses, at, env, hot };
}
const key = "app:v2:proof:/example/repo:html";
const value = { kind: "APP_PAGE", html: "fixture", rscData: new Uint8Array([0, 255, 128]).buffer };

test("real build snapshot is rejected after path invalidation, including a cold adapter", async () => {
  const h = harness();
  const manifest = JSON.parse(readFileSync("dist/server/vinext-prerender.json", "utf8"));
  const homeKey = `app:v2:${manifest.buildId}:/:html`;
  const before = await h.adapter.get(homeKey);
  expect(before?.value?.kind).toBe("APP_PAGE");
  await h.at(10, () => h.adapter.revalidateTag("_N_T_/"));
  expect(await h.at(20, () => h.adapter.get(homeKey))).toBeNull();
  const cold = new HybridCache(h.env, h.hot as any);
  expect(await h.at(20, () => cold.get(homeKey))).toBeNull();
});

test("seven-day freshness, one-day stale window, and blocking expiry use entry age", async () => {
  const h = harness();
  await h.at(0, () => h.adapter.set(key, value, { tags: ["_N_T_/example/repo"], cacheControl: { revalidate: 86400 } }));
  expect((await h.at(0, () => h.adapter.get(key)))?.value).toEqual(value);
  expect((await h.at((REVALIDATE_SECONDS - 1) * 1000, () => h.adapter.get(key)))?.cacheState).toBe("fresh");
  expect((await h.at((REVALIDATE_SECONDS + 1) * 1000, () => h.adapter.get(key)))?.cacheState).toBe("stale");
  expect(await h.at((REVALIDATE_SECONDS + 86401) * 1000, () => h.adapter.get(key))).toBeNull();
});

test("hot artifacts cannot bypass a tag invalidation and cannot resurrect a build snapshot", async () => {
  const h = harness();
  await h.adapter.set(key, value, { tags: ["_N_T_/example/repo", "targeted-tag"] });
  expect(h.responses.size).toBe(1);
  await h.at(10, () => h.adapter.revalidateTag("targeted-tag"));
  expect(await h.at(20, () => h.adapter.get(key))).toBeNull();
});

test("publication pointer tags leave long-tail pages on their explicit TTL", async () => {
  const h = harness();
  await h.adapter.set(key, value, { tags: ["published-views-pointer", "bootstrap-publication-pointer", "_N_T_/example/repo"] });
  await h.at(10, () => h.adapter.revalidateTag(["published-views-pointer", "bootstrap-publication-pointer"]));
  expect((await h.at(20, () => h.adapter.get(key)))?.value).toEqual(value);
});

test("credentialed requests neither read nor write shared page artifacts", async () => {
  const h = harness();
  await h.adapter.set(key, value);
  expect(await h.at(0, () => h.adapter.get(key), true)).toBeNull();
  const before = h.records.size;
  await h.at(0, () => h.adapter.set("different", value), true);
  expect(h.records.size).toBe(before);
});

test("a tag changed while rendering prevents stale output admission", async () => {
  const h = harness();
  await h.at(10, () => h.adapter.revalidateTag("targeted-tag"));
  await h.at(0, () => h.adapter.set(key, value, { tags: ["targeted-tag"] }));
  expect(h.responses.size).toBe(0);
});
