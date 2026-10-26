import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { p1FixtureRecords } from "../p1/fixture";
import { meta, publication } from "./fixture";
import { getDictionary } from "../../src/lib/i18n";
import { pageData } from "../../src/lib/data";
import { withPublishedReaders } from "../../src/lib/published-readers";

// Shared web presentation components use Next links; Astro emits ordinary anchors.
mock.module("next/link", () => ({ default: (props: Record<string, unknown>) => createElement("a", props) }));
mock.module("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (location: string) => { throw new Error(`NEXT_REDIRECT:${location}`); },
}));

// Use the same native publication transport as Vite, without global fetch mocks.
const transport = new URL("../../src/lib/published-readers.ts", import.meta.url).pathname;
Bun.plugin({ name: "about-data-pages", setup(build) {
  build.onResolve({ filter: /^@\/lib\/fetch-timeout\.mjs$/ }, () => ({ path: transport }));
} });
const { PulsePageView } = await import("../../src/packages/p1/pulse");
const { PulseBody } = await import("../../src/packages/p5/PulseBody");
const { loadPulse } = await import("../../src/packages/p5/data");
const now = new Date("2026-07-17T12:00:00.000Z");

function captured(metadata: typeof meta, id: string) {
  const records = p1FixtureRecords();
  for (const key of ["meta.json", `views/${publication.version}/meta.json`]) records.set(key, JSON.stringify(metadata));
  for (const key of records.keys()) {
    if (key.endsWith("/meta.json")) records.set(key, JSON.stringify(metadata));
  }
  // The view pointer names the same captured fixture release as the citation.
  for (const [key, value] of [...records]) {
    if (key.startsWith("views/fixture-v1/")) records.set(key.replace("fixture-v1", publication.version), value);
  }
  const bucket = { async get(key: string) {
    const body = records.get(key);
    return body === undefined ? null : { text: async () => body, etag: key };
  } } as unknown as Parameters<typeof pageData>[0];
  return pageData(bucket, { id, views: publication, bootstrap: null, live: null });
}

for (const locale of ["en", "ja"] as const) {
  for (const family of ["home", "pulse"] as const) {
    test(`${locale} ${family}: disclosure placement, page citation and publication metadata`, async () => {
      const t = await getDictionary(locale);
      async function render(metadata: typeof meta, id: string) {
        const data = captured(metadata, id);
        const body = family === "home"
          ? (await withPublishedReaders(data, () => PulsePageView({ locale, canonicalPath: "/", releaseId: data.publication.views!.version, now }))).body
          : createElement(PulseBody, { locale, t, data: await loadPulse(data, now), releaseId: data.publication.views!.version, now });
        return renderToStaticMarkup(body);
      }
      const html = await render(meta, `${locale}-${family}-first`);
      const start = html.indexOf("<gsc-about-data");
      const end = html.indexOf("</gsc-about-data>", start);
      const disclosure = html.slice(start, end);
      expect(start).toBeGreaterThan(html.indexOf('data-testid="answer-capsule"'));
      expect(html.indexOf('data-testid="answer-capsule"')).toBeGreaterThan(-1);
      expect(end).toBeLessThan(html.indexOf('data-testid="faq"'));
      expect(disclosure).toContain(t.aboutData.heading);
      for (const [label, anchor] of [[t.aboutData.periodGains, "period-gains"], [t.aboutData.currentTotals, "current-totals"]]) {
        expect(disclosure).toContain(label);
        expect(disclosure).toContain(`href="${locale === "en" ? "" : "/ja"}/about#${anchor}"`);
      }
      const citation = disclosure.match(/data-citation="true"[^>]*>(.*?)<\/span>/s)?.[1]?.replaceAll("&amp;", "&");
      expect(citation).toBeDefined();
      expect(citation).toContain(`${family === "home" ? t.meta.homeTitle : t.meta.pulseTitle} · GitStarClub`);
      const path = family === "home" ? (locale === "en" ? "/" : "/ja") : (locale === "en" ? "/pulse" : "/ja/pulse");
      expect(citation).toContain(`https://gitstarclub.com${path}`);
      expect(citation).toContain(publication.version);
      expect(disclosure).toContain("4,321");
      expect(disclosure).toContain('dateTime="2026-08-19"');
      const changed = await render({ ...meta, active_repo_count: 9876, generated_at: "2025-01-02T00:00:00.000Z" }, `${locale}-${family}-changed`);
      expect(changed).toContain("9,876");
      expect(changed).toContain('dateTime="2025-01-02"');
      expect(changed).not.toContain("4,321");
      expect(changed).not.toContain('dateTime="2026-08-19"');
    });
  }
}
