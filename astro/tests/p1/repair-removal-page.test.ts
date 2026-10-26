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
import { getDictionary, LOCALES } from "../../../web/lib/i18n";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { p1FixtureRecords } from "./fixture";

const transport = new URL("../../src/lib/published-readers.ts", import.meta.url).pathname;
Bun.plugin({ name: "published-reader-test", setup(build) {
  build.onResolve({ filter: /^@\/lib\/fetch-timeout\.mjs$/ }, () => ({ path: transport }));
} });

const noticeModule = await import("../../../web/lib/repair-removal-notice");
const selectNotice = noticeModule.repairRemovalNoticeText;
let publishDate: string | null = null;
mock.module("../../../web/lib/repair-removal-notice", () => ({
  ...noticeModule,
  repairRemovalNoticeText: (window: string, entity: string, period: string, template: string) =>
    selectNotice(window, entity, period, template, { date: publishDate, count: 4 }),
}));

const { loadPage } = await import("../../src/packages/p1/page");

test("monthly pages place the enabled notice after the hero and before the ranking content in all locales", async () => {
  const records = p1FixtureRecords();
  const bucket = { async get(key: string) {
    const value = records.get(key);
    return value === undefined ? null : { key, etag: key, size: value.length, text: async () => value };
  } } as R2Bucket;
  const publication = await readPublication(async (key) => records.has(key) ? { body: records.get(key)!, etag: key } : null);
  const data = pageData(bucket, publication);
  try {
    for (const locale of LOCALES) {
      const dictionary = await getDictionary(locale);
      const sentence = dictionary.rankings.repairRemovalNotice.replace("{date}", "2026-07-26").replace("{count}", "4");
      publishDate = null;
      const disabled = await loadPage(data, "period", locale, "2026", "7");
      expect(disabled).not.toBeNull();
      expect(disabled!.html).not.toContain(sentence);
      publishDate = "2026-07-26";
      const enabled = await loadPage(data, "period", locale, "2026", "7");
      expect(enabled).not.toBeNull();
      const html = enabled!.html;
      expect(html.split(sentence)).toHaveLength(2);
      expect(html.indexOf(sentence)).toBeGreaterThan(html.indexOf("</h1>"));
      expect(html.indexOf(sentence)).toBeLessThan(html.indexOf('data-testid="answer-capsule"'));
      expect(html.indexOf(sentence)).toBeLessThan(html.indexOf('<table'));
      for (const [kind, year, period] of [["rankings", "", ""], ["year", "2026", ""], ["period", "2026", "W29"]] as const) {
        const page = await loadPage(data, kind, locale, year, period);
        expect(page).not.toBeNull();
        expect(page!.html).not.toContain(sentence);
      }
      publishDate = "2026-06-30";
      const later = await loadPage(data, "period", locale, "2026", "7");
      expect(later).not.toBeNull();
      expect(later!.html).not.toContain(dictionary.rankings.repairRemovalNotice.replace("{date}", publishDate).replace("{count}", "4"));
    }
  } finally {
    publishDate = null;
    mock.restore();
  }
});
