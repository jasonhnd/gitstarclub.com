import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Current Cloudflare Workers host for production and preview: serve `next build`
// prerender output from Workers Static Assets. This avoids an R2 incremental
// cache. Preview output is noindex; production output stays indexable.
const base = defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});

// Static-assets incremental cache is read-only at runtime; skip ISR writes that
// log StaticAssetsIncrementalCache "Failed to set" on every miss.
export default {
  ...base,
  dangerous: {
    ...base.dangerous,
    disableIncrementalCache: true,
  },
};
