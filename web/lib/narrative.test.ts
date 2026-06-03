import { describe, expect, test } from "bun:test";
import { buildNarrative } from "./narrative";

const base = {
  labelEn: "June 2024",
  labelZh: "2024 年 6 月",
  topGainers: [
    { full_name: "facebook/react", gained: 12345 },
    { full_name: "vuejs/vue", gained: 9000 },
    { full_name: "angular/angular", gained: 7000 },
  ],
  fastest: [{ full_name: "trending/x", rate: 320 }],
  newcomerCount: 5,
  newcomers: ["a/b", "c/d"],
};

describe("buildNarrative", () => {
  test("composes a factual bilingual paragraph with lead, fastest, newcomers", () => {
    const n = buildNarrative(base)!;
    expect(n.en).toBe(
      "In June 2024, facebook/react led GitHub with +12,345 stars, ahead of vuejs/vue and angular/angular. trending/x grew fastest, up 320%. 5 repositories first crossed 10,000 stars (e.g. a/b, c/d).",
    );
    expect(n.zh).toBe(
      "2024 年 6 月，facebook/react 以 +12,345 星领涨，vuejs/vue、angular/angular 紧随其后。trending/x 增速最快，+320%。5 个项目首次突破 1 万星（如 a/b、c/d）。",
    );
  });

  test("returns null when there are no gainers", () => {
    expect(buildNarrative({ ...base, topGainers: [] })).toBeNull();
  });

  test("single gainer, no fastest, no newcomers → just the lead sentence", () => {
    const n = buildNarrative({ labelEn: "Jan 2020", labelZh: "2020 年 1 月", topGainers: [{ full_name: "x/y", gained: 500 }], fastest: [], newcomerCount: 0, newcomers: [] })!;
    expect(n.en).toBe("In Jan 2020, x/y led GitHub with +500 stars.");
    expect(n.zh).toBe("2020 年 1 月，x/y 以 +500 星领涨。");
  });

  test("singular newcomer wording", () => {
    const n = buildNarrative({ ...base, fastest: [], newcomerCount: 1, newcomers: ["solo/repo"] })!;
    expect(n.en).toContain("1 repository first crossed 10,000 stars (e.g. solo/repo).");
    expect(n.zh).toContain("1 个项目首次突破 1 万星（如 solo/repo）。");
  });
});
