import { z } from "zod";
import { DateStr, MonthPeriod, NonNegativeInt, RankItem, TimestampStr, YearPeriod } from "./common";

// Live tail + hot snapshot, written daily by cron. See docs/DATA-CONTRACTS.md §2.8–2.9.

/** current_month.json — in-progress month, append-only by UTC day. */
export const CurrentMonth = z.object({
  month: MonthPeriod,
  updated: DateStr,
  daily_totals: z.array(z.tuple([DateStr, z.number().int()])),
  per_repo: z.record(z.string(), z.array(z.tuple([DateStr, z.number().int()]))),
  current_stars: z.record(z.string(), NonNegativeInt),
}).strict();
export type CurrentMonth = z.infer<typeof CurrentMonth>;

const TopLists = z.object({
  flow: z.array(RankItem),
  stock: z.array(RankItem),
}).strict();

/** hot-snapshot.json — read by hot ISR pages (home/current periods/all-time).
 *  Provisional shape; refine when building the daily cron (M4). */
export const HotSnapshot = z.object({
  generated_at: TimestampStr,
  home: z.object({
    year_spine: z.array(z.tuple([YearPeriod, z.number().int()])),
    current_month_top: TopLists,
    on_this_day: z.array(
      z.object({ id: NonNegativeInt, crossed: z.string(), date: DateStr }).strict(),
    ),
  }).strict(),
  current_year: TopLists,
  current_month: TopLists,
  all_time: z.object({ repo: z.array(RankItem), org: z.array(RankItem) }),
}).strict();
export type HotSnapshot = z.infer<typeof HotSnapshot>;
