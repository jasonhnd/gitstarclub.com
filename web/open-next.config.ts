import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Current Cloudflare Workers host for production and preview: serve `next build`
// prerender output from Workers Static Assets. This avoids an R2 incremental
// cache. Preview output is noindex; production output stays indexable.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
