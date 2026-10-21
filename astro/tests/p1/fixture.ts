import { fixtureRecords } from "../../scripts/fixture";
import { HotSnapshot, RankList, StarHistoryProvenance } from "../../../web/lib/contracts";

/** Populate only the existing synthetic example repository; never extend real coverage. */
export function p1FixtureRecords() {
  const records = fixtureRecords();
  const set = (key: string, value: unknown) => {
    const body = JSON.stringify(value);
    records.set(key, body); records.set(`views/fixture-v1/${key}`, body);
  };
  const item = { rank: 1, id: 1, value: 10, prev_rank: null };
  const provenance = StarHistoryProvenance.parse({ source: "github_stargazers_history_aggregate", api_version: "2026-03-10",
    metric: "surviving_stars_at_query_time", day_boundary: "github_calendar_label_approximate_not_guaranteed_utc", day_shift: 0,
    week_calendar: "iso_monday_sunday_reaggregated_from_daily", monthly_policy: "preserve_published_net_do_not_fold_these_daily_values_into_months",
    start: "2026-05-30", end_inclusive: "2026-09-30" });
  for (const [window, period] of [["year", "2026"], ["month", "2026-07"], ["week", "2026-W29"]] as const) {
    for (const metric of window === "week" ? ["flow"] as const : ["flow", "growth", "new"] as const) {
      set(`rank/${window}/${period}/repo/${metric}.json`, RankList.parse({
        meta: { window, period, dim: "repo", metric, generated_at: "2026-07-17T00:00:00.000Z", ...(window === "week" ? { provenance } : {}) },
        items: [{ ...item, ...(metric === "growth" ? { rate: 10 } : {}), ...(metric === "new" ? { date: "2026-07-17" } : {}) }],
      }));
    }
  }
  for (const dim of ["repo", "org"] as const) set(`rank/all-time/${dim}/stock.json`, RankList.parse({
    meta: { window: "all", period: "all", dim, metric: "stock", generated_at: "2026-07-17T00:00:00.000Z" },
    items: [dim === "repo" ? { ...item, value: 100 } : { rank: 1, login: "example", value: 100, prev_rank: null }],
  }));
  const snap = JSON.parse(records.get("hot-snapshot.json")!);
  snap.home.year_spine = [["2026", 10]];
  snap.current_year.flow = [item];
  snap.all_time.repo = [{ ...item, value: 100 }];
  snap.all_time.org = [{ rank: 1, login: "example", value: 100, prev_rank: null }];
  snap.home.on_this_day = [{ id: 1, crossed: "100", date: "2026-07-17" }];
  set("hot-snapshot.json", HotSnapshot.parse(snap));
  const meta = JSON.parse(records.get("meta.json")!);
  meta.folded_through = { month: "2026-07", week: "2026-W29" };
  set("meta.json", meta);
  return records;
}
