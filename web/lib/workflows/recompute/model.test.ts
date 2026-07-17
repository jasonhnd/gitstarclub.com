// Unit tests for the pure recompute Model builder + seam-period derivation (model.ts).
// No I/O: all inputs are synthetic RawShards records. Mirrors scripts/test-seam-fold.ts.
import { test, expect, describe } from "bun:test";
import { buildModel, seamPeriods, byPeriod, type RawShards } from "./model";

describe("seamPeriods", () => {
  test("returns the month/week of (seam_date − 1 day)", () => {
    // seam_date 2026-05-30 → last gross day 2026-05-29 (Friday)
    expect(seamPeriods("2026-05-30")).toEqual({ month: "2026-05", week: "2026-W22" });
  });

  test("month-boundary seam_date rolls back into the previous month", () => {
    // seam_date 2026-06-01 → last gross day 2026-05-31 (Sunday, still ISO 2026-W22)
    expect(seamPeriods("2026-06-01")).toEqual({ month: "2026-05", week: "2026-W22" });
  });

  test("empty seam_date treats everything as gross (sentinel far-future periods)", () => {
    expect(seamPeriods("")).toEqual({ month: "9999-12", week: "9999-W99" });
  });
});

describe("byPeriod", () => {
  test("orders ISO period strings lexically = chronologically", () => {
    expect(byPeriod("2026-04", "2026-05")).toBe(-1);
    expect(byPeriod("2026-05", "2026-04")).toBe(1);
    expect(byPeriod("2026-W22", "2026-W22")).toBe(0);
    // lexical sort of a mixed list is chronological for same-granularity periods
    const sorted = ["2026-W22", "2026-W02", "2026-W09"].sort(byPeriod);
    expect(sorted).toEqual(["2026-W02", "2026-W09", "2026-W22"]);
  });
});

/** Two repos under owner "alpha" + one under "beta"; ids deliberately out of order. */
function rawFixture(): RawShards {
  return {
    repos: {
      "30": { id: 30, owner: "alpha", owner_type: "Organization", name: "two", full_name: "alpha/two", current_stars: 200, d: 0.8 },
      "10": { id: 10, owner: "alpha", owner_type: "Organization", name: "one", full_name: "alpha/one", current_stars: 100, d: 0.9 },
      "20": { id: 20, owner: "beta", owner_type: "User", name: "solo", full_name: "beta/solo", current_stars: 50, d: 1 },
    },
    monthly: {
      "10": [["2026-04", 10], ["2026-05", 5]],
      "20": [["2026-05", 3]],
      "30": [["2026-04", 7]],
    },
    weekly: {
      "10": [["2026-W18", 4]],
      "20": [],
      "30": [["2026-W18", 2]],
    },
    recentDaily: {
      "10": [["2026-05-01", 1], ["2026-05-02", 2]],
      "20": [["2026-05-02", 1]],
      "30": [],
    },
    siteDailyByYear: {
      "2026": { year: "2026", cells: [["2026-05-02", 4], ["2026-05-01", 1]] },
      "2025": { year: "2025", cells: [["2025-12-31", 9]] },
    },
  } as unknown as RawShards;
}

describe("buildModel", () => {
  const seamDate = "2026-05-30";
  const model = buildModel(rawFixture(), seamDate);

  test("repos / series maps are keyed by numeric repo id", () => {
    expect(model.repos.get(10)?.full_name).toBe("alpha/one");
    expect(model.monthly.get(10)).toEqual([["2026-04", 10], ["2026-05", 5]]);
    expect(model.weekly.get(30)).toEqual([["2026-W18", 2]]);
    expect(model.recentDaily.get(10)).toEqual([["2026-05-01", 1], ["2026-05-02", 2]]);
    // keys are real numbers, not strings
    expect([...model.repos.keys()].every((k) => typeof k === "number")).toBe(true);
  });

  test("ids are ascending", () => {
    expect(model.ids).toEqual([10, 20, 30]);
  });

  test("siteDaily concatenates all year shards and sorts by date ascending", () => {
    expect(model.siteDaily).toEqual([
      ["2025-12-31", 9],
      ["2026-05-01", 1],
      ["2026-05-02", 4],
    ]);
  });

  test("org aggregate sums current_stars per owner with members + repo_count", () => {
    const alpha = model.orgs.get("alpha")!;
    expect(alpha.login).toBe("alpha");
    expect(alpha.owner_type).toBe("Organization");
    expect(alpha.repo_count).toBe(2);
    expect(alpha.current_stars_sum).toBe(300); // 100 + 200
    expect([...alpha.members].sort((a, b) => a - b)).toEqual([10, 30]);

    const beta = model.orgs.get("beta")!;
    expect(beta.repo_count).toBe(1);
    expect(beta.current_stars_sum).toBe(50);
    expect(beta.members).toEqual([20]);
    expect(model.orgs.size).toBe(2);
  });

  test("model.seam is derived from seamDate via seamPeriods", () => {
    expect(model.seam).toEqual(seamPeriods(seamDate));
    expect(model.seam).toEqual({ month: "2026-05", week: "2026-W22" });
  });

  test("fails before recompute when a historical repository has no finite d", () => {
    const raw = rawFixture();
    delete (raw.repos["10"] as { d?: number }).d;
    expect(() => buildModel(raw, seamDate)).toThrow("historical repo 10 is missing a finite anchoring factor d");
  });

  test.each([NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "fails before recompute when a historical repository has non-finite d=%p",
    (d) => {
      const raw = rawFixture();
      (raw.repos["10"] as { d?: number }).d = d;
      expect(() => buildModel(raw, seamDate)).toThrow("historical repo 10 is missing a finite anchoring factor d");
    },
  );

  test("models a newcomer without historical anchoring as explicit d=0", () => {
    const raw = rawFixture();
    const newcomer = raw.repos["10"] as { d?: number; tracked_since?: string | null };
    delete newcomer.d;
    newcomer.tracked_since = "2026-07-17";
    expect(buildModel(raw, seamDate).repos.get(10)?.d).toBe(0);
  });

  test("separates active membership from retained historical repositories", () => {
    const raw = rawFixture();
    raw.repos["30"].active = false;
    const next = buildModel(raw, seamDate);
    expect(next.ids).toEqual([10, 20, 30]);
    expect(next.activeIds).toEqual([10, 20]);
    expect(next.orgs.get("alpha")).toMatchObject({ repo_count: 1, current_stars_sum: 100, members: [10] });
  });
});
