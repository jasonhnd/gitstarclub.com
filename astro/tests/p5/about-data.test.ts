import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Meta } from "../../src/lib/contracts";
import { getDictionary, localizedPath, toBcp47Locale, type Locale } from "../../src/lib/i18n";

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

const { CompareBody } = await import("../../src/packages/p5/CompareBody");

const meta = Meta.parse({
  seam_date: "2024-03-12", schema_ver: 1, generated_at: "2026-08-19T23:42:00.000Z",
  active_repo_count: 4321, historical_repo_count: 5687,
});
const emptyPairs = { conclusions: [], unavailablePairs: [] };

function pageTitle(title: string) {
  return `${title} · GitStarClub`;
}
function canonicalUrl(locale: Locale) {
  return new URL(localizedPath(locale, "/compare"), "https://gitstarclub.com").href;
}

for (const locale of ["en", "ja"] as const satisfies readonly Locale[]) {
  test(`${locale} compare page renders About this data from the current meta on the history curve`, async () => {
    const t = await getDictionary(locale);
    const title = pageTitle(t.meta.compareTitle);
    const url = canonicalUrl(locale);
    const html = renderToStaticMarkup(createElement(CompareBody, {
      locale, t, meta, pairs: emptyPairs, releaseId: "refresh-fixture-2026-08-19", pageTitle: title, canonicalUrl: url,
    }));
    const about = html.indexOf("<gsc-about-data");
    const capsule = html.indexOf('data-testid="answer-capsule"');
    const faq = html.indexOf('id="faq-heading"');
    expect(capsule).toBeGreaterThan(-1);
    expect(about).toBeGreaterThan(capsule);
    expect(faq).toBeGreaterThan(about);
    expect(html).toContain(t.aboutData.heading);
    expect(html).toContain(t.aboutData.historyCurve);
    expect(html).toContain(`${localizedPath(locale, "/about")}#history-curve`);
    expect(html).not.toContain("#current-totals");
    expect(html).not.toContain("#period-gains");
    expect(html).toContain('dateTime="2026-08-19"');
    const count = new Intl.NumberFormat(toBcp47Locale(locale)).format(meta.active_repo_count!);
    expect(html).toContain(count);
    expect(html).not.toContain("5,687");
    expect(html).not.toContain(String(meta.historical_repo_count));
    expect(html).toContain(title);
    expect(html).toContain(url);
    expect(html).toContain('href="/releases/refresh-fixture-2026-08-19"');
    expect(html).not.toContain(t.aboutData.dailyHistory.slice(0, 12));
  });

  test(`${locale} compare page keeps the block when metadata is missing`, async () => {
    const t = await getDictionary(locale);
    const html = renderToStaticMarkup(createElement(CompareBody, {
      locale, t, meta: null, pairs: emptyPairs, releaseId: null,
      pageTitle: pageTitle(t.meta.compareTitle), canonicalUrl: canonicalUrl(locale),
    }));
    const about = html.indexOf("<gsc-about-data");
    const faq = html.indexOf('id="faq-heading"');
    expect(about).toBeGreaterThan(-1);
    expect(faq).toBeGreaterThan(about);
    expect(html).toContain(t.aboutData.historyCurve);
    expect(html).toContain(t.aboutData.coverageUnknown);
    expect(html).toContain(t.aboutData.unavailable);
    expect(html).not.toContain("/releases/");
    expect(html).not.toContain("<time");
  });
}
