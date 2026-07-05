import { describe, expect, test } from "bun:test";
import { absoluteSnippetUrl, buildOrgTotalSnippet, buildRepoMilestoneSnippet, buildWeeklyMoversSnippet } from "./shareable-snippets";

const asOf = "June 24, 2026";

describe("shareable snippets", () => {
  test("builds weekly mover snippets with canonical production links", () => {
    const snippet = buildWeeklyMoversSnippet({
      period: "2026-W26",
      asOf,
      path: "/rankings/2026/W26",
      rows: [
        { owner: "react", name: "react", gained: 1200 },
        { owner: "vuejs", name: "vue", gained: 800 },
        { owner: "angular", name: "angular", gained: 500 },
      ],
    });

    expect(snippet?.text).toBe(
      "As of June 24, 2026, react/react led GitStarClub's 2026-W26 weekly movers with +1.2k stars gained. vuejs/vue (+800) and angular/angular (+500) followed in the tracked weekly ranking. Source: GitStarClub 2026-W26 weekly rankings.",
    );
    expect(snippet?.links.map((link) => link.href)).toEqual([
      "https://gitstarclub.com/rankings/2026/W26",
      "https://gitstarclub.com/react/react",
      "https://gitstarclub.com/vuejs/vue",
      "https://gitstarclub.com/angular/angular",
    ]);
    expect(snippet?.embedHtml).toContain('<blockquote cite="https://gitstarclub.com/rankings/2026/W26">');
  });

  test("builds repo milestone snippets from frozen exact milestone rows", () => {
    const snippet = buildRepoMilestoneSnippet({
      repo: { full_name: "react/react" },
      asOf,
      milestones: [
        { stars: 10000, label: "10k", date: "2015-05-20", monthIndex: 0 },
        { stars: 50000, label: "50k", date: "2017-01-10", monthIndex: 1 },
        { stars: 100000, label: "100k", date: "2018-06-01", monthIndex: 2 },
      ],
    });

    expect(snippet?.text).toContain("react/react crossing 10k in May 2015, 50k in January 2017, and 100k in June 2018");
    expect(snippet?.links.map((link) => link.href)).toEqual([
      "https://gitstarclub.com/react/react",
      "https://gitstarclub.com/rankings/2015/5",
      "https://gitstarclub.com/rankings/2017/1",
      "https://gitstarclub.com/rankings/2018/6",
    ]);

    const localized = buildRepoMilestoneSnippet({
      locale: "ja",
      repo: { full_name: "react/react" },
      asOf: "2026年6月24日",
      milestones: [{ stars: 10000, label: "10k", date: "2015-05-20", monthIndex: 0 }],
    });
    expect(localized?.text).toContain("10k in 2015年5月");
    expect(localized?.text).not.toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
  });

  test("builds org total snippets with member links and escaped embed html", () => {
    const snippet = buildOrgTotalSnippet({
      org: { login: "vercel", current_stars_sum: 400000, repo_count: 42 },
      asOf,
      members: [
        { owner: "vercel", name: "next.js", total: 140000 },
        { owner: "vercel", name: "hyper", total: 44000 },
        { owner: "vercel", name: "swr", total: 32000 },
      ],
    });

    expect(snippet?.copyText).toContain("vercel has 400.0k total GitHub stars across 42 tracked repositories");
    expect(snippet?.links.at(0)?.href).toBe("https://gitstarclub.com/o/vercel");
    expect(snippet?.embedHtml).toContain("vercel organization total");
    expect(snippet?.embedHtml).not.toContain("<script");

    const localized = buildOrgTotalSnippet({
      locale: "fr",
      org: { login: "vercel", current_stars_sum: 400000, repo_count: 1234 },
      asOf: "28 juin 2026",
      members: [],
    });
    expect(localized?.copyText).toContain(`across ${(1234).toLocaleString("fr-FR")} tracked repositories`);
  });

  test("normalizes canonical urls", () => {
    expect(absoluteSnippetUrl("/")).toBe("https://gitstarclub.com/");
    expect(absoluteSnippetUrl("rankings")).toBe("https://gitstarclub.com/rankings");
    expect(absoluteSnippetUrl("https://example.com/source")).toBe("https://example.com/source");
  });
});
