import { z } from "zod";
import { DateStr, NonNegativeInt, Period, OwnerType, SafeText, TimestampStr } from "./common";

// entity/repo/{id}.json, entity/org/{login}.json, heatmap/*.json.
// See docs/DATA-CONTRACTS.md §2.5–2.7.

/** [period, adds, total_end] — historical monthly point. */
export const MonthlyPoint = z.tuple([Period, z.number().int(), NonNegativeInt]);
/** [date, net_adds] — recent daily point (net may be negative). */
export const DailyPoint = z.tuple([DateStr, z.number().int()]);

export const Curve = z.object({
  monthly: z.array(MonthlyPoint),
  recent_daily: z.array(DailyPoint),
}).strict();
export type Curve = z.infer<typeof Curve>;

/** Optional rank history: { window: [[period, rank], ...] }. */
export const RankHistory = z.record(z.string(), z.array(z.tuple([Period, z.number().int()]))).optional();

/** A "when it broke out" marker on the star curve (recompute-derived; v0.2 §3). */
export const Inflection = z.object({
  period: Period,
  flow: z.number().int(),
  kind: z.enum(["surge", "peak"]),
}).strict();
export type Inflection = z.infer<typeof Inflection>;

export const HttpUrlString = z.union([
  z.literal(""),
  z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "must use http or https"),
]);

export const RepoEntity = z.object({
  id: NonNegativeInt,
  full_name: SafeText,
  owner: SafeText,
  owner_type: OwnerType,
  name: SafeText,
  description: SafeText.nullable(),
  language: SafeText.nullable(),
  languages: z
    .array(
      z.object({
        name: SafeText,
        size: NonNegativeInt,
        color: SafeText.nullable().optional(),
      }).strict(),
    )
    .optional(),
  topics: z.array(SafeText),
  homepage_url: HttpUrlString.nullable().optional(),
  license: SafeText.nullable().optional(),
  latest_release: z
    .object({
      name: SafeText.nullable().optional(),
      tag_name: SafeText,
      published_at: DateStr.nullable().optional(),
      url: HttpUrlString.nullable().optional(),
    })
    .strict()
    .nullable()
    .optional(),
  created_at: DateStr,
  current_stars: NonNegativeInt,
  is_archived: z.boolean(),
  milestones: z.object({
    crossed_10k: DateStr.nullable(),
    crossed_50k: DateStr.nullable(),
    crossed_100k: DateStr.nullable(),
  }).strict(),
  curve: Curve,
  monthly_table: z.array(
    z.object({
      month: Period,
      adds: z.number().int(),
      rank: NonNegativeInt.nullable(),
    }).strict(),
  ),
  rank_history: RankHistory,
  inflections: z.array(Inflection).optional(),
}).strict();
export type RepoEntity = z.infer<typeof RepoEntity>;

export const OrgEntity = z.object({
  login: SafeText,
  owner_type: OwnerType,
  current_stars_sum: NonNegativeInt,
  repo_count: NonNegativeInt,
  members: z.array(NonNegativeInt),
  curve: Curve,
  rank_history: RankHistory,
}).strict();
export type OrgEntity = z.infer<typeof OrgEntity>;

/** heatmap/{year|month}/{period}.json — cells [date|month, total_adds]. */
export const Heatmap = z.object({
  meta: z.object({
    scope: z.enum(["year", "month"]),
    period: Period,
    generated_at: TimestampStr,
  }).strict(),
  cells: z.array(z.tuple([z.string(), z.number().int()])),
}).strict();
export type Heatmap = z.infer<typeof Heatmap>;
