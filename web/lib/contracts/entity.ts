import { z } from "zod";
import { DateStr, Period, OwnerType } from "./common";

// entity/repo/{id}.json, entity/org/{login}.json, heatmap/*.json.
// See docs/DATA-CONTRACTS.md §2.5–2.7.

/** [period, adds, total_end] — historical monthly point. */
export const MonthlyPoint = z.tuple([Period, z.number().int(), z.number().int()]);
/** [date, net_adds] — recent daily point (net may be negative). */
export const DailyPoint = z.tuple([DateStr, z.number().int()]);

export const Curve = z.object({
  monthly: z.array(MonthlyPoint),
  recent_daily: z.array(DailyPoint),
});
export type Curve = z.infer<typeof Curve>;

/** Optional rank history: { window: [[period, rank], ...] }. */
export const RankHistory = z.record(z.string(), z.array(z.tuple([Period, z.number().int()]))).optional();

export const RepoEntity = z.object({
  id: z.number().int(),
  full_name: z.string(),
  owner: z.string(),
  owner_type: OwnerType,
  name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  topics: z.array(z.string()),
  homepage_url: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  latest_release: z
    .object({
      name: z.string().nullable().optional(),
      tag_name: z.string(),
      published_at: DateStr.nullable().optional(),
      url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  created_at: DateStr,
  current_stars: z.number().int(),
  is_archived: z.boolean(),
  milestones: z.object({
    crossed_10k: DateStr.nullable(),
    crossed_50k: DateStr.nullable(),
    crossed_100k: DateStr.nullable(),
  }),
  curve: Curve,
  monthly_table: z.array(
    z.object({
      month: Period,
      adds: z.number().int(),
      rank: z.number().int().nullable(),
    }),
  ),
  rank_history: RankHistory,
});
export type RepoEntity = z.infer<typeof RepoEntity>;

export const OrgEntity = z.object({
  login: z.string(),
  owner_type: OwnerType,
  current_stars_sum: z.number().int(),
  repo_count: z.number().int(),
  members: z.array(z.number().int()),
  curve: Curve,
  rank_history: RankHistory,
});
export type OrgEntity = z.infer<typeof OrgEntity>;

/** heatmap/{year|month}/{period}.json — cells [date|month, total_adds]. */
export const Heatmap = z.object({
  meta: z.object({
    scope: z.enum(["year", "month"]),
    period: Period,
    generated_at: z.string(),
  }),
  cells: z.array(z.tuple([z.string(), z.number().int()])),
});
export type Heatmap = z.infer<typeof Heatmap>;
