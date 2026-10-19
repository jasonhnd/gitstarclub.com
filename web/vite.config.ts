import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import { staticAssetsAdapter } from "@vinext/cloudflare/cache/static-assets-adapter";
import { fileURLToPath } from "node:url";

const snapshots = staticAssetsAdapter();
export default defineConfig({
  plugins: [
    vinext({
      prerender: { routes: "*", concurrency: 2 },
      cache: {
        data: kvDataAdapter({ binding: "GSC_CACHE", appPrefix: "gsc-spike-data", tagCacheTtlMs: 0 }),
        cdn: {
          ...snapshots,
          adapter: fileURLToPath(new URL("./spike/hybrid-runtime.ts", import.meta.url)),
        },
      },
    }),
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
  resolve: {
    alias: {
      "@opennextjs/cloudflare": fileURLToPath(new URL("./spike/platform.ts", import.meta.url)),
    },
  },
});
