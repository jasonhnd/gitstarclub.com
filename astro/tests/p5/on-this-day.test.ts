import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDictionary, LOCALES, type Locale } from "../../src/lib/i18n";
import { meta, publication } from "../about-data/fixture";
import type { PulseData } from "../../src/packages/p5/data";
import type { HotSnapshot } from "../../../web/lib/contracts";
import { onThisDayEmptyMessage } from "../../../web/lib/on-this-day-empty";

mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
mock.module("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (location: string) => { throw new Error(`NEXT_REDIRECT:${location}`); },
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const { PulseBody } = await import("../../src/packages/p5/PulseBody");

const GENERATED_AT = "2026-07-17T00:00:00.000Z";
const VERIFIED_AT = "2026-10-25T04:00:34.331Z";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const OLD = "Ranking data is waiting for the next published recompute.";

const availablePeriods: PulseData["availablePeriods"] = {
  year: 2026,
  yearLink: { kind: "fallback", href: "/rankings", label: "Full history" },
  month: { kind: "fallback", href: "/rankings", label: "Full history" },
  week: { kind: "fallback", href: "/rankings", label: "Full history" },
  allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
};

function snapshot(onThisDay: string | null): HotSnapshot {
  return {
    generated_at: GENERATED_AT,
    freshness: {
      current_month: null,
      current_year: null,
      year_spine: null,
      on_this_day: onThisDay,
      all_time: GENERATED_AT,
    },
    home: { year_spine: [], current_month_top: { flow: [], stock: [] }, on_this_day: [] },
    current_year: { flow: [], stock: [] },
    current_month: { flow: [], stock: [] },
    all_time: { repo: [], org: [] },
  };
}

function data(onThisDay: string | null): PulseData {
  return { meta, snap: snapshot(onThisDay), lookup: {}, availablePeriods, activeWeekRank: null, activeMonthRank: null };
}

function panel(html: string, heading: string): string {
  const start = html.indexOf(`>${heading}</h2>`);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const end = rest.indexOf("</aside>");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

test("empty copy follows section freshness in every locale", async () => {
  for (const locale of LOCALES) {
    const t = await getDictionary(locale);
    expect(onThisDayEmptyMessage(null, { unavailable: t.pulse.milestoneHistoryUnavailable, noneToday: t.pulse.noMilestonesToday })).toBe(t.pulse.milestoneHistoryUnavailable);
    expect(onThisDayEmptyMessage(VERIFIED_AT, { unavailable: t.pulse.milestoneHistoryUnavailable, noneToday: t.pulse.noMilestonesToday })).toBe(t.pulse.noMilestonesToday);
    expect(t.pulse.milestoneHistoryUnavailable).not.toBe(OLD);
    expect(t.pulse.noMilestonesToday).not.toBe(OLD);
    if (locale !== "en") {
      expect(t.pulse.milestoneHistoryUnavailable).not.toBe("Milestone history not available yet");
      expect(t.pulse.noMilestonesToday).not.toBe("No recorded milestones today");
    }
  }
});

for (const locale of ["en", "ja"] as const satisfies readonly Locale[]) {
  test(`${locale} renders unavailable history without a borrowed snapshot date`, async () => {
    const t = await getDictionary(locale);
    const html = renderToStaticMarkup(createElement(PulseBody, { locale, t, data: data(null), releaseId: publication.version, now: NOW }));
    const aside = panel(html, t.pulse.onThisDay);
    expect(aside).toContain(t.pulse.milestoneHistoryUnavailable);
    expect(aside).not.toContain(t.pulse.noMilestonesToday);
    expect(aside).not.toContain(t.categories.rankingPending);
    expect(aside).not.toContain("July 17, 2026");
    expect(aside).not.toContain("2026年7月17日");
  });

  test(`${locale} renders a verified day with no milestones`, async () => {
    const t = await getDictionary(locale);
    const html = renderToStaticMarkup(createElement(PulseBody, { locale, t, data: data(VERIFIED_AT), releaseId: publication.version, now: NOW }));
    const aside = panel(html, t.pulse.onThisDay);
    expect(aside).toContain(t.pulse.noMilestonesToday);
    expect(aside).not.toContain(t.pulse.milestoneHistoryUnavailable);
    expect(aside).not.toContain(t.categories.rankingPending);
    expect(aside).toContain(locale === "ja" ? "2026年10月25日" : "October 25, 2026");
  });
}
