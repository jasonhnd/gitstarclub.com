import { z } from "zod";

// Shared primitives + ranking shapes. See docs/DATA-CONTRACTS.md.
// Dates are UTC.

/** ISO 'YYYY-MM-DD' (UTC). */
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** ISO timestamp with timezone offset, e.g. Date#toISOString(). */
export const TimestampStr = z.string().datetime({ offset: true });
/** Period id: week 'YYYY-Www' | month 'YYYY-MM' | year 'YYYY' | 'all'. */
export const Period = z.string().regex(/^(?:\d{4}-W\d{2}|\d{4}-\d{2}|\d{4}|all)$/);
export const NonNegativeInt = z.number().int().nonnegative();
export const PositiveRank = z.number().int().positive();
export const SafeText = z
  .string()
  .max(4096)
  .refine(
    (value) => !/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|style)\b/i.test(value),
    "must not contain active HTML tags",
  )
  .refine((value) => !/\bon[a-z]+\s*=/i.test(value), "must not contain inline event handlers")
  .refine((value) => !/javascript:/i.test(value), "must not contain javascript: URLs");

export const OwnerType = z.enum(["User", "Organization"]);
export type OwnerType = z.infer<typeof OwnerType>;

/** meta.json — gross→net seam + period fold watermark. Accepts the flat bootstrap meta
 *  (backfilled_at, no folded_through) and the Phase 4 versioned meta (folded_through). */
export const Meta = z.object({
  seam_date: DateStr,
  schema_ver: NonNegativeInt,
  generated_at: TimestampStr.optional(),
  backfilled_at: TimestampStr.optional(), // bootstrap-only
  folded_through: z.object({ month: Period, week: Period }).strict().optional(), // live-overlay watermark
}).strict();
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
export const RankItem = z
  .object({
    rank: PositiveRank,
    id: NonNegativeInt.optional(),
    login: SafeText.optional(),
    value: z.number().int(),
    prev_rank: PositiveRank.nullable(),
    rate: z.number().optional(),
    base: NonNegativeInt.optional(),
    date: DateStr.optional(),
  })
  .strict()
  .refine((item) => (item.id == null) !== (item.login == null), "exactly one of id or login is required");
export type RankItem = z.infer<typeof RankItem>;

/** rank/{window}/{period}/{dim}/{metric}.json */
export const RankList = z
  .object({
    meta: z
      .object({
        window: Window,
        period: Period,
        dim: Dim,
        metric: Metric,
        generated_at: TimestampStr,
      })
      .strict(),
    items: z.array(RankItem),
  })
  .strict()
  .superRefine((list, ctx) => {
    for (let i = 0; i < list.items.length; i++) {
      const item = list.items[i];
      if (list.meta.dim === "repo" && item.id == null) {
        ctx.addIssue({ code: "custom", path: ["items", i], message: "repo rank items require id" });
      }
      if (list.meta.dim === "org" && item.login == null) {
        ctx.addIssue({ code: "custom", path: ["items", i], message: "org rank items require login" });
      }
    }
  });
export type RankList = z.infer<typeof RankList>;
