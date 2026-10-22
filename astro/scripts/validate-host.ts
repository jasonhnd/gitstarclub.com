import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { astroHostWorker } from "../cloudflare.config";
import { startWorker } from "./local-worker";
import { fixtureRecords } from "./fixture";
import { contentSecurityPolicyForEnvironment } from "../../web/lib/csp";
import { assertHostContract } from "../../scripts/cf-ci-gates.mjs";

const mode = process.argv[process.argv.indexOf("--mode") + 1];
assert(["production", "pre"].includes(mode), "--mode production or pre required");
const scratch = process.env.KANBAN_TMP;
assert(scratch, "Set card-local KANBAN_TMP");
const output = resolve(scratch, "astro-cloudflare/output/v0");
const read = (path: string) => JSON.parse(readFileSync(resolve(output, path), "utf8"));
const stamp = JSON.parse(readFileSync(resolve(scratch, "astro-host-build.json"), "utf8"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(stamp.commit, commit, "rebuild the exact current commit");
assert.equal(stamp.mode, mode);
assert.equal(read("config.json").buildContext.mode, mode);
const config = read("workers/default/worker.config.json");
const expected = astroHostWorker(mode, config.env.BLOB_BASE_URL ? { BLOB_BASE_URL: config.env.BLOB_BASE_URL.value } : {});
for (const field of ["name", "compatibilityDate", "compatibilityFlags", "workersDev", "previewUrls", "observability", "triggers", "env", "assets"] as const) {
  assert.deepEqual(config[field], expected[field], `preserve ${field}`);
}
assert.deepEqual(assertHostContract(astroHostWorker(mode), mode, "astro"), [], "source host contract");
assert.deepEqual(config.triggers.filter((trigger: { type: string }) => trigger.type === "scheduled"),
  mode === "pre" ? ["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"].map((schedule) => ({ type: "scheduled", schedule })) : [],
  "preview schedules only; production remains queue-only");
for (const flag of ["WORKFLOW_COLD_START", "PREFLIGHT_RELAX_EMPTY_SHARDS", "WORKFLOW_FIXTURE"]) {
  assert(!Object.hasOwn(config.env, flag), `${flag} must stay absent`);
}
const assets = resolve(output, "workers/default/assets");
const fontFiles = readdirSync(resolve(assets, "_astro")).filter((path) => /\.(?:woff2?|ttf)$/.test(path));
assert(fontFiles.some((path) => path.includes("jakarta")) && fontFiles.some((path) => path.includes("geist")), "both local font families packaged");
assert(readFileSync(resolve(assets, "_headers"), "utf8").includes(contentSecurityPolicyForEnvironment("production")), "static assets retain CSP");
const worker = await startWorker(fixtureRecords());
try {
  const origin = (await worker.ready).origin;
  const get = (path: string) => fetch(new URL(path, origin), { headers: { "accept-language": "en" }, redirect: "manual" });
  for (const path of ["/", "/ja/privacy", "/rankings", "/about"]) {
    const response = await get(path);
    const html = await response.text();
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-robots-tag"), mode === "pre" ? "noindex, nofollow" : null, path);
    assert.equal(/name="robots" content="[^"]*noindex/.test(html), mode === "pre", path);
    assert.equal(response.headers.get("content-security-policy"), contentSecurityPolicyForEnvironment("production"));
    assert(!/https?:\/\/fonts\.(?:googleapis|gstatic)\.com/.test(html), "no remote fonts");
  }
  const robots = await (await get("/robots.txt")).text();
  assert.equal(robots.includes("Sitemap: https://gitstarclub.com/sitemap.xml"), mode === "production");
  if (mode === "pre") assert.equal(robots, "User-Agent: *\nDisallow: /\n\n");
  const card = await get("/opengraph-image");
  assert.equal(card.status, 200);
  assert.match(card.headers.get("content-type") ?? "", /^image\/png/);
  const png = new DataView(await card.arrayBuffer());
  assert.equal(png.getUint32(0), 0x89504e47); assert.equal(png.getUint32(16), 1200); assert.equal(png.getUint32(20), 630);
  for (const path of ["/cockpit", "/ja/cockpit", "/cockpit/jobs", "/unknown-page"]) assert.equal((await get(path)).status, 404, path);
  const exportDate = readdirSync(resolve(assets, "data/exports/v1"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)).map((entry) => entry.name).sort().at(-1);
  assert(exportDate, "dated static exports required");
  for (const file of ["manifest.json", "top-rankings.csv", "top-rankings.json", "top-repo-milestones.csv", "top-repo-milestones.json", "top-org-aggregates.csv", "top-org-aggregates.json"]) {
    const alias = `/data/exports/v1/latest/${file}`;
    const response = await get(alias);
    assert.equal(response.status, 200, alias);
    assert.equal(await response.text(), readFileSync(resolve(assets, "data/exports/v1", exportDate, file), "utf8"), alias);
    const head = await fetch(new URL(alias, origin), { method: "HEAD" });
    assert.equal(head.status, 200, `HEAD ${alias}`); assert.equal(await head.text(), "");
  }
  assert.equal((await (await get("/.well-known/deployment")).json()).commitSha, commit);
  assert.equal((await (await get("/preview/identity")).json()).commitSha, commit);
  assert.equal((await (await get("/preview/health")).json()).hosting, "astro");
  console.log(`Astro host validated: ${mode}; ${commit}; schedules=${JSON.stringify(config.triggers.filter((trigger: { type: string }) => trigger.type === "scheduled"))}; bindings/queue/indexing/CSP/local fonts/default PNG/cockpit 404`);
} finally { await worker.dispose(); }
