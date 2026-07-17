import { describe, expect, test } from "bun:test";
import { dateLabel, fmtStars } from "./format";

describe("locale-aware display formatting", () => {
  test("uses the active locale's compact-number notation", () => {
    expect(fmtStars(12_345, "en")).toBe("12.3k");
    expect(fmtStars(12_345, "ja")).toBe("1.2万");
    expect(fmtStars(12_345, "zh")).toBe("1.2万");
    expect(fmtStars(12_345, "fr")).toBe("12,3 k");
  });

  test("formats ISO dates in UTC without changing invalid source values", () => {
    expect(dateLabel("ja", "2026-07-17")).toBe("2026年7月17日");
    expect(dateLabel("zh", "2026-07-17")).toBe("2026年7月17日");
    expect(dateLabel("fr", "2026-07-17")).toBe("17 juil. 2026");
    expect(dateLabel("fr", "2026-02-31")).toBe("2026-02-31");
  });
});
