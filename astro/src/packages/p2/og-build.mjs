import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Reuse the old host's pinned image renderer and its binary-asset build plugins.
// This is an import-only compatibility bridge, not a vinext CLI or deployment.
const vinextEntry = fileURLToPath(new URL("../../../../web/node_modules/vinext/dist/index.js", import.meta.url));
const { default: vinext } = await import(/* @vite-ignore */ pathToFileURL(vinextEntry).href);
const ogRequire = createRequire(vinextEntry);
export const ogAliases = [
  { find: /^next\/og$/, replacement: resolve(dirname(vinextEntry), "shims/og.js") },
  { find: /^@vercel\/og$/, replacement: resolve(dirname(ogRequire.resolve("@vercel/og")), "index.edge.js") },
];
export function ogPlugins(scratch) {
  return vinext({ rsc: false }).filter((plugin) => plugin && typeof plugin === "object" && /^vinext:(og-|wasm-module-import)/.test(plugin.name)).map((plugin) => {
    if (plugin.name !== "vinext:og-harfbuzz") return plugin;
    return { ...plugin, configResolved(config) { plugin.configResolved({ ...config, root: scratch }); } };
  });
}
