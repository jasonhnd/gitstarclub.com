import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RepoMilestonesSection } from "@/app/_localized/repo-sections";
import { getDictionary } from "@/lib/i18n";
import { exactRepoMilestones } from "./repo-milestones";

describe("exactRepoMilestones", () => {
  const series = ["2024-01", "2024-02", "2024-03", "2024-04"].map((label) => ({ label }));

  test("uses frozen first-crossing dates for exact 10k/50k/100k milestones", () => {
    expect(
      exactRepoMilestones(series, {
        crossed_10k: "2024-02-17",
        crossed_50k: "2024-03-05",
        crossed_100k: "2024-04-29",
      }),
    ).toEqual([
      { stars: 10_000, label: "10k", date: "2024-02-17", monthIndex: 1 },
      { stars: 50_000, label: "50k", date: "2024-03-05", monthIndex: 2 },
      { stars: 100_000, label: "100k", date: "2024-04-29", monthIndex: 3 },
    ]);
  });

  test("does not synthesize higher thresholds from the monthly curve", () => {
    expect(
      exactRepoMilestones(series, {
        crossed_10k: "2024-02-17",
        crossed_50k: null,
        crossed_100k: null,
      }),
    ).toEqual([{ stars: 10_000, label: "10k", date: "2024-02-17", monthIndex: 1 }]);
  });

  test("hides frozen milestones outside the rendered curve range", () => {
    expect(
      exactRepoMilestones(series, {
        crossed_10k: "2023-12-31",
        crossed_50k: "2024-03-05",
        crossed_100k: null,
      }),
    ).toEqual([{ stars: 50_000, label: "50k", date: "2024-03-05", monthIndex: 2 }]);
  });
});

describe("RepoMilestonesSection ranking links", () => {
  test("links in-range crossings and leaves pre-2015 dates unlinked", async () => {
    const t = await getDictionary("en");
    const html = renderToStaticMarkup(
      createElement(RepoMilestonesSection, {
        locale: "en",
        milestoneSnippet: null,
        snippetLabels: { eyebrow: "s", copy: "c", copied: "d", embed: "e", embedCopied: "f" },
        t,
        milestones: [
          { stars: 10_000, label: "10k", date: "2014-02-01", monthIndex: 0 },
          { stars: 50_000, label: "50k", date: "2020-03-15", monthIndex: 1 },
        ],
      }),
    );

    expect(html).toContain("10k");
    expect(html).toContain("50k");
    expect(html).toContain('href="/rankings/2020/3"');
    expect(html).not.toContain("/rankings/2014/");
    expect(html).not.toContain('href="/rankings/2014/2"');
  });
});
