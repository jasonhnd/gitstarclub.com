import { z } from "zod";
import { NonNegativeInt, SafeText, TimestampStr } from "./common";

// search/index.json — flat client-side search index derived from the repos shard during
// recompute (one doc per tracked repo). Lazy-loaded by the SearchBox on first focus and fed
// to MiniSearch in the browser; zero runtime backend (served CDN-cached via /search-index).
// See docs/FRONTEND.md and docs/DATA-CONTRACTS.md for the surrounding architecture.

/** One searchable repo. Kept lean — only what ranks results and renders a hit row. */
export const SearchDoc = z.object({
  id: NonNegativeInt,
  full_name: SafeText,
  owner: SafeText,
  language: SafeText.nullable().optional(),
  current_stars: NonNegativeInt,
  description: SafeText.nullable().optional(),
}).strict();
export type SearchDoc = z.infer<typeof SearchDoc>;

export const SearchIndex = z.object({
  generated_at: TimestampStr,
  count: NonNegativeInt,
  repos: z.array(SearchDoc),
}).strict().refine((index) => index.count === index.repos.length, "count must match repos length");
export type SearchIndex = z.infer<typeof SearchIndex>;
