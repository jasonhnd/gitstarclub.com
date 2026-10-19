import { afterEach, describe, expect, test } from "bun:test";
import type { CachedAppPageValue } from "vinext/shims/cache";
import { HybridPageCache } from "./page-adapter";
import { FencedDataCache } from "./data-adapter";
import { ArtifactStore, decodeEntry, encodeEntry, type CacheKV, type HotCache } from "./store";
import { cacheScope } from "./context";
import { boundedTags, bypassPageCache, isLongTail, pathTags, TAIL_FRESH_SECONDS, TAIL_EXPIRE_SECONDS } from "./policy";
import { publicationScope, readPublication, sha256, type Publication } from "../publication-fence";
import { withWorkerEnv } from "../runtime-env";
import { WorkerCacheInvalidation } from "./invalidation";
import { invalidatePublishedViews } from "../../workflows/publication-cache";

class KV implements CacheKV {
  values = new Map<string, string>();
  writes: { key: string; ttl?: number }[] = [];
  lagTags = false;
  fail = false;
  maxBatch = 0;
  get(key: string): Promise<string | null>;
  get(key: string[]): Promise<Map<string, string | null>>;
  async get(key: string | string[]): Promise<string | null | Map<string, string | null>> {
    if (this.fail) throw new Error("KV unavailable");
    if (Array.isArray(key)) {
      this.maxBatch = Math.max(this.maxBatch, key.length);
      return new Map(key.map((k) => [k, this.lagTags ? null : this.values.get(k) ?? null]));
    }
    return this.values.get(key) ?? null;
  }
  async put(key: string, value: string, options?: { expirationTtl: number }): Promise<void> {
    if (this.fail) throw new Error("KV unavailable");
    this.values.set(key, value); this.writes.push({ key, ttl: options?.expirationTtl });
  }
}
class Hot implements HotCache {
  entries = new Map<string, Response>();
  async match(key: Request) { return this.entries.get(key.url)?.clone(); }
  async put(key: Request, value: Response) { this.entries.set(key.url, value.clone()); }
}
const realNow = Date.now;
let now = 1_800_000_000_000;
afterEach(() => { Date.now = realNow; });
const page = (html = "rendered"): CachedAppPageValue => ({ kind: "APP_PAGE", html, rscData: new Uint8Array([0, 128, 255]).buffer, headers: undefined, postponed: undefined, status: 200 });
async function publication(version = "a", transition = "1"): Promise<Publication> {
  return readPublication(async (path) => path === "views/latest.json" ? {
    body: JSON.stringify({ version, run_id: version, published_at: `2026-10-${transition.padStart(2, "0")}T00:00:00Z`, prev_version: null, schema_ver: 2 }), etag: transition,
  } : null);
}
async function harness(path = "/", hot = new Hot()) {
  Date.now = () => now;
  now = 1_800_000_000_000;
  const kv = new KV();
  const original = await publication();
  let current = original;
  const key = "build:/path:html";
  const id = await sha256(key);
  const assets = { fetch: async (input: string | Request) => {
    const path = new URL(typeof input === "string" ? input : input.url).pathname;
    if (path.endsWith("gsc-host.json")) return Response.json({ publication: original.id, tags: { "/": ["_N_T_/layout", "_N_T_/"] } });
    return path.endsWith("index.json") ? Response.json({ [id]: { kind: "html", lastModified: now - 1000, cacheControl: { revalidate: false } } }) : new Response("snapshot");
  } };
  const env = { GSC_CACHE: kv, ASSETS: assets, DEPLOY_ENV: "pre" };
  const pages = new HybridPageCache(env, original.id, hot);
  const data = new FencedDataCache(env);
  const run = <T>(fn: () => T, captured = current, bypass = false) => {
    const scope = { path, bypass, publication: captured, checkPublication: async () => current, status: "BYPASS" as const, startedAt: now };
    return publicationScope.run(captured, () => cacheScope.run(scope, fn));
  };
  return { kv, hot, pages, data, key, env, original, run, publish: (p: Publication) => { current = p; } };
}

