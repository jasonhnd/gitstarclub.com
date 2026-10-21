import { z } from "zod";

/** GSC_0090 inputs/manifest.json provenance; applies only to daily/weekly values. */
export const StarHistoryProvenance = z.object({
  source: z.literal("github_stargazers_history_aggregate"),
  api_version: z.literal("2026-03-10"),
  metric: z.literal("surviving_stars_at_query_time"),
  day_boundary: z.literal("github_calendar_label_approximate_not_guaranteed_utc"),
  day_shift: z.literal(0),
  week_calendar: z.literal("iso_monday_sunday_reaggregated_from_daily"),
  monthly_policy: z.literal("preserve_published_net_do_not_fold_these_daily_values_into_months"),
  start: z.literal("2026-05-30"),
  end_inclusive: z.literal("2026-09-30"),
}).strict();
export type StarHistoryProvenance = z.infer<typeof StarHistoryProvenance>;

export const AGGREGATE_HISTORY_PROVENANCE: StarHistoryProvenance = {
  source: "github_stargazers_history_aggregate",
  api_version: "2026-03-10",
  metric: "surviving_stars_at_query_time",
  day_boundary: "github_calendar_label_approximate_not_guaranteed_utc",
  day_shift: 0,
  week_calendar: "iso_monday_sunday_reaggregated_from_daily",
  monthly_policy: "preserve_published_net_do_not_fold_these_daily_values_into_months",
  start: "2026-05-30",
  end_inclusive: "2026-09-30",
};

/** Only imported weeks lack a historical stock; existing weekly observations retain theirs. */
export const AggregateHistory = z.object({
  provenance: StarHistoryProvenance,
  weeks: z.array(z.string().regex(/^2026-W(2[2-9]|3\d|40)$/)),
}).strict();
export type AggregateHistory = z.infer<typeof AggregateHistory>;
