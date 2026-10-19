import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const raw = readFileSync("bun.lock", "utf8");
const { config: lock, error } = ts.parseConfigFileTextToJson("bun.lock", raw);
assert(!error);
const nodes = Object.entries<any>(lock.packages);
assert(nodes.every(([name, entry]) => !/(^|\/)wrangler$/.test(name) && !/^wrangler@/.test(entry[0])));
assert(!existsSync("node_modules/wrangler"));
assert(!existsSync("node_modules/@opennextjs/cloudflare"));
const expected = {
  vinext: "1.2.1", "@vinext/cloudflare": "1.1.1", vite: "8.3.0",
  "@cloudflare/vite-plugin": "2.0.0-beta.v.2", cf: "1.0.0-beta.18",
};
for (const [name, version] of Object.entries(expected)) {
  const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"));
  assert.equal(installed.version, version);
  console.log(`${name}@${version}`);
}
console.log(`PASS: ${nodes.length} locked package nodes; no direct or transitive Wrangler, no OpenNext installation.`);
