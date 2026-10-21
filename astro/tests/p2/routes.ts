import { strict as assert } from "node:assert";
import { getDictionary } from "../../src/lib/i18n";
import { startWorker } from "../../scripts/local-worker";
import { paths, repositoryFixtures } from "./fixture";

const worker = await startWorker(repositoryFixtures());
try {
  const origin = (await worker.ready).origin;
  const get = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, { ...init, redirect: "manual" });
  for (const path of paths) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.ok(html.includes('id="main"'), path);
    assert.ok(!/<astro-island[^>]+component-url="[^"]*(?:repo|StarCurve)/i.test(html), "Repository body/charts must not hydrate");
    if (path.endsWith("/daily")) {
      assert.ok(html.includes('class="curve-line"'));
      if (path.startsWith("/example/")) assert.ok(html.includes((await getDictionary("en")).common.starHistoryNote));
    }
  }
  const cold = await get("/example/history?cache-proof=p2");
  assert.equal(cold.headers.get("x-gsc-cache"), "MISS");
  const warm = await get("/example/history?cache-proof=p2");
  assert.equal(warm.headers.get("x-gsc-cache"), "HIT");
  assert.equal(await cold.text(), await warm.text());
  for (const prefix of ["", "/ja", "/zh", "/zh-TW", "/ko", "/es", "/fr"]) {
    const alias = await get(`${prefix}/example/old-repo`);
    assert.equal(alias.status, 308); assert.equal(new URL(alias.headers.get("location")!, origin).pathname, `${prefix}/example/repo`);
    assert.equal((await get(`${prefix}/absent/repository`)).status, 404);
  }
  for (const [query, status, body] of [["", 400, '{"error":"invalid id"}'], ["?id=0", 400, '{"error":"invalid id"}'], ["?id=1.2", 400, '{"error":"invalid id"}'], ["?id=9007199254740992", 404, '{"error":"not found"}'], ["?id=999", 404, '{"error":"not found"}'], ["?id=1", 200, '{"id":1,"full_name":"example/repo","current_stars":100,"crossed_10k":null,"points":[]}']] as const) {
    const response = await get(`/repo-curve${query}`);
    assert.equal(response.status, status, query);
    assert.equal(await response.text(), body, query);
    assert.equal(response.headers.get("cache-control"), status === 200 ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" : "public, max-age=0, s-maxage=60");
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("x-gsc-cache"), "BYPASS");
    const head = await get(`/repo-curve${query}`, { method: "HEAD" });
    assert.equal(head.status, status); assert.equal(await head.text(), "");
    assert.equal(head.headers.get("cache-control"), response.headers.get("cache-control"));
  }
  const options = await get("/repo-curve", { method: "OPTIONS" });
  assert.equal(options.status, 204); assert.equal(options.headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal((await get("/repo-curve", { method: "POST" })).status, 405);
  for (const path of ["/example/repo/opengraph-image", "/unknown/repository/opengraph-image"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint32(16), 1200); assert.equal(view.getUint32(20), 630);
  }
  const bucket = await worker.getR2Bucket("DATA");
  await bucket.put("views/latest.json", "invalid");
  assert.equal((await get("/repo-curve?id=0")).status, 400);
  assert.equal((await get("/repo-curve", { method: "OPTIONS" })).status, 204);
  assert.equal((await get("/repo-curve", { method: "POST" })).status, 405);
  assert.equal((await get("/repo-curve?id=1")).status, 503);
  console.log("PASS P2 built Worker: 21 locale pages, cache MISS/HIT, 7 aliases/404s, 6 exact GET/HEAD endpoint cases, 2 PNG social images.");
} finally { await worker.dispose(); }