describe("hybrid publication-fenced cache", () => {
  test("serves literal snapshots for HTML and rejects old snapshots with another adapter instance", async () => {
    const h = await harness();
    expect((await h.run(() => h.pages.get(h.key)))?.value).toMatchObject({ html: "snapshot", prerendered: true });
    await h.pages.revalidateTag("_N_T_/");
    const other = new HybridPageCache(h.env, h.original.id);
    expect(await h.run(() => other.get(h.key))).toBeNull();
  });
  test("persistent and regional artifacts retain binary bytes and share invalidation", async () => {
    const h = await harness("/example/repo");
    await h.run(() => h.pages.set(h.key, page(), { tags: ["target"] }));
    const hit = await h.run(() => h.pages.get(h.key));
    expect(hit?.value).toEqual(page());
    h.hot.entries.clear();
    expect((await h.run(() => h.pages.get(h.key)))?.value).toEqual(page());
    expect(h.kv.writes[0].ttl).toBe(2_592_000);
    await h.pages.revalidateTag("target");
    expect(await h.run(() => h.pages.get(h.key))).toBeNull();
  });
  test("tail freshness is seven days, stale for one more day, and hard expiry blocks old output", async () => {
    const h = await harness("/ja/example/repo");
    await h.run(() => h.pages.set(h.key, page(), { cacheControl: { revalidate: 60 } }));
    now += (TAIL_FRESH_SECONDS - 1) * 1000;
    expect((await h.run(() => h.pages.get(h.key)))?.cacheState).toBe("fresh");
    now += 2000;
    expect((await h.run(() => h.pages.get(h.key)))?.cacheState).toBe("stale");
    now += 86_400_000;
    expect(await h.run(() => h.pages.get(h.key))).toBeNull();
    expect(TAIL_EXPIRE_SECONDS).toBe(691_200);
  });
  test("lagged positive/negative KV tags cannot hide publish or rollback to the original run", async () => {
    const h = await harness();
    await h.run(() => h.pages.set(h.key, page("old core")));
    await h.run(() => h.data.set("pointer", { kind: "FETCH", data: { body: "old", url: "https://fixture.invalid", headers: {} }, revalidate: 3600 }));
    h.kv.lagTags = true;
    h.publish(await publication("b", "2"));
    expect(await h.run(() => h.pages.get(h.key))).toBeNull();
    expect(await h.run(() => h.data.get("pointer"))).toBeNull();
    h.publish(await publication("a", "3"));
    expect(await h.run(() => h.pages.get(h.key))).toBeNull();
    expect(await h.run(() => h.data.get("pointer"))).toBeNull();
    // A late write from an old region is never admitted into the new namespace.
    await h.run(() => h.pages.set(h.key, page("late")), h.original);
    expect(await h.run(() => h.pages.get(h.key))).toBeNull();
  });
  test("warm tail survives ordinary publication but a targeted path expires HTML and RSC", async () => {
    const h = await harness("/ja/example/repo");
    await h.run(() => h.pages.set("html", page("old"), { tags: ["published-views-pointer"] }));
    await h.run(() => h.pages.set("rsc", page("old"), { tags: ["bootstrap-publication-pointer"] }));
    h.publish(await publication("b", "2"));
    expect((await h.run(() => h.pages.get("html")))?.value).toMatchObject({ html: "old" });
    await withWorkerEnv(h.env, () => new WorkerCacheInvalidation().revalidatePath("/ja/example/repo"));
    expect(await h.run(() => h.pages.get("html"))).toBeNull();
    expect(await h.run(() => h.pages.get("rsc"))).toBeNull();
  });
  test("data freshness and soft tags apply independently from tail page lifetime", async () => {
    const h = await harness();
    await h.run(() => h.data.set("data", page(), { revalidate: 60 }));
    now += 61_000;
    expect((await h.run(() => h.data.get("data")))?.cacheState).toBe("stale");
    await h.data.revalidateTag("soft");
    expect(await h.run(() => h.data.get("data", { softTags: ["soft"] }))).toBeNull();
  });
  test("credentials bypass page reads/writes and representations remain distinct", async () => {
    const h = await harness("/example/repo");
    await h.run(() => h.pages.set("html", page("html")));
    expect(await h.run(() => h.pages.get("rsc"))).toBeNull();
    expect(await h.run(() => h.pages.get("html"), h.original, true)).toBeNull();
    await h.run(() => h.pages.set("private", page()), h.original, true);
    expect(await h.run(() => h.pages.get("private"))).toBeNull();
    for (const header of ["cookie", "authorization", "range"]) expect(bypassPageCache(new Request("https://fixture.invalid/", { headers: { [header]: "x" } }))).toBe(true);
  });
  test("cache outages fall back to rendering and malformed records never serve", async () => {
    const h = await harness();
    h.kv.fail = true;
    expect(await h.run(() => h.pages.get(h.key))).toBeNull();
    await h.run(() => h.pages.set("new", page()));
    expect(await h.run(() => h.data.get("new"))).toBeNull();
    for (const raw of ["null", "{", '{"v":1}', '{"$gscBytes":"bad!"}']) expect(decodeEntry(raw)).toBeNull();
  });
  test("complete layout tags, bounded bulk reads and codec round trips", async () => {
    const h = await harness();
    const tags = Array.from({ length: 128 }, (_, i) => `tag-${i}`);
    const entry = { v: 1 as const, fence: "f", lastModified: now, tags, value: page() };
    expect(decodeEntry(encodeEntry(entry))).toEqual(entry);
    expect(await new ArtifactStore(h.kv, "test").invalid(entry)).toBe(false);
    expect(h.kv.maxBatch).toBe(100);
    expect(pathTags("/ja/rankings/2026/07")).toContain("_N_T_/(localized)/[locale]/rankings/[year]/[period]/page");
    expect(pathTags("/categories/language/python")).toContain("_N_T_/categories/layout");
    expect(() => boundedTags([...tags, "extra"])).toThrow();
    for (const path of ["/example/repo", "/ja/example/repo", "/o/example", "/fr/categories/language/python/page/2"]) expect(isLongTail(path)).toBe(true);
    for (const path of ["/rankings/2026", "/o/page/2", "/ja/categories/language", "/api/lang", "/robots.txt"]) expect(isLongTail(path)).toBe(false);
  });
  test("real publication invalidation awaits both stores outside a fetch lifecycle", async () => {
    const h = await harness();
    await withWorkerEnv(h.env, () => invalidatePublishedViews());
    // Two global data tags and 56 concrete core paths, in both cache layers.
    expect(h.kv.writes.filter((write) => write.key.includes(":tag:")).length).toBe(116);
  });
});
