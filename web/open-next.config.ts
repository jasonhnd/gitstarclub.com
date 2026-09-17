import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// P3 preview host: serve `next build` prerender output from Workers Static
// Assets. This avoids R2 incremental-cache populate (which needs Access on
// workers.dev) and does not change Vercel production ISR.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
