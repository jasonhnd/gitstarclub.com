import { z } from "zod";

// Shared primitives + ranking shapes. See docs/DATA-CONTRACTS.md.
// Dates are UTC. Format kept permissive (validated by sanity checks, not Zod).

/** ISO 'YYYY-MM-DD' (UTC). */
export const DateStr = z.string();
/** Period id: week 'YYYY-Www' | month 'YYYY-MM' | year 'YYYY' | 'all'. */
export const Period = z.string();

export const OwnerType = z.enum(["User", "Organization"]);
export type OwnerType = z.infer<typeof OwnerType>;

/** meta.json — gross→net seam etc. */
export const Meta = z.object({
  seam_date: DateStr,
  backfilled_at: z.string(),
  schema_ver: z.number().int(),
  generated_at: z.string().optional(),
});
export type Meta = z.infer<typeof Meta>;

export const Window = z.enum(["week", "month", "year", "all"]);
export type Window = z.infer<typeof Window>;
export const Dim = z.enum(["repo", "org"]);
export type Dim = z.infer<typeof Dim>;
export const Metric = z.enum(["flow", "stock"]);
export type Metric = z.infer<typeof Metric>;

/** One ranking row. `id` for repo dim, `login` for org dim. value may be negative (net flow). */
export const RankItem = z.object({
  rank: z.number().int(),
  id: z.number().int().optional(),
  login: z.string().optional(),
  value: z.number().int(),
  prev_rank: z.number().int().nullable(),
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
