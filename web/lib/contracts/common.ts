import { z } from "zod";

// Shared primitives + ranking shapes. See docs/DATA-CONTRACTS.md.
// Dates are UTC. Format kept permissive (validated by sanity checks, not Zod).

/** ISO 'YYYY-MM-DD' (UTC). */
export const DateStr = z.string();
/** Period id: week 'YYYY-Www' | month 'YYYY-MM' | year 'YYYY' | 'all'. */
export const Period = z.string();

export const OwnerType = z.enum(["User", "Organization"]);
export type OwnerType = z.infer<typeof OwnerType>;

/** meta.json — gross→net seam + period fold watermark. Accepts the flat bootstrap meta
 *  (backfilled_at, no folded_through) and the Phase 4 versioned meta (folded_through). */
export const Meta = z.object({
  seam_date: DateStr,
  schema_ver: z.number().int(),
  generated_at: z.string().optional(),
  backfilled_at: z.string().optional(), // bootstrap-only
  folded_through: z.object({ month: Period, week: Period }).optional(), // §8.3 live-overlay watermark
});
export type Meta = z.infer<typeof Meta>;

export const Window = z.enum(["week", "month", "year", "all"]);
export type Window = z.infer<typeof Window>;
export const Dim = z.enum(["repo", "org"]);
export type Dim = z.infer<typeof Dim>;
// flow/stock are the base metrics; growth (rate) and new (first ≥10k) are derived repo views.
export const Metric = z.enum(["flow", "stock", "growth", "new"]);
export type Metric = z.infer<typeof Metric>;

/** One ranking row. `id` for repo dim, `login` for org dim. value may be negative (net flow).
 *  Derived metrics add: `rate` (growth %, float), `base` (期初 stock), `date` (new: crossed-10k day). */
export const RankItem = z.object({
  rank: z.number().int(),
  id: z.number().int().optional(),
  login: z.string().optional(),
  value: z.number().int(),
  prev_rank: z.number().int().nullable(),
  rate: z.number().optional(),
  base: z.number().int().optional(),
  date: z.string().optional(),
});
export type RankItem = z.infer<typeof RankItem>;

/** rank/{window}/{period}/{dim}/{metric}.json */
export const RankList = z.object({
  meta: z.object({
    window: Window,
    period: Period,
    dim: Dim,
    metric: Metric,
    generated_at: z.string(),
  }),
  items: z.array(RankItem),
});
export type RankList = z.infer<typeof RankList>;
