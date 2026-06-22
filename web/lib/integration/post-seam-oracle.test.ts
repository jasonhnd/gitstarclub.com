import { describe, expect, test } from "bun:test";
import { buildModel, type RawShards } from "../workflows/recompute/model";
import { computeAllViews } from "../workflows/recompute";

type RepoStockRank = {
  items: Array<{ id?: number; value: number }>;
};

type RepoEntityView = {
  curve: {
    monthly: Array<[string, number, number]>;
  };
};

describe("post-seam stock oracle", () => {
  test("uses round(cumGross at seam * d) plus post-seam net, independent of DuckDB parity", () => {
    const raw: RawShards = {
      repos: {
        "10": {
          id: 10,
          owner: "alpha",
          owner_type: "Organization",
          name: "one",
          full_name: "alpha/one",
          current_stars: 150,
          crossed_10k: "2026-05-15",
          d: 0.8,
        },
        "20": {
          id: 20,
          owner: "beta",
          owner_type: "Organization",
          name: "two",
          full_name: "beta/two",
          current_stars: 145,
          crossed_10k: "2026-05-20",
          d: 1,
        },
      },
      monthly: {
        "10": [
          ["2026-04", 100],
          ["2026-05", 50],
          ["2026-06", 30],
        ],
        "20": [
          ["2026-04", 65],
          ["2026-05", 60],
          ["2026-06", 20],
        ],
      },
      weekly: { "10": [], "20": [] },
      recentDaily: { "10": [], "20": [] },
      siteDailyByYear: {},
    };
    const model = buildModel(raw, "2026-05-30");
    const { views } = computeAllViews(model, {
      gen: "2026-06-30T00:00:00.000Z",
      seamDate: "2026-05-30",
      foldedThrough: { month: "2026-06", week: "2026-W26" },
    });

    const entity = views.get("entity/repo/10.json") as RepoEntityView;
    expect(entity.curve.monthly).toEqual([
      ["2026-04", 100, 80],
      ["2026-05", 50, 120],
      ["2026-06", 30, 150],
    ]);

    const juneStock = views.get("rank/month/2026-06/repo/stock.json") as RepoStockRank;
    const repo10 = juneStock.items.find((item) => item.id === 10);
    expect(repo10?.value).toBe(150);
    expect(repo10?.value).not.toBe(144);
  });
});
