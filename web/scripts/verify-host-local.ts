import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOCALES } from "../lib/i18n/locales";

const [origin, mode] = process.argv.slice(2);
const target = new URL(origin);
assert(target.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  && !target.username && !target.password && !target.search && !target.hash && target.pathname === "/", "local loopback origin required");
assert(["pre", "production"].includes(mode), "explicit pre or production mode required");
let checks = 0;
const check = (value: unknown, label: string) => { assert(value, label); checks++; };
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${target.origin}${path}`, {
  redirect: "manual", headers: { accept: "text/html", "sec-fetch-dest": "document", ...headers },
});
const home = await get("/");
const html = await home.text();
check(home.status === 200, "home response");
check(home.headers.get("x-gsc-cache") === "SNAPSHOT", "home must serve a literal build snapshot");
check(home.headers.get("content-security-policy")?.includes("script-src 'self' 'unsafe-inline'"), "unchanged CSP");
check(/name="robots" content="[^"]*noindex/.test(html) === (mode === "pre"), "HTML indexing mode");
const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "../dist/server/vinext-prerender.json"), "utf8")) as { routes: { route: string; status: string }[] };
check(manifest.routes.some((route) => route.route === "/" && route.status === "rendered"), "home prerender inventory");
const snapshot = readFileSync(resolve(import.meta.dir, "../dist/server/prerendered-routes/index.html"), "utf8");
check(digest(snapshot) === digest(html), "literal snapshot byte equality");
check((await get("/_vinext/static-cache/index.json")).status === 404, "private cache inventory denied");
for (const locale of LOCALES) {
  const response = await get(locale === "en" ? "/" : `/${locale}`);
  const body = await response.text();
  check(response.status === 200 && body.includes(`<html lang="${locale === "zh" ? "zh-CN" : locale}"`), `${locale} document language`);
  check(/name="robots" content="[^"]*noindex/.test(body) === (mode === "pre"), `${locale} indexing`);
}
const query = await get("/?view=local");
check(query.status === 200 && await query.text() === html, "static query variant snapshot identity");
const arbitraryRsc = await get("/?_rsc=local", { RSC: "1" });
check(arbitraryRsc.status === 307, "RSC query canonicalization");
const negotiated = await get("/", { "accept-language": "ja-JP,ja;q=0.9" });
check(negotiated.status === 307 && new URL(negotiated.headers.get("location")!, target).pathname === "/ja", "language negotiation after English snapshot");
const canonical = await get("/en/example/repo");
check(canonical.status === 308 && new URL(canonical.headers.get("location")!, target).pathname === "/example/repo", "English canonical redirect");
const language = await get("/api/lang?lang=ja&next=/example/repo");
check(language.status === 307 && new URL(language.headers.get("location")!, target).pathname === "/ja/example/repo", "language API destination");
check(language.headers.get("set-cookie")?.includes("gsc_lang=ja"), "language preference cookie");
const rsc = await get("/?_rsc", { RSC: "1" });
check(rsc.status === 200 && rsc.headers.get("content-type")?.includes("text/x-component"), "separate RSC snapshot");
check(await rsc.text() !== html, "HTML and RSC isolation");
const cold = await get("/example/repo");
const tail = await cold.text();
check(cold.status === 200 && ["MISS", "HIT"].includes(cold.headers.get("x-gsc-cache") ?? ""), "on-demand tail generation");
const warm = await get("/example/repo");
check(warm.status === 200 && warm.headers.get("x-gsc-cache") === "HIT", "warm tail cache");
check(await warm.text() === tail, "warm artifact bytes");
for (const header of ["cookie", "authorization", "range"]) {
  const response = await get("/", { [header]: header === "cookie" ? "local=1" : header === "range" ? "bytes=0-10" : "local-test" });
  check(response.headers.get("x-gsc-cache") === "BYPASS", `${header} bypass`);
  await response.arrayBuffer();
}
const robots = await get("/robots.txt");
const rules = await robots.text();
check(robots.status === 200 && (mode === "pre" ? /^Disallow: \/$/m.test(rules) : /^Allow: \/$/m.test(rules) && rules.includes("Sitemap:")), "robots policy");
const fonts = [...html.matchAll(/(?:href|src)="([^"\s]+\.woff2)"/g)].map((match) => match[1]);
check(fonts.length > 0 && fonts.every((url) => url.startsWith("/")), "local font URLs");
for (const url of new Set(fonts)) {
  const response = await get(url);
  check(response.status === 200 && (await response.arrayBuffer()).byteLength > 1000, "packaged font served");
  check(response.headers.get("content-security-policy")?.includes("font-src 'self'"), "static asset security headers");
}
// Route-group image names carry framework-generated suffixes. Discover the
// actual bundled handlers rather than assuming unsuffixed metadata URLs work.
const bundle = readFileSync(resolve(import.meta.dir, "../.cloudflare/output/v0/workers/default/bundle/index.js"), "utf8");
const imageUrls = new Set([...bundle.matchAll(/servedUrl:[`"']([^`"']*opengraph-image[^`"']*)[`"']/g)]
  .map((match) => match[1].replace("[locale]", "example").replace("[owner]", "repo").replace("[year]", "2026").replace("[period]", "07")));
check(imageUrls.size === 4, "all generated image handlers discovered");
const imageHashes = new Map<string, string>();
for (const path of imageUrls) {
  const response = await get(path);
  const bytes = new Uint8Array(await response.arrayBuffer());
  check(response.status === 200 && response.headers.get("content-type")?.includes("image/png"), `${path} PNG response`);
  check(Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${path} PNG signature`);
  imageHashes.set(path, digest(bytes));
  const data = new DataView(bytes.buffer);
  check(data.getUint32(16) === 1200 && data.getUint32(20) === 630, `${path} PNG dimensions`);
}
const repoImage = [...imageUrls].find((path) => path.startsWith("/example/repo/"))!;
const unknownImage = await get(repoImage.replace("/example/repo/", "/unknown/unknown/"));
const unknownHash = digest(new Uint8Array(await unknownImage.arrayBuffer()));
check(unknownImage.status === 200 && unknownHash === imageHashes.get("/opengraph-image"), "unknown repository generic image");
check(imageHashes.get(repoImage) !== unknownHash, "known repository image uses validated fixture entity");
const identity = await get("/.well-known/deployment");
const built = JSON.parse(readFileSync(resolve(import.meta.dir, "../dist/server/gsc-host-build.json"), "utf8")) as { commit: string };
check((await identity.json() as { commitSha: string }).commitSha === built.commit, "embedded build identity");
console.log(JSON.stringify({ origin: target.origin, mode, checks, snapshotSha256: digest(html), tailSha256: digest(tail), result: "PASS" }, null, 2));
