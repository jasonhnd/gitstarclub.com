import { z } from "zod";
import { DateStr, MonthPeriod, NonNegativeInt, OwnerType, SafeText, TimestampStr, WeekPeriod, YearPeriod } from "./common";

// canonical/v2/* — production canonical JSON shards that replace the bootstrap
// star_daily.parquet as the production source of truth. See docs/DATA-CONTRACTS.md
// §1.4 and docs/VERCEL-DATA-OPERATIONS.md §5. <bucket> = repo_id % N.

/** canonical/v2/meta.json — stock-anchoring seam + period fold watermarks. */
export const CanonicalMeta = z.object({
  seam_date: DateStr,
  schema_ver: NonNegativeInt,
  folded_through: z.object({
    month: MonthPeriod,
    week: WeekPeriod,
  }).strict(),
}).strict();
export type CanonicalMeta = z.infer<typeof CanonicalMeta>;

/** One repo's dimension row in canonical/v2/repos/<bucket>.json.
 *  `d` = frozen anchoring factor (current_stars@seam / cumgross@seam_date), bootstrap-fixed. */
export const ReposShardEntry = z.object({
  id: NonNegativeInt,
  node_id: SafeText,
  owner: SafeText,
  owner_type: OwnerType,
  name: SafeText,
  full_name: SafeText,
  description: SafeText.nullable().optional(),
  language: SafeText.nullable().optional(),
  languages: z
    .array(
      z.object({
        name: SafeText,
        size: NonNegativeInt,
        color: SafeText.nullable().optional(),
      }).strict(),
    )
    .optional(),
  topics: z.array(SafeText).optional(),
  created_at: DateStr.optional(),
  current_stars: NonNegativeInt,
  is_archived: z.boolean().optional(),
  crossed_10k: DateStr.nullable().optional(),
  crossed_50k: DateStr.nullable().optional(),
  crossed_100k: DateStr.nullable().optional(),
  tracked_since: DateStr.nullable().optional(),
  d: z.number().nonnegative().optional(),
  fetched_at: TimestampStr.optional(),
}).strict();
export type ReposShardEntry = z.infer<typeof ReposShardEntry>;

/** canonical/v2/repos/<bucket>.json — keyed by repo id (stringified). */
export const ReposShard = z.record(z.string(), ReposShardEntry);
export type ReposShard = z.infer<typeof ReposShard>;

/** [period, flow] series per repo (seam-前 gross / 后 net). */
const MonthlyPeriodSeries = z.array(z.tuple([MonthPeriod, z.number().int()]));
const WeeklyPeriodSeries = z.array(z.tuple([WeekPeriod, z.number().int()]));
/** canonical/v2/repo-monthly/<bucket>.json — { "<id>": [[month, flow], ...] }. */
export const RepoMonthlyShard = z.record(z.string(), MonthlyPeriodSeries);
export type RepoMonthlyShard = z.infer<typeof RepoMonthlyShard>;
/** canonical/v2/repo-weekly/<bucket>.json — { "<id>": [["YYYY-Www", flow], ...] }. */
export const RepoWeeklyShard = z.record(z.string(), WeeklyPeriodSeries);
export type RepoWeeklyShard = z.infer<typeof RepoWeeklyShard>;

/** [date, net_delta] recent daily tail per repo (≤~90d, can be negative). */
const DailySeries = z.array(z.tuple([DateStr, z.number().int()]));
/** canonical/v2/repo-recent-daily/<bucket>.json. */
export const RepoRecentDailyShard = z.record(z.string(), DailySeries);
export type RepoRecentDailyShard = z.infer<typeof RepoRecentDailyShard>;

/** canonical/v2/site-daily/<yyyy>.json — site-wide daily totals (heatmap source). */
export const SiteDaily = z.object({
  year: YearPeriod,
  cells: z.array(z.tuple([DateStr, z.number().int()])),
}).strict();
export type SiteDaily = z.infer<typeof SiteDaily>;

/** One whitelist row (GitHub Search `stars:>=10000`). */
export const WhitelistEntry = z.object({
  id: NonNegativeInt,
  node_id: SafeText,
  full_name: SafeText,
  owner: SafeText,
  name: SafeText,
  stars: NonNegativeInt,
}).strict();
export type WhitelistEntry = z.infer<typeof WhitelistEntry>;

/** canonical/v2/whitelist/<run_id>.json — snapshot + diff vs the previous run. */
export const WhitelistSnapshot = z.object({
  run_id: SafeText,
  generated_at: TimestampStr,
  count: NonNegativeInt,
  entries: z.array(WhitelistEntry),
  diff: z.object({
    added: z.array(NonNegativeInt), // new repo ids (newcomers)
    dropped: z.array(NonNegativeInt), // ids no longer >=10k
  }).strict(),
}).strict().refine((snapshot) => snapshot.count === snapshot.entries.length, "count must match entries length");
export type WhitelistSnapshot = z.infer<typeof WhitelistSnapshot>;

/** canonical/v2/pending/<period>.json — frozen closed-period live tail awaiting fold (VERCEL-DATA-OPERATIONS §7.2). */
export const PendingPeriod = z.object({
  period: MonthPeriod,
  frozen_at: TimestampStr,
  daily_totals: z.array(z.tuple([DateStr, z.number().int()])),
  per_repo: z.record(z.string(), DailySeries),
}).strict();
export type PendingPeriod = z.infer<typeof PendingPeriod>;
