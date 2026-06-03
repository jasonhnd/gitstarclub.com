import { cache } from "react";
import { SearchIndex } from "@/lib/contracts";
import { readView } from "./source";

// Client-loaded search index, resolved through the publish pointer (versioned, rollback-safe).
// Read server-side only; the browser gets it CDN-cached via app/search-index/route.ts.
export const getSearchIndex = cache(() => readView("search/index.json", SearchIndex, { base: true }));
