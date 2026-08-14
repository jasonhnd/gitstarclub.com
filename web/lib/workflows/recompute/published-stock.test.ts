import { describe, expect, test } from "bun:test";
import { computePublishedStockViews } from "./index";
import { buildModel, type RawShards } from "./model";
import { validateAllTimeRanks } from "@/lib/workflows/steps/validate-invariants";
import type { OrgsLookup, RankList, ReposLookup } from "@/lib/contracts";

const GEN = "2026-08-14T00:00:00.000Z";

function modelWithStars(repoStars: number, otherStars: number) {
  return buildModel(
    {
      repos: {
        "1": {
          id: 1,
          owner: "alpha",
          owner_type: "Organization",
          name: "one",
          full_name: "alpha/one",
          current_stars: repoStars,
          active: true,
          d: 1,
        },
        "2": {
          id: 2,
          owner: "beta",
          owner_type: "User",
          name: "two",
          full_name: "beta/two",
          current_stars: otherStars,
          active: true,
          d: 1,
        },
      },
      monthly: { "1": [], "2": [] },
      weekly: { "1": [], "2": [] },
      recentDaily: {},
      siteDailyByYear: {},
    } as unknown as RawShards,
    "2026-05-30",
  );
}

describe("computePublishedStockViews", () => {
  test("all-time ranks and lookup share the same current_stars snapshot", () => {
    const views = computePublishedStockViews(modelWithStars(453333, 12000), GEN);
    const allTime = views.get("rank/all-time/repo/stock.json") as RankList;
    const allTimeOrg = views.get("rank/all-time/org/stock.json") as RankList;
    const lookup = views.get("lookup/repos.json") as ReposLookup;
    const orgLookup = views.get("lookup/orgs.json") as OrgsLookup;

    expect(validateAllTimeRanks({ allTime, allTimeOrg, lookup, orgLookup, minLookup: 2 }).failures).toEqual([]);
    expect(allTime.items[0]).toMatchObject({ id: 1, value: 453333 });
    expect(lookup["1"].current_stars).toBe(453333);
    expect(allTimeOrg.items[0]).toMatchObject({ login: "alpha", value: 453333 });
    expect(orgLookup.alpha.current_stars_sum).toBe(453333);
  });

  test("a later model with drifted stars still agrees with itself", () => {
    const earlier = computePublishedStockViews(modelWithStars(452060, 12000), GEN);
    const later = computePublishedStockViews(modelWithStars(453333, 12000), GEN);
    const mixed = validateAllTimeRanks({
      allTime: earlier.get("rank/all-time/repo/stock.json") as RankList,
      allTimeOrg: earlier.get("rank/all-time/org/stock.json") as RankList,
      lookup: later.get("lookup/repos.json") as ReposLookup,
      orgLookup: later.get("lookup/orgs.json") as OrgsLookup,
      minLookup: 2,
    });
    expect(mixed.failures).toEqual([
      "all-time/repo: 1 item(s) differ from lookup current_stars",
      "all-time/org: 1 item(s) differ from lookup current_stars_sum",
    ]);
    expect(
      validateAllTimeRanks({
        allTime: later.get("rank/all-time/repo/stock.json") as RankList,
        allTimeOrg: later.get("rank/all-time/org/stock.json") as RankList,
        lookup: later.get("lookup/repos.json") as ReposLookup,
        orgLookup: later.get("lookup/orgs.json") as OrgsLookup,
        minLookup: 2,
      }).failures,
    ).toEqual([]);
  });
});
