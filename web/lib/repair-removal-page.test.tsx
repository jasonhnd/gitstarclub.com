import { dateLabel } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locales";
import { afterAll, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { joinRepoRank } from "@/lib/data/rank";
import { getDictionary, LOCALES } from "@/lib/i18n";

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  },
  usePathname: () => "/",
  useRouter: () => ({
    back() {},
    forward() {},
    prefetch() {},
    push() {},
    refresh() {},
    replace() {},
  }),
  useSearchParams: () => new URLSearchParams(),
}));

const noticeModule = await import("@/lib/repair-removal-notice");
const selectNotice = noticeModule.repairRemovalNoticeText;
let publishDate: string | null = null;
mock.module("@/lib/repair-removal-notice", () => ({
  ...noticeModule,
  repairRemovalNoticeText: (window: string, entity: string, period: string, template: string, locale: Locale) =>
    selectNotice(window, entity, period, template, locale, { date: publishDate, count: 4 }),
}));

let generatedAt: string | null = "2026-07-26T00:00:00.000Z";
mock.module("@/lib/data", () => ({
  getRank: async (window: string, period: string, dim: string, metric: string) => ({
    meta: {
      window,
      period,
      dim,
      metric,
      ...(generatedAt ? { generated_at: generatedAt } : {}),
    },
    items: [{
      rank: 1,
      id: 1,
      value: 10,
      prev_rank: null,
      ...(metric === "growth" ? { rate: 10 } : {}),
      ...(metric === "new" ? { date: "2026-07-17" } : {}),
    }],
  }),
  getHeatmap: async () => null,
  getReposLookup: async () => ({
    "1": {
      owner: "example",
      name: "repo",
      full_name: "example/repo",
      owner_type: "Organization",
      language: "TypeScript",
      current_stars: 100,
    },
  }),
  getCategoryRegistry: async () => null,
  getCategoryAssignmentsForRepos: async () => null,
  joinRepoRank,
}));

mock.module("@/lib/data/rank-periods", () => ({
  resolveAvailableRankPeriods: async () => ({
    year: 2026,
    yearLink: { kind: "year", year: 2026, href: "/rankings/2026", label: "2026" },
    month: { kind: "month", year: 2026, month: 7, period: "2026-07", href: "/rankings/2026/7", label: "July 2026" },
    week: { kind: "week", year: 2026, week: 29, period: "2026-W29", href: "/rankings/2026/W29", label: "2026-W29" },
    allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
  }),
  resolveAdjacentRankPeriod: async () => null,
  resolveAdjacentRankYear: async () => null,
}));

const { RankingsPeriodPageView, RankingsYearPageView } = await import("@/app/_localized/ranking-detail");

afterAll(() => {
  publishDate = null;
  mock.restore();
});

async function pageHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

test("monthly pages place the notice after the answer capsule and keep it when the capsule is absent", async () => {
  for (const locale of LOCALES) {
    const dictionary = await getDictionary(locale);
    const sentence = dictionary.rankings.repairRemovalNotice.replace("{date}", dateLabel(locale, "2026-07-26", "long")).replace("{count}", "4");
    generatedAt = "2026-07-26T00:00:00.000Z";
    publishDate = "2026-07-26";
    const enabled = await pageHtml(await RankingsPeriodPageView({ locale, year: "2026", period: "7" }));
    expect(enabled.split(sentence)).toHaveLength(2);
    expect(enabled.indexOf(sentence)).toBeGreaterThan(enabled.indexOf("</h1>"));
    const capsuleStart = enabled.indexOf('data-testid="answer-capsule"');
    const capsuleEnd = enabled.indexOf("</section>", capsuleStart);
    expect(capsuleStart).toBeGreaterThan(-1);
    expect(enabled.slice(capsuleEnd + "</section>".length)).toStartWith('<p class="mt-3 border-l-2');
    expect(enabled.indexOf(sentence)).toBeGreaterThan(capsuleEnd);
    expect(enabled.slice(enabled.indexOf(sentence) + sentence.length)).toStartWith("</p><nav");
    expect(enabled.indexOf(sentence)).toBeLessThan(enabled.indexOf(">#1</span>"));
    expect(enabled.indexOf(sentence)).toBeLessThan(enabled.indexOf("<table"));

    generatedAt = null;
    const withoutCapsule = await pageHtml(await RankingsPeriodPageView({ locale, year: "2026", period: "7" }));
    expect(withoutCapsule).not.toContain('data-testid="answer-capsule"');
    expect(withoutCapsule.split(sentence)).toHaveLength(2);
    expect(withoutCapsule.indexOf(sentence)).toBeGreaterThan(withoutCapsule.indexOf("</h1>"));
    expect(withoutCapsule.indexOf(sentence)).toBeLessThan(withoutCapsule.indexOf("<table"));
    expect(withoutCapsule).toContain("example/repo");
  }

  generatedAt = "2026-07-26T00:00:00.000Z";
  publishDate = "2026-07-26";
  const dictionary = await getDictionary("en");
  const sentence = dictionary.rankings.repairRemovalNotice.replace("{date}", dateLabel("en", "2026-07-26", "long")).replace("{count}", "4");
  const week = await pageHtml(await RankingsPeriodPageView({ locale: "en", year: "2026", period: "W29" }));
  const year = await pageHtml(await RankingsYearPageView({ locale: "en", year: "2026", now: new Date("2026-07-26T00:00:00.000Z") }));
  expect(week).not.toContain(sentence);
  expect(year).not.toContain(sentence);
});
