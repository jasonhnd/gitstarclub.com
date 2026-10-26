import { dateLabel } from "@/lib/format";
import { formatDataAsOf } from "@/lib/geo-capsules";
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { RepairRemovalNotice } from "@/app/_explore/RepairRemovalNotice";
import { getDictionary, LOCALES } from "@/lib/i18n";
import { REPAIR_REMOVAL_NOTICE, type RepairRemovalNotice as Notice } from "@/lib/repair-removal-notice";

const styleDir = join(import.meta.dir, "../app");
let builtCss = "";

beforeAll(async () => {
  // Automatic detection follows the package cwd, so Astro's test run would miss this file.
  const input = '@import "./globals.css";\n@source "./_explore/RepairRemovalNotice.tsx";\n';
  const result = await postcss([tailwindcss()]).process(input, { from: join(styleDir, "repair-removal-notice.css") });
  builtCss = result.css;
}, 30_000);

const published: Notice = { date: "2026-10-26", count: 4 };

async function render(locale: (typeof LOCALES)[number], window = "month", entity = "repo", period = "2026-10", notice?: Notice) {
  const copy = (await getDictionary(locale)).rankings;
  return renderToStaticMarkup(createElement(RepairRemovalNotice, { window, entity, period, copy, locale, notice }));
}

describe("monthly repository repair removal notice", () => {
  test("starts disabled pending the go-live publish date", () => {
    expect(REPAIR_REMOVAL_NOTICE).toEqual({ date: null, count: 4 });
  });

  for (const locale of LOCALES) {
    test(`${locale}: renders the translated sentence with date and count`, async () => {
      const template = (await getDictionary(locale)).rankings.repairRemovalNotice;
      const expected = template.replace("{date}", dateLabel(locale, published.date!, "long")).replace("{count}", "4");
      const html = await render(locale, "month", "repo", "2026-10", published);
      expect(html).toContain(expected);
      expect(template).toMatch(/\{count\}\u00a0\S+/);
      expect(html).not.toContain(published.date!);
      expect(html).toContain(formatDataAsOf(published.date, locale)!);
      expect(html).toStartWith('<p class="mt-3 border-l-2 rounded-2xl border-outline bg-surface-variant px-4 py-3 text-base leading-relaxed text-pretty text-on-surface">');
      const background = html.match(/\b(bg-[\w-]+)/)?.[1];
      expect(background).toBe("bg-surface-variant");
      expect(builtCss).toMatch(new RegExp(`\\.${background}(?![\\w-])`));
      expect(html).not.toMatch(/\{(?:date|count)\}|undefined/);
    });

    test(`${locale}: unset date renders nothing`, async () => {
      expect(await render(locale)).toBe("");
      expect(await render(locale, "month", "repo", "2026-10", { date: null, count: 4 })).toBe("");
    });
  }

  test("uses long localized dates", async () => {
    for (const [locale, date] of [["en", "October 27, 2026"], ["ja", dateLabel("ja", "2026-10-27", "long")], ["zh", dateLabel("zh", "2026-10-27", "long")]] as const) {
      expect(await render(locale, "month", "repo", "2026-07", { date: "2026-10-27", count: 4 })).toContain(date);
    }
  });

  test("preserves locale-specific spacing after the removal date", async () => {
    for (const [locale, suffix] of [["ja", "\u306b\u3001GitHub"], ["zh", "\uff0c"], ["zh-TW", "\uff0c"], ["ko", "\uc5d0 GitHub"]] as const) {
      const date = formatDataAsOf("2026-10-27", locale)!;
      expect(await render(locale, "month", "repo", "2026-07", { date: "2026-10-27", count: 4 })).toContain(`${date}${suffix}`);
    }
  });

  test("malformed and impossible publish dates render nothing", async () => {
    for (const date of ["invalid", "2026-10", "2026-1-26", "2026-13-01", "2026-10-00", "2026-02-30", "2025-02-29", "2026-10-26T00:00:00Z", " 2026-10-26", ""]) {
      expect(await render("en", "month", "repo", "2026-01", { date, count: 4 })).toBe("");
    }
    expect(await render("en", "month", "repo", "2024-02", { date: "2024-02-29", count: 4 })).toContain("On February 29, 2024");
  });

  test("includes older months and the removal month, excluding later months", async () => {
    expect(await render("en", "month", "repo", "2012-01", published)).toContain("On October 26, 2026, 4\u00a0repositories");
    expect(await render("en", "month", "repo", "2026-10", published)).toContain("the ranks below them moved up.");
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
