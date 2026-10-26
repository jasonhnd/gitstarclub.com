import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { rankingImages } from "./src/packages/p1/image-build.mjs";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

import { productionBundles } from "./scripts/production-bundles.mjs";

import { categoryViewPlugin } from "./src/packages/p3/view-plugin.ts";

const hostMode = process.env.GSC_HOST_MODE ?? "pre";
if (!["pre", "production"].includes(hostMode)) throw new Error("Select explicit mode pre or production.");
const exportRoot = fileURLToPath(new URL("../web/public/data/exports/v1/", import.meta.url));
const exportDate = readdirSync(exportRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)).map((entry) => entry.name).sort().at(-1) ?? null;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const identityPlugin = {
  name: "astro-build-identity",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === "./cf-build-identity" && importer?.endsWith("/web/lib/deployment-commit.ts")) return "\0astro-build-identity";
  },
  load(id) { if (id === "\0astro-build-identity") return `export const cfBuildCommitSha = ${JSON.stringify(commit)};`; },
};
const scratch = process.env.KANBAN_TMP;
if (!scratch) throw new Error("Set KANBAN_TMP to this card's local scratch directory.");

export default defineConfig({
  output: "server",
  publicDir: "../web/public",
  adapter: cloudflare({ imageService: "passthrough", remoteBindings: false, persistState: false }),
  session: false,
  integrations: [react()],
  trailingSlash: "never",
  outDir: resolve(scratch, "astro-dist"),
  cacheDir: resolve(scratch, "astro-cache"),
  devToolbar: { enabled: false },
  vite: {
    mode: hostMode,
    plugins: [identityPlugin, rankingImages(), categoryViewPlugin(), tailwindcss(), productionBundles(scratch)],
    resolve: { dedupe: ["react", "react-dom"], alias: [
      { find: /^@\/lib\/fetch-timeout\.mjs$/, replacement: fileURLToPath(new URL("./src/lib/published-readers.ts", import.meta.url)) },
      { find: /^next\/link$/, replacement: fileURLToPath(new URL("./src/components/Link.tsx", import.meta.url)) },
      { find: /^next\/navigation$/, replacement: fileURLToPath(new URL("./src/lib/navigation.ts", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("../web/", import.meta.url)) },
    ] },
    define: {
      __GSC_ASTRO_BUILD__: JSON.stringify(commit),
      __GSC_ASTRO_MODE__: JSON.stringify(hostMode),
      __GSC_ASTRO_EXPORT_DATE__: JSON.stringify(exportDate),
      "process.env.SITE_INDEXABLE": JSON.stringify(hostMode === "production" ? "1" : "0"),
    },
    cacheDir: resolve(scratch, "astro-vite"),
    build: { minify: "oxc" },
  },
});
