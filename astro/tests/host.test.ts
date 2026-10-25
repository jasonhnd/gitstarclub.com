import { expect, test } from "bun:test";
import { ArtifactStore, type CacheKV, type HotCache } from "../../web/lib/workers-host/cache/store";
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
function harness(hot?: HotCache) {
  const kv = new MemoryKV();
  const store = new ArtifactStore(kv, "astro-test", hot);
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
const publicationPaths = ["/pulse", "/react/react", "/ja/react/react", "/o/react", "/categories/language/typescript"];
test.each(publicationPaths)("publication and rollback fence every cached HTML page: %s", async (path) => {
  const entries = new Map<string, Response>();
  const h = harness({
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => { entries.set(request.url, response.clone()); },
  });
  const old = await h.get(path);
  expect((await h.get(path)).headers.get("x-gsc-cache")).toBe("HIT");
  h.publish("v2");
  const changed = await h.get(path);
  expect(changed.headers.get("x-gsc-cache")).toBe("MISS");
  expect(await changed.text()).toContain("v2");
  expect(changed.headers.get("x-gsc-publication")).not.toBe(old.headers.get("x-gsc-publication"));
  expect((await h.get(path)).headers.get("x-gsc-cache")).toBe("HIT");
  h.publish("v1", "2026-10-21T02:00:00.000Z");
  const rollback = await h.get(path);
  expect(rollback.headers.get("x-gsc-cache")).toBe("MISS");
  expect(await rollback.text()).toContain("v1");
  expect(rollback.headers.get("x-gsc-publication")).not.toBe(old.headers.get("x-gsc-publication"));
  expect(entries.size).toBe(3);
  expect(h.kv.values.size).toBe(3);
});
test.each(publicationPaths)("a publication change while reading cached HTML retries: %s", async (path) => {
  const h = harness();
  await h.get(path);
  const get = h.store.get.bind(h.store);
  let raced = false;
  h.store.get = async (key) => {
    const entry = await get(key);
    if (!raced) { raced = true; h.publish("v2"); }
    return entry;
  };
  const response = await h.get(path);
  expect(await response.text()).toContain("v2");
  expect(response.headers.get("x-gsc-publication")).toBe((await h.options.publication()).id);
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
const privateReads = ["cookie", "authorization"].flatMap((header) => ["GET", "HEAD"].flatMap((method) =>
  ["/pulse", "/example/repo"].map((path) => ({ header, method, path }))));
test.each(privateReads)("private reads recheck publication after consuming output: %j", async ({ header, method, path }) => {
  const h = harness();
  const captured: string[] = [];
  let consumed = 0;
  let cacheAccesses = 0;
  h.store.get = async () => { cacheAccesses++; return null; };
  h.store.set = async () => { cacheAccesses++; };
  h.options.render = async (publication) => {
    captured.push(publication.views!.version);
    return new Response(new ReadableStream({
      pull(controller) {
        if (++consumed === 1) h.publish("v2");
        controller.enqueue(new TextEncoder().encode(`<html>${publication.views?.version}</html>`));
        controller.close();
      },
    }, { highWaterMark: 0 }), { headers: { "Content-Type": "text/html", "Set-Cookie": "session=renewed; HttpOnly" } });
  };
  const response = await h.get(path, { method, headers: { [header]: "private" } });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(method === "HEAD" ? "" : "<html>v2</html>");
  expect(captured).toEqual(["v1", "v2"]);
  expect(consumed).toBe(2);
  expect(response.headers.get("x-gsc-publication")).toBe((await h.options.publication()).id);
  expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toBe("session=renewed; HttpOnly");
  expect(cacheAccesses).toBe(0);
  expect(h.kv.values.size).toBe(0);
  expect(h.pending).toHaveLength(0);
});
test.each(privateReads)("private reads fail closed after two publication races: %j", async ({ header, method, path }) => {
  const h = harness();
  let calls = 0;
  h.options.render = async () => {
    h.publish(`v${++calls + 1}`);
    return new Response("obsolete");
  };
  const response = await h.get(path, { method, headers: { [header]: "private" } });
  expect(response.status).toBe(503);
  expect(await response.text()).toBe(method === "HEAD" ? "" : "Published data is temporarily unavailable.");
  expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(calls).toBe(2);
  expect(h.kv.values.size).toBe(0);
});
const legacyMutationReads = ["/api/cron/daily", "/api/cron/weekly", "/api/workflows/refresh/start"]
  .flatMap((path) => ["GET", "HEAD"].map((method) => ({ path, method })));
test.each(legacyMutationReads)("legacy refresh GET/HEAD executes once across its own publication change: %j", async ({ path, method }) => {
  const h = harness();
  const initial = await h.options.publication();
  let reads = 0;
  let calls = 0;
  h.options.publication = async () => {
    if (++reads > 1) throw new Error("Post-write pointer read must not replace a successful mutation");
    return initial;
  };
  h.options.render = async () => {
    calls++;
    h.publish("v2");
    return Response.json({ published: true }, { status: 202 });
  };
  const response = await h.get(path, { method });
  expect(response.status).toBe(202);
  expect(await response.text()).toBe(method === "HEAD" ? "" : '{"published":true}');
  expect(calls).toBe(1);
  expect(reads).toBe(1);
  expect(response.headers.has("x-gsc-publication")).toBe(false);
  expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(h.kv.values.size).toBe(0);
});
test.each(legacyMutationReads)("legacy refresh GET/HEAD never replays a handler that publishes: %j", async ({ path, method }) => {
  const h = harness();
  let calls = 0;
  h.options.render = async () => {
    h.publish(`v${++calls + 1}`);
    return Response.json({ published: true }, { status: 202 });
  };
  const response = await h.get(path, { method });
  expect(calls).toBe(1);
  expect(response.status).toBe(202);
  expect(await response.text()).toBe(method === "HEAD" ? "" : '{"published":true}');
  expect(response.headers.has("x-gsc-publication")).toBe(false);
  expect(h.kv.values.size).toBe(0);
});
const apiReads = [
  "/api/workflows/refresh/step", "/api/workflows/refresh/revalidate", "/api/workflows/refresh/rollback",
].flatMap((path) => ["GET", "HEAD"].map((method) => ({ path, method })));
test.each(apiReads)("API reads recheck publication without adding a page header: %j", async ({ path, method }) => {
  const h = harness();
  const captured: string[] = [];
  let consumed = 0;
  let cacheAccesses = 0;
  h.store.get = async () => { cacheAccesses++; return null; };
  h.store.set = async () => { cacheAccesses++; };
  h.options.render = async (publication) => {
    captured.push(publication.views!.version);
    return new Response(new ReadableStream({
      pull(controller) {
        if (++consumed === 1) h.publish("v2");
        controller.enqueue(new TextEncoder().encode(publication.views!.version));
        controller.close();
      },
    }, { highWaterMark: 0 }), { headers: { "Content-Type": "text/plain" } });
  };
  const response = await h.get(path, { method });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(method === "HEAD" ? "" : "v2");
  expect(captured).toEqual(["v1", "v2"]);
  expect(consumed).toBe(2);
  expect(response.headers.has("x-gsc-publication")).toBe(false);
  expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(cacheAccesses).toBe(0);
  expect(h.kv.values.size).toBe(0);
  expect(h.pending).toHaveLength(0);
});
test.each(["GET", "HEAD"])("API %s fails closed after two publication races without a page header", async (method) => {
  const h = harness();
  let calls = 0;
  h.options.render = async () => {
    h.publish(`v${++calls + 1}`);
    return new Response("obsolete");
  };
  const response = await h.get("/api/unknown", { method });
  expect(response.status).toBe(503);
  expect(await response.text()).toBe(method === "HEAD" ? "" : "Publication changed or unavailable; retry");
  expect(response.headers.has("x-gsc-publication")).toBe(false);
  expect(response.headers.has("x-vinext-build-id")).toBe(false);
  expect(calls).toBe(2);
  expect(h.kv.values.size).toBe(0);
});
test("a publication outage after private rendering fails closed", async () => {
  const h = harness();
  h.options.render = async () => {
    h.options.publication = async () => { throw new Error("Pointer outage"); };
    return new Response("obsolete");
  };
  expect((await h.get("/pulse", { headers: { cookie: "session=1" } })).status).toBe(503);
  expect(h.kv.values.size).toBe(0);
});
test.each([204, 205, 304])("private reads preserve bodyless responses with status %i", async (status) => {
  const h = harness();
  h.options.render = async () => new Response(null, { status });
  const response = await h.get("/pulse", { headers: { authorization: "Bearer local" } });
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("");
  expect(response.headers.get("x-gsc-cache")).toBe("BYPASS");
  expect(h.kv.values.size).toBe(0);
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
  h.advance(TAIL_FRESH_SECONDS + 1);
  const stale = await h.get();
  expect(stale.headers.get("x-gsc-cache")).toBe("STALE");
  expect(await stale.text()).toContain("v1");
  await Promise.all(h.pending);
  expect(await (await h.get()).text()).toContain("v1");
  h.advance(TAIL_EXPIRE_SECONDS + 1);
  const expired = await h.get();
  expect(expired.headers.get("x-gsc-cache")).toBe("MISS");
  expect(await expired.text()).toContain("v1");
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

test("sitemap GET cache headers survive while HEAD, private requests and HTML stay no-store", async () => {
  const h = harness();
  const policy = "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400";
  h.options.render = async () => new Response("<sitemapindex />", {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": policy },
  });
  const response = await h.get("/sitemap.xml", { headers: { "accept-language": "en" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(policy);
  expect(response.headers.get("x-gsc-cache")).toBe("MISS");
  expect(h.kv.values.size).toBe(0);
  const head = await h.get("/sitemap.xml", { method: "HEAD", headers: { "accept-language": "en" } });
  expect(head.headers.get("cache-control")).toBe("private, no-store");
  expect(await head.text()).toBe("");
  expect((await h.get("/sitemap.xml", { headers: { authorization: "Bearer local" } })).headers.get("cache-control")).toBe("private, no-store");
  h.options.render = async () => new Response("<html />", { headers: { "Content-Type": "text/html", "Cache-Control": policy } });
  expect((await h.get("/about")).headers.get("cache-control")).toBe("private, no-store");
});
