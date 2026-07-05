import { z } from "zod";

// Shared primitives + ranking shapes. See docs/DATA-CONTRACTS.md.
// Dates are UTC.

/** ISO 'YYYY-MM-DD' (UTC). */
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidDate, "must be a valid UTC calendar date");
/** ISO timestamp with timezone offset, e.g. Date#toISOString(). */
export const TimestampStr = z.string().datetime({ offset: true });
/** Month period id: 'YYYY-MM'. */
export const MonthPeriod = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
/** ISO week period id: 'YYYY-Www'. */
export const WeekPeriod = z.string().regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/).refine(isValidIsoWeek, "must be a valid ISO week");
/** Year period id: 'YYYY'. */
export const YearPeriod = z.string().regex(/^\d{4}$/);
/** Period id: week 'YYYY-Www' | month 'YYYY-MM' | year 'YYYY' | 'all'. */
export const Period = z.union([WeekPeriod, MonthPeriod, YearPeriod, z.literal("all")]);
export const HttpUrlString = z.union([
  z.string().url().refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "must use http or https"),
  z.literal(""),
]);
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
  folded_through: z.object({ month: MonthPeriod, week: WeekPeriod }).strict().optional(), // live-overlay watermark
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

function isValidDate(value: string): boolean {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

function isValidIsoWeek(value: string): boolean {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= isoWeeksInYear(year);
}

function isoWeeksInYear(year: number): number {
  return isoWeekNumber(new Date(Date.UTC(year, 11, 28)));
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
