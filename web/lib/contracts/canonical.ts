import { z } from "zod";
import { DateStr, OwnerType, Period } from "./common";

// canonical/v2/* — production canonical JSON shards that replace the bootstrap
// star_daily.parquet as the production source of truth. See docs/DATA-CONTRACTS.md
// §1.4 and docs/VERCEL-DATA-OPERATIONS.md §5. <bucket> = repo_id % N.

/** canonical/v2/meta.json — stock-anchoring seam + period fold watermarks. */
export const CanonicalMeta = z.object({
  seam_date: DateStr,
  schema_ver: z.number().int(),
  folded_through: z.object({
    month: Period,
    week: Period,
  }),
});
export type CanonicalMeta = z.infer<typeof CanonicalMeta>;

/** One repo's dimension row in canonical/v2/repos/<bucket>.json.
 *  `d` = frozen discount (current_stars@seam / cumgross@seam_date), bootstrap-fixed. */
export const ReposShardEntry = z.object({
  id: z.number().int(),
  node_id: z.string(),
  owner: z.string(),
  owner_type: OwnerType,
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  languages: z
    .array(
      z.object({
        name: z.string(),
        size: z.number().int().nonnegative(),
        color: z.string().nullable().optional(),
      }),
    )
    .optional(),
  topics: z.array(z.string()).optional(),
  created_at: z.string().optional(),
  current_stars: z.number().int(),
  is_archived: z.boolean().optional(),
  crossed_10k: z.string().nullable().optional(),
  crossed_50k: z.string().nullable().optional(),
  crossed_100k: z.string().nullable().optional(),
  tracked_since: z.string().nullable().optional(),
  d: z.number().optional(),
  fetched_at: z.string().optional(),
});
export type ReposShardEntry = z.infer<typeof ReposShardEntry>;

/** canonical/v2/repos/<bucket>.json — keyed by repo id (stringified). */
export const ReposShard = z.record(z.string(), ReposShardEntry);
export type ReposShard = z.infer<typeof ReposShard>;

/** [period, flow] series per repo (seam-前 gross / 后 net). */
const PeriodSeries = z.array(z.tuple([Period, z.number().int()]));
/** canonical/v2/repo-monthly/<bucket>.json — { "<id>": [[month, flow], ...] }. */
export const RepoMonthlyShard = z.record(z.string(), PeriodSeries);
export type RepoMonthlyShard = z.infer<typeof RepoMonthlyShard>;
/** canonical/v2/repo-weekly/<bucket>.json — { "<id>": [["YYYY-Www", flow], ...] }. */
export const RepoWeeklyShard = z.record(z.string(), PeriodSeries);
export type RepoWeeklyShard = z.infer<typeof RepoWeeklyShard>;

/** [date, net_delta] recent daily tail per repo (≤~90d, can be negative). */
const DailySeries = z.array(z.tuple([DateStr, z.number().int()]));
/** canonical/v2/repo-recent-daily/<bucket>.json. */
export const RepoRecentDailyShard = z.record(z.string(), DailySeries);
export type RepoRecentDailyShard = z.infer<typeof RepoRecentDailyShard>;

/** canonical/v2/site-daily/<yyyy>.json — site-wide daily totals (heatmap source). */
export const SiteDaily = z.object({
  year: z.string(),
  cells: z.array(z.tuple([DateStr, z.number().int()])),
});
export type SiteDaily = z.infer<typeof SiteDaily>;

/** One whitelist row (GitHub Search `stars:>=10000`). */
export const WhitelistEntry = z.object({
  id: z.number().int(),
  node_id: z.string(),
  full_name: z.string(),
  owner: z.string(),
  name: z.string(),
  stars: z.number().int(),
});
export type WhitelistEntry = z.infer<typeof WhitelistEntry>;

/** canonical/v2/whitelist/<run_id>.json — snapshot + diff vs the previous run. */
export const WhitelistSnapshot = z.object({
  run_id: z.string(),
  generated_at: z.string(),
  count: z.number().int(),
  entries: z.array(WhitelistEntry),
  diff: z.object({
    added: z.array(z.number().int()), // new repo ids (newcomers)
    dropped: z.array(z.number().int()), // ids no longer ≥10k
  }),
});
export type WhitelistSnapshot = z.infer<typeof WhitelistSnapshot>;

/** canonical/v2/pending/<period>.json — frozen closed-period live tail awaiting fold (§8.3). */
export const PendingPeriod = z.object({
  period: Period,
  frozen_at: z.string(),
  daily_totals: z.array(z.tuple([DateStr, z.number().int()])),
  per_repo: z.record(z.string(), DailySeries),
});
export type PendingPeriod = z.infer<typeof PendingPeriod>;
