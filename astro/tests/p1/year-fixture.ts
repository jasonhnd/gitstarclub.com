import { p1FixtureRecords } from "./fixture";

/** Keep fragments in the snapshot to prove presentation alone suppresses them. */
export function homeYearFixture(state: "fallback" | "unavailable" | "populated") {
  const records = p1FixtureRecords();
  for (const [key, body] of records) {
    if (state === "fallback" && key.includes("rank/year/")) records.delete(key);
    if (key.endsWith("hot-snapshot.json")) {
      const snap = JSON.parse(body);
      snap.current_year.flow = [{ rank: 1, id: 1, value: 1782, prev_rank: null }];
      snap.freshness = { current_month: null, year_spine: null, on_this_day: null, all_time: snap.generated_at, current_year: state === "populated" ? snap.generated_at : null };
      records.set(key, JSON.stringify(snap));
    }
    // The same-sized monthly gain remains valid even without annual coverage.
    if (key.includes("rank/month/") && key.endsWith("/repo/flow.json")) {
      const rank = JSON.parse(body);
      rank.items[0].value = 1782;
      records.set(key, JSON.stringify(rank));
    }
  }
  return records;
}
