import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RepairRemovalNotice } from "@/app/_explore/RepairRemovalNotice";
import { getDictionary, LOCALES } from "@/lib/i18n";
import { REPAIR_REMOVAL_NOTICE, type RepairRemovalNotice as Notice } from "@/lib/repair-removal-notice";

const published: Notice = { date: "2026-10-26", count: 4 };

async function render(locale: (typeof LOCALES)[number], window = "month", entity = "repo", period = "2026-10", notice?: Notice) {
  const copy = (await getDictionary(locale)).rankings;
  return renderToStaticMarkup(createElement(RepairRemovalNotice, { window, entity, period, copy, notice }));
}

describe("monthly repository repair removal notice", () => {
  test("starts disabled pending the go-live publish date", () => {
    expect(REPAIR_REMOVAL_NOTICE).toEqual({ date: null, count: 4 });
  });

  for (const locale of LOCALES) {
    test(`${locale}: renders the translated sentence with date and count`, async () => {
      const template = (await getDictionary(locale)).rankings.repairRemovalNotice;
      const expected = template.replace("{date}", published.date!).replace("{count}", "4");
      const html = await render(locale, "month", "repo", "2026-10", published);
      expect(html).toContain(expected);
      expect(html).toStartWith('<p class="mt-4 text-sm leading-relaxed text-on-surface-variant">');
      expect(html).not.toMatch(/\{(?:date|count)\}|undefined/);
    });

    test(`${locale}: unset date renders nothing`, async () => {
      expect(await render(locale)).toBe("");
      expect(await render(locale, "month", "repo", "2026-10", { date: null, count: 4 })).toBe("");
    });
  }

  test("includes older months and the removal month, excluding later months", async () => {
    expect(await render("en", "month", "repo", "2012-01", published)).toContain("As of 2026-10-26, 4 repositories");
    expect(await render("en", "month", "repo", "2026-10", published)).toContain("ranks moved up accordingly.");
    for (const period of ["2026-11", "2027-01", "2026-1", "2026-13", ""]) {
      expect(await render("en", "month", "repo", period, published)).toBe("");
    }
    expect(await render("en", "month", "repo", "2026-10", { date: "2026-09-30", count: 4 })).toBe("");
  });

  test("excludes every non-monthly or non-repository ranking", async () => {
    for (const locale of LOCALES) {
      for (const [window, entity, period] of [
        ["week", "repo", "2026-W43"], ["year", "repo", "2026"],
        ["all", "repo", "all"], ["day", "repo", "2026-10-26"],
        ["month", "org", "2026-10"], ["month", "owner", "2026-10"],
      ]) {
        expect(await render(locale, window, entity, period, published)).toBe("");
      }
    }
  });
});
