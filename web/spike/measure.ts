import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const base = "http://127.0.0.1:4174";
const records: any[] = [];
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function request(label: string, path: string, headers: Record<string, string> = {}) {
  const start = performance.now();
  const response = await fetch(base + path, { redirect: "manual", headers: { accept: "text/html", ...headers } });
  const body = await response.text();
  const record = { label, path, status: response.status,
    cache: response.headers.get("x-gsc-cache"), layer: response.headers.get("x-spike-layer"),
    policy: response.headers.get("x-spike-revalidate"), cachedAt: response.headers.get("x-spike-cached-at"),
    type: response.headers.get("content-type"), location: response.headers.get("location"),
    cacheControl: response.headers.get("cache-control"), sha256: sha(body), bytes: Buffer.byteLength(body),
    ms: Math.round((performance.now() - start) * 100) / 100 };
  records.push(record);
  console.log(JSON.stringify(record));
  return { response, body, record };
}
async function control(action: string, extra = {}) {
  const response = await fetch(base + "/api/spike", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const clock = (target: number) => ({ "x-spike-clock-ms": String(target - Date.now()) });
async function main() {
  await fetch("http://127.0.0.1:4074/__control", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"version":"run-a"}' });
  await control("clear");
  const home = await request("build snapshot", "/", { "accept-language": "en" });
  assert.equal(home.record.cache, "SNAPSHOT");
  assert(home.response.headers.get("content-security-policy")?.includes("script-src 'self' 'unsafe-inline'"));
  const manifest = JSON.parse(readFileSync("dist/server/vinext-prerender.json", "utf8"));
  const id = sha(`app:v2:${manifest.buildId}:/:html`);
  const artifact = readFileSync(`.cloudflare/output/v0/workers/default/assets/_vinext/static-cache/${id}.html`, "utf8");
  assert.equal(home.body, artifact, "Core response must be byte-identical to the build artifact");
  const ja = await request("Japanese after cached English", "/", { "accept-language": "ja" });
  assert.equal(ja.record.status, 307); assert.equal(ja.record.location, "/ja");
  const cookie = await request("language cookie before cache", "/", { cookie: "gsc_lang=ja" });
  assert.equal(cookie.record.status, 307); assert.equal(cookie.record.location, "/ja");
  const homeRsc = await request("core RSC snapshot", "/?_rsc", { rsc: "1" });
  assert(homeRsc.record.type?.includes("text/x-component")); assert.notEqual(homeRsc.record.sha256, home.record.sha256);
  const privateCache = await request("private artifacts blocked", "/_vinext/static-cache/index.json");
  assert.equal(privateCache.record.status, 404);
  const cold = await request("long-tail cold", "/example/repo");
  assert.equal(cold.record.status, 200); assert.equal(cold.record.cache, "MISS"); assert(cold.body.includes("Fixture repository"));
  const warm = await request("long-tail warm", "/example/repo");
  assert.equal(warm.record.cache, "HIT"); assert.equal(warm.record.layer, "cache-api");
  assert.equal(warm.record.policy, "604800"); assert.equal(warm.body, cold.body);
  const rsc = await request("long-tail RSC", "/example/repo?_rsc", { rsc: "1" });
  assert(rsc.record.type?.includes("text/x-component")); assert.notEqual(rsc.body, warm.body);
  const query = await request("static query identity", "/example/repo?utm_source=proof");
  assert.equal(query.body, warm.body);
  await control("evict-hot");
  const persistent = await request("KV after hot eviction", "/example/repo");
  assert.equal(persistent.record.layer, "kv"); assert.equal(persistent.body, warm.body);
  const created = Number(warm.record.cachedAt);
  const near = await request("before seven-day revalidate", "/example/repo", clock(created + 604799000));
  assert.equal(near.record.cache, "HIT");
  const staleTarget = created + 604801000;
  const stale = await request("after seven-day revalidate", "/example/repo", clock(staleTarget));
  assert.equal(stale.record.cache, "STALE");
  await Bun.sleep(200);
  const regenerated = await request("after background regeneration", "/example/repo", clock(staleTarget));
  assert.equal(regenerated.record.cache, "HIT"); assert(Number(regenerated.record.cachedAt) > created);
  await control("clear");
  await request("expiry seed cold", "/example/repo");
  const expirySeed = await request("expiry seed warm", "/example/repo");
  const expired = await request("past eight-day hard expiry", "/example/repo", clock(Number(expirySeed.record.cachedAt) + 691201000));
  assert.equal(expired.record.cache, "MISS"); assert.equal(expired.record.layer, "expired");
  await control("clear");
  await request("publication seed snapshot", "/");
  await request("publication seed tail", "/example/repo");
  const before = await request("publication seed warm tail", "/example/repo");
  const published = await control("publish");
  assert.equal(published.corePaths, 56); assert.equal(published.ops.length, 58);
  const pubHome = await request("core after publication", "/");
  assert.equal(pubHome.record.cache, "MISS"); assert.notEqual(pubHome.body, home.body);
  const pubHomeWarm = await request("core warm after publication", "/");
  assert.equal(pubHomeWarm.record.cache, "HIT");
  const oldTail = await request("warm tail keeps TTL on publish", "/example/repo");
  assert.equal(oldTail.record.cache, "HIT"); assert.equal(oldTail.body, before.body);
  const newTail = await request("cold localized tail sees publication", "/ja/example/repo");
  assert.equal(newTail.record.status, 200); assert(newTail.body.includes("Published fixture repository"));
  const rollback = await control("rollback");
  assert.equal(rollback.ops.length, 58);
  const rolled = await request("core after rollback", "/");
  assert.equal(rolled.record.cache, "MISS"); assert.notEqual(rolled.body, pubHome.body);
  const retained = await request("warm tail keeps TTL on rollback", "/ja/example/repo");
  assert.equal(retained.record.cache, "HIT"); assert.equal(retained.body, newTail.body);
  await control("path", { path: "/ja/example/repo" });
  const targeted = await request("targeted tail path invalidation", "/ja/example/repo");
  assert.equal(targeted.record.cache, "MISS"); assert(targeted.body.includes("Fixture repository"));
  const data1 = await request("tagged data cold", "/api/spike");
  const data2 = await request("tagged data warm", "/api/spike");
  assert.equal(data1.body, data2.body);
  await control("tag");
  const data3 = await request("tagged data invalidated", "/api/spike");
  assert.notEqual(data1.body, data3.body);
  for (const [name, headers] of Object.entries({ cookie: { cookie: "gsc_lang=en" },
    authorization: { authorization: "Bearer local-fixture" }, range: { range: "bytes=0-9" } })) {
    const bypass = await request(`${name} bypass`, "/example/repo", headers);
    assert.equal(bypass.record.cache, "BYPASS"); assert.equal(bypass.record.cacheControl, "private, no-store");
  }
  const finalJa = await request("Japanese after mutable cache hit", "/", { "accept-language": "ja" });
  assert.equal(finalJa.record.status, 307); assert.equal(finalJa.record.location, "/ja");
  console.log(`PASS: ${records.length} local HTTP measurements; publication/rollback 2 tags + 56 paths each.`);
}
try { await main(); } finally {
  writeFileSync(`${process.env.GSC_SPIKE_TMP ?? "."}/measurements.json`, JSON.stringify(records, null, 2) + "\n");
}
