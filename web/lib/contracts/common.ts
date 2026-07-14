import { z } from "zod";

// Shared primitives + ranking shapes. See docs/DATA-CONTRACTS.md.
// Dates are UTC.

function isValidUtcDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function weeksInIsoYear(year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const dec31 = new Date(Date.UTC(year, 11, 31)).getUTCDay();
  return jan1 === 4 || dec31 === 4 ? 53 : 52;
}

/** ISO 'YYYY-MM-DD' (UTC). */
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidUtcDate, "must be a real UTC date");
/** ISO timestamp with timezone offset, e.g. Date#toISOString(). */
export const TimestampStr = z.string().datetime({ offset: true });
/** Month period id: 'YYYY-MM'. */
export const MonthPeriod = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
/** ISO week period id: 'YYYY-Www'. */
export const WeekPeriod = z.string().regex(/^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/).refine((value) => {
  const [, year, week] = /^(\d{4})-W(\d{2})$/.exec(value) ?? [];
  return Number(week) <= weeksInIsoYear(Number(year));
}, "must be a real ISO week");
/** Year period id: 'YYYY'. */
export const YearPeriod = z.string().regex(/^\d{4}$/);
/** Period id: week 'YYYY-Www' | month 'YYYY-MM' | year 'YYYY' | 'all'. */
export const Period = z.union([WeekPeriod, MonthPeriod, YearPeriod, z.literal("all")]);
export const NonNegativeInt = z.number().int().nonnegative();
export const PositiveRank = z.number().int().positive();
/** Shared cap for free-text fields stored in JSON shards and view contracts. */
export const SAFE_TEXT_MAX = 4096;

/** Truncate free text to SafeText's max length (legacy / untrusted sources). */
export function capSafeText(value: string, max = SAFE_TEXT_MAX): string {
  return value.length <= max ? value : value.slice(0, max);
}

export const SafeText = z
  .string()
  .max(SAFE_TEXT_MAX)
  .refine(
    (value) => !/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|style)\b/i.test(value),
    "must not contain active HTML tags",
  )
  .refine((value) => !/\bon[a-z]+\s*=/i.test(value), "must not contain inline event handlers")
  .refine((value) => !/javascript:/i.test(value), "must not contain javascript: URLs");

/**
 * Like SafeText, but silently truncates oversized input before validation.
 * Use on read paths that must tolerate historical blobs (e.g. multi-KB GitHub descriptions).
 */
export const TruncatingSafeText = z.preprocess(
  (value) => (typeof value === "string" ? capSafeText(value) : value),
  SafeText,
);

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
