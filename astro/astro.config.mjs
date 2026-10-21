import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { resolve } from "node:path";

const scratch = process.env.KANBAN_TMP;
if (!scratch) throw new Error("Set KANBAN_TMP to this card's local scratch directory.");

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough", remoteBindings: false, persistState: false }),
  session: false,
  trailingSlash: "never",
  outDir: resolve(scratch, "astro-dist"),
  cacheDir: resolve(scratch, "astro-cache"),
  devToolbar: { enabled: false },
  vite: {
    cacheDir: resolve(scratch, "astro-vite"),
    build: { minify: false },
  },
});
