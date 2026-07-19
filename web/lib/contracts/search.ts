import { z } from "zod";
import { DateStr, NonNegativeInt, SafeText, TimestampStr } from "./common";

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
  active: z.boolean().optional(),
  tracked_since: DateStr.nullable().optional(),
}).strict();
export type SearchDoc = z.infer<typeof SearchDoc>;

/**
 * Pre-hardening publishes wrote the workflow run-id into `generated_at`
 * (e.g. `refresh-2026-06-21T06-00-05-520Z`) instead of an ISO timestamp.
 * Map that shape onto a valid TimestampStr so the live pointer keeps serving
 * until the next successful refresh advances it.
 */
const LEGACY_RUN_ID_GENERATED_AT =
  /^refresh-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

export function normalizeSearchGeneratedAt(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = LEGACY_RUN_ID_GENERATED_AT.exec(value);
  if (!match) return value;
  const [, date, hh, mm, ss, ms] = match;
  return `${date}T${hh}:${mm}:${ss}.${ms}Z`;
}

export const SearchIndex = z
  .object({
    generated_at: z.preprocess(normalizeSearchGeneratedAt, TimestampStr),
    count: NonNegativeInt,
    repos: z.array(SearchDoc),
  })
  .strict()
  .refine((index) => index.count === index.repos.length, "count must match repos length");
export type SearchIndex = z.infer<typeof SearchIndex>;
