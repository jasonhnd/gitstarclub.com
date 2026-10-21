import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { rankingImages } from "./src/packages/p1/image-build.mjs";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

import { categoryViewPlugin } from "./src/packages/p3/view-plugin.ts";

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
    plugins: [rankingImages(), categoryViewPlugin(), tailwindcss()],
    resolve: { alias: [
      { find: /^@\/lib\/fetch-timeout\.mjs$/, replacement: fileURLToPath(new URL("./src/lib/published-readers.ts", import.meta.url)) },
      { find: /^next\/link$/, replacement: fileURLToPath(new URL("./src/components/Link.tsx", import.meta.url)) },
      { find: /^next\/navigation$/, replacement: fileURLToPath(new URL("./src/lib/navigation.ts", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("../web/", import.meta.url)) },
    ] },
    define: { __GSC_ASTRO_BUILD__: JSON.stringify(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()) },
    cacheDir: resolve(scratch, "astro-vite"),
    build: { minify: false },
  },
});
