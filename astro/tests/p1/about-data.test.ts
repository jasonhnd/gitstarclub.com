import * as React from "react";
import { expect, mock, test } from "bun:test";
import { pageData } from "../../src/lib/data";

mock.module("react", () => React);
mock.module("@/app/_explore/ShareButton", () => ({
  ShareButton: function ShareButton() { return React.createElement("button", { type: "button" }, "share"); },
}));
mock.module("@/app/_explore/SnippetActions", () => ({
  SnippetActions: function SnippetActions() { return React.createElement("div"); },
}));
mock.module("@/app/_explore/ShareableSnippet", () => ({
  ShareableSnippet: function ShareableSnippet() { return React.createElement("section"); },
}));
mock.module("next/link", () => ({
  default: function Link(props: Record<string, unknown>) {
    const { href, children, ...rest } = props;
    return React.createElement("a", { href, ...rest }, children as never);
  },
}));
import { readPublication } from "../../../web/lib/workers-host/publication-fence";
import { getDictionary } from "../../../web/lib/i18n";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { p1FixtureRecords } from "./fixture";

const transport = new URL("../../src/lib/published-readers.ts", import.meta.url).pathname;
Bun.plugin({ name: "published-reader-test", setup(build) {
  build.onResolve({ filter: /^@\/lib\/fetch-timeout\.mjs$/ }, () => ({ path: transport }));
} });
const { loadPage, pageIdentity } = await import("../../src/packages/p1/page");

test("rankings pages render About this data from the current meta with the period-gains layer", async () => {
  const records = p1FixtureRecords();
  const meta = { ...JSON.parse(records.get("meta.json")!), active_repo_count: 4321, generated_at: "2024-03-12T00:00:00.000Z" };
  const body = JSON.stringify(meta);
  records.set("meta.json", body);
  records.set("views/fixture-v1/meta.json", body);
  const bucket = { async get(key: string) {
    const value = records.get(key);
    return value === undefined ? null : { key, etag: key, size: value.length, text: async () => value };
  } } as R2Bucket;
  const publication = await readPublication(async (key) => records.has(key) ? { body: records.get(key)!, etag: key } : null);
  const data = pageData(bucket, publication);
  const cases = [
    ["rankings", "", ""],
    ["year", "2026", ""],
    ["period", "2026", "7"],
    ["period", "2026", "W29"],
  ] as const;

  for (const locale of ["en", "ja"] as const) {
    const dictionary = await getDictionary(locale);
    const home = await loadPage(data, "home", locale);
    expect(home?.html).toContain("<gsc-about-data");
    for (const [kind, year, period] of cases) {
      const page = await loadPage(data, kind, locale, year, period);
      expect(page, `${locale} ${kind} ${year} ${period}`).not.toBeNull();
      const html = page!.html;
      const path = kind === "rankings" ? "/rankings" : kind === "year" ? `/rankings/${year}` : period.startsWith("W") ? `/rankings/${year}/${period}` : `/rankings/${year}/${Number(period)}`;
      const identity = pageIdentity(locale, path, page!.title, false);
      const citation = dictionary.aboutData.citation
        .replace("{title}", identity.pageTitle)
        .replace("{url}", identity.canonicalUrl)
        .replace("{date}", "2024-03-12")
        .replace("{release}", publication.views!.version);
      const about = html.indexOf("<gsc-about-data");
      const capsule = html.indexOf('data-testid="answer-capsule"');
      const faq = html.indexOf('data-testid="faq"');
      expect(capsule, path).toBeGreaterThan(-1);
      expect(about, path).toBeGreaterThan(capsule);
      expect(faq, path).toBeGreaterThan(about);
      expect(html).toContain(dictionary.aboutData.heading);
      expect(html).toContain(dictionary.aboutData.periodGains);
      expect(html).toContain(`${locale === "en" ? "" : "/ja"}/about#period-gains`);
      expect(html).not.toContain("/about#current-totals");
      expect(html).not.toContain("/about#history-curve");
      expect(html).toContain('dateTime="2024-03-12"');
      expect(html).toContain("4,321");
      expect(html).toContain(`/releases/${publication.views?.version}`);
      const citeAs = html.match(/<span data-citation[^>]*>([^<]*)<\/span>/)?.[1];
      expect(citeAs, `${locale} ${path}`).toBe(citation.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
      expect(page!.aboutData).toBe(true);
    }
  }
});
