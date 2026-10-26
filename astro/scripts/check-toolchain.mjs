import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(process.versions.node.split(".")[0], "24", "Use Node 24");
assert.equal(pkg.packageManager, "bun@1.4.2");
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/, `${name} must have an exact pin`);
}
const lock = readFileSync(new URL("../bun.lock", import.meta.url), "utf8");
assert.doesNotMatch(lock, /["/]wrangler(?:@|"|\/)/i, "Wrangler is forbidden in the Astro dependency graph");
for (const name of ["astro", "@astrojs/cloudflare", "@cloudflare/vite-plugin", "cf"]) {
  const installed = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"));
  assert.equal(installed.version, pkg.dependencies[name] ?? pkg.devDependencies[name]);
  assert.ok(!installed.dependencies?.wrangler && !installed.peerDependencies?.wrangler, `${name} requires Wrangler`);
}
console.log("Astro dependency graph: exact pins, Node 24, Bun 1.4.2, no Wrangler");
