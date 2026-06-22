import { describe, expect, test } from "bun:test";
import { HIGH_D_FACTOR_WARN_THRESHOLD, inspectAnchoringFactors } from "./validate";

describe("inspectAnchoringFactors", () => {
  test("reports high anchoring factors without producing publish failures", () => {
    expect(
      inspectAnchoringFactors([
        {
          "1": { d: 0.8 },
          "2": { d: HIGH_D_FACTOR_WARN_THRESHOLD },
          "3": { d: HIGH_D_FACTOR_WARN_THRESHOLD + 0.01 },
          "4": { d: 12.9123 },
          "5": {},
        },
      ]),
    ).toEqual({
      d_factor_warn_threshold: HIGH_D_FACTOR_WARN_THRESHOLD,
      d_factor_repos_checked: 5,
      d_factor_repos_with_d: 4,
      d_factor_high_count: 2,
      d_factor_max: 12.912,
      d_factor_warning: true,
    });
  });
});
