import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { hostWorker } from "../cloudflare.config";
import { assertHostContract } from "../../scripts/cf-ci-gates.mjs";
import { loopbackBase } from "../host-contract.mjs";
import { contentSecurityPolicyForEnvironment } from "../lib/csp";
import { LOCALES } from "../lib/i18n/locales";

const mode = process.argv[process.argv.indexOf("--mode") + 1];
assert(["production", "pre"].includes(mode), "--mode production or pre required");
const root = resolve(import.meta.dir, "..");
const output = resolve(root, ".cloudflare/output/v0");
const read = (file: string) => JSON.parse(readFileSync(resolve(output, file), "utf8"));
const context = read("config.json");
assert.equal(context.buildContext.mode, mode);
const worker = read("workers/default/worker.config.json");
const expected = hostWorker(mode);
const expectedEnv = expected.env as Record<string, { type: string; value?: string }>;
// Loopback data overrides are permitted only for local builds, never an opposite environment.
if (loopbackBase(worker.env.BLOB_BASE_URL?.value)) {
  delete worker.env.BLOB_BASE_URL;
  worker.env.STORAGE_READ_DRIVER = expectedEnv.STORAGE_READ_DRIVER;
  if (mode === "pre") delete worker.env.VIEWS_VERSION_FALLBACK;
  else worker.env.VIEWS_VERSION_FALLBACK = expectedEnv.VIEWS_VERSION_FALLBACK;
}
assert.deepEqual(assertHostContract({ ...worker, entrypoint: expected.entrypoint, manifest: undefined }, mode), []);
const host = read("workers/default/assets/_vinext/static-cache/gsc-host.json");
assert.equal(host.mode, mode);
assert.match(host.publication, /^[a-f0-9]{64}$/);
assert.match(host.commit, /^[a-f0-9]{40,64}$/);
const routes = Object.keys(host.tags);
assert(routes.length >= 200 && routes.length < 1000, "bounded core snapshot inventory");
for (const locale of LOCALES) assert(routes.includes(locale === "en" ? "/" : `/${locale}`), `missing ${locale} home snapshot`);
assert(!routes.includes("/example/repo"), "long tail must not be prerendered");
const index = read("workers/default/assets/_vinext/static-cache/index.json");
assert(Object.keys(index).length >= 400, "HTML/RSC snapshots required");
const homeMeta = Object.entries(index).find(([id, meta]) => (meta as { kind: string }).kind === "html"
  && readFileSync(resolve(output, `workers/default/assets/_vinext/static-cache/${id}.html`), "utf8").includes('<html lang="en"'));
assert(homeMeta, "English HTML snapshot required");
const home = readFileSync(resolve(output, `workers/default/assets/_vinext/static-cache/${homeMeta[0]}.html`), "utf8");
assert.equal(/name="robots" content="[^"]*noindex/.test(home), mode === "pre");
assert(!/https?:\/\/fonts\.(?:googleapis|gstatic)\.com/.test(home), "fonts must be self-hosted");
const assetHeaders = readFileSync(resolve(output, "workers/default/assets/_headers"), "utf8");
assert(assetHeaders.includes(contentSecurityPolicyForEnvironment("production")), "hashed asset CSP required");
assert(!assetHeaders.includes("unsafe-eval"), "production CSP stays unchanged");
const fonts = resolve(output, "workers/default/assets/_next/static/_vinext_fonts");
assert(existsSync(fonts) && readdirSync(fonts).length >= 2, "both font families must be packaged");
console.log(`Host build validated: ${mode}; ${routes.length} routes; ${Object.keys(index).length} artifacts; ${host.commit}; local fonts/indexing/bindings valid`);
