import { describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { organizationAboutData, organizationCanonicalUrl, organizationPageTitle } from "../../src/packages/p4/about-data";
import { organizationDetail } from "../../src/packages/p4/data";
import { organizationRecords } from "./fixture";
import { localizedPath } from "../../src/lib/i18n";
import type { Meta, OrgEntity } from "../../src/lib/contracts";
import { AboutThisDataContent } from "../../src/components/AboutThisDataContent";

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

const { OrgContent } = await import("../../src/packages/p4/OrgContent");

function reader() {
  return {
    async base<T>(path: string, schema: { parse(value: unknown): T }): Promise<T | null> {
      const body = organizationRecords().get(path);
      return body === undefined ? null : schema.parse(JSON.parse(body));
    },
  };
}

const releaseId = "refresh-org-page";

async function detail(locale: "en" | "ja", login: string) {
  const result = await organizationDetail(reader(), localizedPath(locale, `/o/${login}`), login);
  if (result instanceof Response) throw new Error(`Expected ${locale} /o/${login}`);
  return result;
}

function cited(pageTitle: string): string {
  return pageTitle.replaceAll("&", "&amp;");
}

function renderPage(page: Exclude<Awaited<ReturnType<typeof organizationDetail>>, Response>, meta: Meta | null = page.meta) {
  const pageTitle = organizationPageTitle(page.title);
  const canonicalUrl = organizationCanonicalUrl(page.locale, page.canonicalPath);
  const org = { ...page.org, curve: { ...page.org.curve, monthly: page.org.curve.monthly.slice(0, 1) } };
  const layers = organizationAboutData({ locale: page.locale, dictionary: page.t, meta, releaseId, pageTitle, canonicalUrl, org: page.org });
  const html = renderToStaticMarkup(createElement(OrgContent, { ...page, org, meta, releaseId, pageTitle, canonicalUrl }));
  return { html, layers, pageTitle, canonicalUrl };
}

describe("organization About this data", () => {
  for (const locale of ["en", "ja"] as const) {
    for (const login of ["example", "fixture-001"]) {
      test(`${locale} /o/${login}: disclosure follows the capsule, precedes the FAQ, and uses this page's meta and layers`, async () => {
        const page = await detail(locale, login);
        const meta = { ...page.meta!, active_repo_count: 4321, generated_at: "2026-08-19T23:42:00.000Z" };
        const { html, layers, pageTitle, canonicalUrl } = renderPage(page, meta);
        expect(layers.map((layer) => layer.layer)).toEqual(["currentTotals", "historyCurve"]);
        expect(layers.every((layer) => layer.meta === meta && layer.releaseId === releaseId && layer.pageTitle === pageTitle && layer.canonicalUrl === canonicalUrl)).toBe(true);
        expect(layers[0].historyCoverage).toBeUndefined();
        expect(html.match(/<gsc-about-data/g)).toHaveLength(2);
        const capsule = html.indexOf('data-testid="answer-capsule"');
        const about = html.indexOf("<gsc-about-data");
        const faq = html.indexOf('data-testid="faq"');
        expect(capsule).toBeGreaterThan(-1);
        expect(about).toBeGreaterThan(capsule);
        expect(faq).toBeGreaterThan(html.lastIndexOf("<gsc-about-data"));
        expect(html).toContain(page.t.aboutData.heading);
        expect(html).toContain(page.t.aboutData.currentTotals);
        expect(html).toContain(page.t.aboutData.historyCurve);
        expect(html).toContain(`href="${locale === "en" ? "" : "/ja"}/about#current-totals"`);
        expect(html).toContain(`href="${locale === "en" ? "" : "/ja"}/about#history-curve"`);
        expect(html).not.toContain("#period-gains");
        expect(html).toContain('dateTime="2026-08-19"');
        expect(html).toContain(locale === "ja" ? "4,321" : "4,321");
        expect(html).toContain(`/releases/${releaseId}`);
        expect(html).toContain(cited(pageTitle));
        expect(html).toContain(canonicalUrl);
        expect(html).not.toContain(page.t.aboutData.dailyHistory.split("{")[0].trim());
      });
    }
  }

  test("history curve receives published daily coverage only when this page shows those points", async () => {
    const page = await detail("en", "example");
    const provenance = {
      source: "github_stargazers_history_aggregate",
      api_version: "2026-03-10",
      metric: "surviving_stars_at_query_time",
      day_boundary: "github_calendar_label_approximate_not_guaranteed_utc",
      day_shift: 0,
      week_calendar: "iso_monday_sunday_reaggregated_from_daily",
      monthly_policy: "preserve_published_net_do_not_fold_these_daily_values_into_months",
      start: "2026-05-30",
      end_inclusive: "2026-09-30",
    } as const;
    const withHistory: OrgEntity = { ...page.org, curve: { ...page.org.curve, provenance } };
    const covered = organizationAboutData({
      locale: page.locale, dictionary: page.t, meta: page.meta, releaseId, pageTitle: "T", canonicalUrl: "https://gitstarclub.com/o/example", org: withHistory,
    });
    expect(covered[1].historyCoverage).toEqual({ start: "2026-05-30", end_inclusive: "2026-09-30" });
    const hidden: OrgEntity = { ...withHistory, curve: { ...withHistory.curve, recent_daily: [] } };
    const omitted = organizationAboutData({
      locale: page.locale, dictionary: page.t, meta: page.meta, releaseId, pageTitle: "T", canonicalUrl: "https://gitstarclub.com/o/example", org: hidden,
    });
    expect(omitted[1].historyCoverage).toBeUndefined();
    const html = renderToStaticMarkup(createElement(AboutThisDataContent, covered[1]!));
    expect(html).toContain("daily history May 30, 2026");
    expect(html).toContain("Sep 30, 2026");
  });
});
