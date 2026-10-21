import { expect, test } from "bun:test";
import { ArtifactStore, type CacheKV } from "../../web/lib/workers-host/cache/store";
import { readPublication, type PointerRead, type Publication } from "../../web/lib/workers-host/publication-fence";
import { TAIL_EXPIRE_SECONDS, TAIL_FRESH_SECONDS } from "../../web/lib/workers-host/cache/policy";
import { handleRequest, type HostOptions } from "../src/lib/host";

class MemoryKV implements CacheKV {
  values = new Map<string, string>();
  fail = false;
  async get(key: string): Promise<string | null>;
  async get(keys: string[]): Promise<Map<string, string | null>>;
  async get(key: string | string[]) {
    if (this.fail) throw new Error("Cache offline");
    return typeof key === "string" ? this.values.get(key) ?? null : new Map(key.map((item) => [item, this.values.get(item) ?? null]));
  }
  async put(key: string, value: string) { if (this.fail) throw new Error("Cache offline"); this.values.set(key, value); }
}
function harness() {
  const kv = new MemoryKV();
  const store = new ArtifactStore(kv, "astro-test");
  const pointers = new Map<string, PointerRead>();
  const pending: Promise<unknown>[] = [];
  let time = Date.now();
  let renders = 0;
  const publish = (version: string, timestamp = "2026-10-21T00:00:00.000Z") => pointers.set("views/latest.json", { body: JSON.stringify({ version, run_id: version, published_at: timestamp, prev_version: null, schema_ver: 1 }), etag: `${version}:${timestamp}` });
  publish("v1");
  const options: HostOptions = {
    store, build: "build-a", now: () => time,
    publication: () => readPublication(async (key) => pointers.get(key) ?? null),
    waitUntil: (promise) => { pending.push(promise); },
    async render(publication: Publication) {
      renders++;
      return new Response(`<html>${publication.views?.version}</html>`, { headers: { "Content-Type": "text/html" } });
    },
  };
  return { kv, store, pointers, pending, options, publish, renders: () => renders,
    advance: (seconds: number) => { time += seconds * 1000; },
    get: (path = "/example/repo", init?: RequestInit) => handleRequest(new Request(`https://site.example${path}`, init), options),
  };
}

test("a cold tail renders on its first request, then returns identical cached HTML", async () => {
  const h = harness();
  const cold = await h.get();
  expect(cold.headers.get("x-gsc-cache")).toBe("MISS");
  const warm = await h.get();
  expect(warm.headers.get("x-gsc-cache")).toBe("HIT");
  expect(await warm.text()).toBe(await cold.text());
  expect(h.renders()).toBe(1);
  expect(warm.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
});
test("cache keys separate locale, query, origin and build", async () => {
  const h = harness();
  for (const path of ["/example/repo", "/ja/example/repo", "/example/repo?view=other"]) await h.get(path);
  await handleRequest(new Request("https://other.example/example/repo"), h.options);
  h.options.build = "build-b";
  await h.get();
  expect(h.renders()).toBe(5);
});
test("core publication and rollback fence cached HTML; warm tails retain their policy", async () => {
  const h = harness();
  const old = await h.get("/pulse");
  await h.get();
  h.publish("v2");
  expect(await (await h.get("/pulse")).text()).toContain("v2");
  expect(await (await h.get()).text()).toContain("v1");
  h.publish("v1", "2026-10-21T02:00:00.000Z");
  const rollback = await h.get("/pulse");
  expect(rollback.headers.get("x-gsc-cache")).toBe("MISS");
  expect(rollback.headers.get("x-gsc-publication")).not.toBe(old.headers.get("x-gsc-publication"));
});
test("a publication during output generation retries once with captured new data", async () => {
  const h = harness();
  let count = 0;
  h.options.render = async (publication) => {
    if (count++ === 0) h.publish("v2");
    return new Response(`<html>${publication.views?.version}</html>`, { headers: { "Content-Type": "text/html" } });
  };
  expect(await (await h.get("/pulse")).text()).toContain("v2");
  expect(count).toBe(2);
});
test("repeated publication races and invalid pointers fail closed", async () => {
  const h = harness();
  let version = 1;
  h.options.render = async () => { h.publish(`v${++version}`); return new Response("mixed"); };
  expect((await h.get("/pulse")).status).toBe(503);
  expect(h.kv.values.size).toBe(0);
  h.pointers.set("views/latest.json", { body: "invalid", etag: "invalid" });
  expect((await h.get()).status).toBe(503);
  expect((await h.get("/api/lang?lang=ja&next=/pulse")).status).toBe(307);
});
test("stale tails regenerate and expired tails block on a new render", async () => {
  const h = harness();
  await h.get();
  h.publish("v2"); h.advance(TAIL_FRESH_SECONDS + 1);
  const stale = await h.get();
  expect(stale.headers.get("x-gsc-cache")).toBe("STALE");
  expect(await stale.text()).toContain("v1");
  await Promise.all(h.pending);
  expect(await (await h.get()).text()).toContain("v2");
  h.publish("v3"); h.advance(TAIL_EXPIRE_SECONDS + 1);
  const expired = await h.get();
  expect(expired.headers.get("x-gsc-cache")).toBe("MISS");
  expect(await expired.text()).toContain("v3");
});
test("cache loss degrades to rendering; private and HEAD requests never share storage", async () => {
  const h = harness();
  h.kv.fail = true;
  expect((await h.get()).status).toBe(200);
  h.kv.fail = false;
  for (const [name, value] of [["cookie", "session=1"], ["authorization", "Bearer local"], ["range", "bytes=0-1"]]) {
    expect((await h.get("/example/repo", { headers: { [name]: value } })).headers.get("x-gsc-cache")).toBe("BYPASS");
  }
  const head = await h.get("/example/repo", { method: "HEAD" });
  expect(await head.text()).toBe("");
  expect(head.headers.get("x-gsc-cache")).toBe("BYPASS");
  expect(h.kv.values.size).toBe(0);
  let calls = 0;
  h.options.render = async () => { calls++; h.publish("v2"); return new Response(null, { status: 204 }); };
  expect((await h.get("/api/workflows/refresh/step", { method: "POST" })).status).toBe(204);
  expect(calls).toBe(1);
});
test("the P7 invalidation callback remains publication-independent", async () => {
  const h = harness();
  h.options.publication = async () => { throw new Error("Pointer outage"); };
  h.options.unscopedRender = async () => new Response(null, { status: 401 });
  expect((await h.get("/api/workflows/refresh/revalidate", { method: "POST" })).status).toBe(401);
});
test("explicit path invalidation refreshes tails independently of publication", async () => {
  const h = harness();
  await h.get();
  await h.store.revalidateTag("/example/repo");
  h.advance(1);
  expect((await h.get()).headers.get("x-gsc-cache")).toBe("MISS");
});
