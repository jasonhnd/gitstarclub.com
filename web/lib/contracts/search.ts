import { z } from "zod";

// search/index.json — flat client-side search index derived from the repos shard during
// recompute (one doc per tracked repo). Lazy-loaded by the SearchBox on first focus and fed
// to MiniSearch in the browser; zero runtime backend (served CDN-cached via /search-index).
// See docs/V0.2-DESIGN.md §1.

/** One searchable repo. Kept lean — only what ranks results and renders a hit row. */
export const SearchDoc = z.object({
  id: z.number().int(),
  full_name: z.string(),
  owner: z.string(),
  language: z.string().nullable().optional(),
  current_stars: z.number().int(),
  description: z.string().nullable().optional(),
});
export type SearchDoc = z.infer<typeof SearchDoc>;

export const SearchIndex = z.object({
  generated_at: z.string(),
  count: z.number().int(),
  repos: z.array(SearchDoc),
});
export type SearchIndex = z.infer<typeof SearchIndex>;
