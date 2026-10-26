import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutThisDataContent, type AboutThisDataProps, type DataLayer } from "../../src/components/AboutThisDataContent";
import { LOCALES, toBcp47Locale } from "../../src/lib/i18n";
import { fixtureProps } from "./fixture";

const render = (props: AboutThisDataProps) => renderToStaticMarkup(createElement(AboutThisDataContent, props));

describe("About this data static render", () => {
  for (const locale of ["en", "ja"] as const) {
    test(`${locale}: published metadata, selectable citation and release link`, async () => {
      const props = await fixtureProps(locale);
      const html = render(props);
      expect(html).toContain(`<summary`);
      expect(html).toContain(props.dictionary.aboutData.heading);
      expect(html).toContain('dateTime="2026-08-19"');
      expect(html).toContain('href="/releases/refresh-fixture-2026-08-19"');
      expect(html).toContain(`href="${locale === "en" ? "" : "/ja"}/about#current-totals"`);
      expect(html).toContain("4,321");
      expect(html).not.toContain("5,687");
      expect(html).not.toContain("2026-10-25");
      expect(html).toContain(props.pageTitle);
      expect(html).toContain(props.canonicalUrl);
      expect(html).toContain('data-citation="true" tabindex="0"');
      expect(html).toContain('hidden="" data-copy="true"');
      const changed = render({ ...props, meta: { ...props.meta!, active_repo_count: 9876, generated_at: "2025-01-02T00:00:00.000Z" }, releaseId: "refresh-other" });
      expect(changed).toContain("9,876");
      expect(changed).toContain('dateTime="2025-01-02"');
      expect(changed).toContain("/releases/refresh-other");
      expect(changed).not.toContain("4,321");
    });
  }
  test("each locale renders every layer with its matching method section", async () => {
    for (const locale of LOCALES) {
      const props = await fixtureProps(locale);
      for (const [layer, anchor] of [["currentTotals", "current-totals"], ["periodGains", "period-gains"], ["historyCurve", "history-curve"]] as [DataLayer, string][]) {
        const html = render({ ...props, layer });
        expect(html).toContain(props.dictionary.aboutData[layer]);
        expect(html).toContain(`/about#${anchor}`);
        expect(html).not.toMatch(/\{(?:count|start|end|title|url|date|release)\}|undefined/);
      }
      const localDate = new Intl.DateTimeFormat(toBcp47Locale(locale), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date("2024-03-12"));
      expect(render(props)).toContain(localDate);
    }
  });
  test("missing metadata stays unavailable; zero count is real; bootstrap date is supported", async () => {
    const props = await fixtureProps();
    const html = render({ ...props, meta: null, releaseId: null, historyCoverage: undefined });
    expect(html).toContain(props.dictionary.aboutData.coverageUnknown);
    expect(html).not.toContain("/releases/");
    expect(html).not.toContain("daily history");
    expect(html).not.toContain("<time");
    expect(render({ ...props, meta: { seam_date: "2024-01-01", schema_ver: 1, active_repo_count: 0, backfilled_at: "2024-01-03T00:00:00.000Z" } })).toContain("(0 tracked)");
    expect(render({ ...props, meta: { seam_date: "2024-01-01", schema_ver: 1, backfilled_at: "2024-01-03T00:00:00.000Z" } })).toContain('dateTime="2024-01-03"');
  });
  test("caller text is escaped and template-like titles are preserved", async () => {
    const props = await fixtureProps();
    const html = render({ ...props, pageTitle: '<script>{date}</script>', releaseId: 'release/with?characters' });
    expect(html).toContain('&lt;script&gt;{date}&lt;/script&gt;');
    expect(html).toContain('/releases/release%2Fwith%3Fcharacters');
    expect(html).not.toContain('<script>');
  });
});
