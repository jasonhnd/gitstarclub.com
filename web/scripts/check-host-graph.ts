import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const lock = Bun.JSONC.parse(readFileSync(`${root}bun.lock`, "utf8")) as { packages: Record<string, unknown[]> };
const forbidden = /(?:^|\/)wran[g]ler(?:@|\/|$)|@opennextjs\/cloudflare/;
const entries = Object.entries(lock.packages);
for (const [key, value] of entries) {
  if (forbidden.test(key) || forbidden.test(String(value[0]))) throw new Error(`Forbidden host dependency: ${key}`);
}
const pins: Record<string, string> = {
  vinext: "1.2.1", "@vinext/cloudflare": "1.1.1", vite: "8.3.3",
  "@cloudflare/vite-plugin": "2.0.0-beta.v.2", cf: "1.0.0-beta.18",
  react: "19.3.1", "react-dom": "19.3.1", "react-server-dom-webpack": "19.3.1",
};
for (const [name, version] of Object.entries(pins)) {
  if (lock.packages[name]?.[0] !== `${name}@${version}`) throw new Error(`Host pin mismatch: ${name}`);
  const installed = JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`, "utf8")) as { version: string };
  if (installed.version !== version) throw new Error(`Installed host pin mismatch: ${name}`);
}
console.log(`Host graph verified: ${entries.length} nodes, all exact pins, no legacy CLI/adapter`);
