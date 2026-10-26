import { p1FixtureRecords } from "./fixture";
import { CurrentMonth, Heatmap, Meta, RankList, ReposLookup } from "../../../web/lib/contracts";

export const observationCases = [
  { name: "partial series", month: "2026-07", week: "2026-W29", days: ["2026-07-17", "2026-07-15", "2026-07-16"], admission: "2026-07-14", expected: "2026-07-15" },
  { name: "series starts on the first day", month: "2026-07", week: "2026-W29", days: ["2026-07-01", "2026-07-13", "2026-07-17"], admission: "2026-07-14", expected: null },
  { name: "full later period with only a newcomer admission", month: "2026-08", week: "2026-W32", days: ["2026-08-01", "2026-08-03", "2026-08-10"], admission: "2026-08-06", expected: null },
  { name: "partial series with a null baseline", month: "2026-07", week: "2026-W29", days: ["2026-07-15", "2026-07-17"], admission: null, expected: "2026-07-15" },
  { name: "full series with a null baseline and newcomer", month: "2026-07", week: "2026-W29", days: ["2026-07-01", "2026-07-13", "2026-07-17"], admission: null, expected: null },
] as const;

/** Published synthetic daily data, deliberately independent of repo admissions and the seam. */
export function observationFixture(scenario: typeof observationCases[number], archived = false) {
  const records = p1FixtureRecords();
  const put = (key: string, value: unknown) => {
    const body = JSON.stringify(value);
    records.set(key, body);
    records.set(`views/fixture-v1/${key}`, body);
  };
  const updated = scenario.days.at(-1)!;
  const generated_at = `${updated}T00:00:00.000Z`;
  const lookup = JSON.parse(records.get("lookup/repos.json")!);
  lookup["1"].tracked_since = scenario.admission;
  if (scenario.admission === null) lookup["2"] = { ...lookup["1"], name: "newcomer", full_name: "example/newcomer", tracked_since: "2026-07-16" };
  put("lookup/repos.json", ReposLookup.parse(lookup));
  put("meta.json", Meta.parse({ ...JSON.parse(records.get("meta.json")!), seam_date: "2026-07-16", generated_at,
    folded_through: { month: scenario.month, week: scenario.week } }));
  const cells = scenario.days.map((day, index) => [day, index === 0 ? 0 : -1]);
  put("current_month.json", CurrentMonth.parse({ month: archived ? "2026-09" : scenario.month, updated: archived ? "2026-09-01" : updated,
    daily_totals: archived ? [["2026-09-01", 10]] : cells, per_repo: {}, current_stars: {} }));
  put(`heatmap/month/${scenario.month}.json`, Heatmap.parse({ meta: { scope: "month", period: scenario.month, generated_at }, cells }));
  for (const [window, period] of [["month", scenario.month], ["week", scenario.week]] as const) {
    for (const metric of window === "week" ? ["flow"] as const : ["flow", "growth", "new"] as const) {
      const original = JSON.parse(records.get(`rank/${window}/${window === "week" ? "2026-W29" : "2026-07"}/repo/${metric}.json`)!);
      put(`rank/${window}/${period}/repo/${metric}.json`, RankList.parse({ ...original, meta: { window, period, dim: "repo", metric, generated_at } }));
    }
  }
  return records;
}
