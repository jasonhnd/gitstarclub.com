import { fixtureRecords } from "../../scripts/fixture";
import { COMMON_COMPARE_PAIRS } from "../../../web/lib/compare/conclusions";
import { RepoEntity, ReposLookup, HotSnapshot, RankList, SearchIndex } from "../../../web/lib/contracts";

/** Synthetic rows only; both hosts receive exactly the same local records. */
export function p5Records() {
  const records = fixtureRecords();
  const put = (key: string, value: unknown) => {
    const body = JSON.stringify(value); records.set(key, body); records.set(`views/fixture-v1/${key}`, body);
  };
  const entity = JSON.parse(records.get("entity/repo/1.json")!);
  const names = COMMON_COMPARE_PAIRS.flatMap((pair) => [pair.a, pair.b]);
  const lookup: Record<string, unknown> = {};
  const search: unknown[] = [];
  const items = names.map((fullName, index) => {
    const id = index + 1;
    const [owner, name] = fullName.split("/");
    const current_stars = 30000 + index * 4000;
    const repo = RepoEntity.parse({ ...entity, id, full_name: fullName, owner, name, current_stars,
      milestones: { crossed_10k: "2024-01-01", crossed_50k: null, crossed_100k: null },
      curve: { monthly: [["2024-01", 10000, 10000], ["2024-02", 5000 + index * 1000, 15000 + index * 1000], ["2024-03", 15000 + index * 3000, current_stars]], recent_daily: [] },
    });
    put(`entity/repo/${id}.json`, repo);
    lookup[String(id)] = { full_name: fullName, owner, name, owner_type: "Organization", language: "TypeScript", current_stars };
    search.push({ id, full_name: fullName, owner, language: "TypeScript", current_stars, description: "Fixture repository" });
    return { rank: id, id, value: 1000 - index * 100, prev_rank: null };
  });
  put("lookup/repos.json", ReposLookup.parse(lookup));
  put("search/index.json", SearchIndex.parse({ generated_at: "2026-07-17T00:00:00.000Z", count: search.length, repos: search }));
  for (const [window, period] of [["year", "2026"], ["month", "2026-06"], ["month", "2026-07"], ["week", "2026-W26"]]) {
    put(`rank/${window}/${period}/repo/flow.json`, RankList.parse({ meta: { window, period, dim: "repo", metric: "flow", generated_at: "2026-07-17T00:00:00.000Z" }, items }));
  }
  const snap = JSON.parse(records.get("hot-snapshot.json")!);
  snap.current_year.flow = items;
  snap.all_time.repo = items;
  snap.home.year_spine = [["2026", 123456]];
  snap.home.on_this_day = [{ id: 1, crossed: "10k", date: "2024-01-01" }];
  put("hot-snapshot.json", HotSnapshot.parse(snap));
  return records;
}
