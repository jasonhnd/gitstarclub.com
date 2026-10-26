import { Meta, ViewsPointer } from "../../src/lib/contracts";
import { getDictionary, type Locale } from "../../src/lib/i18n";
import type { AboutThisDataProps } from "../../src/components/AboutThisDataContent";

export const meta = Meta.parse({
  seam_date: "2024-03-12", schema_ver: 1, generated_at: "2026-08-19T23:42:00.000Z",
  active_repo_count: 4321, historical_repo_count: 123,
});
export const publication = ViewsPointer.parse({
  version: "refresh-fixture-2026-08-19", run_id: "refresh-fixture-2026-08-19",
  published_at: "2026-08-20T01:00:00.000Z", prev_version: null, schema_ver: 1,
});
export async function fixtureProps(locale: Locale = "en"): Promise<AboutThisDataProps> {
  return {
    locale, dictionary: await getDictionary(locale), meta, releaseId: publication.version,
    layer: "currentTotals", pageTitle: "example/repo – GitStarClub",
    canonicalUrl: `https://gitstarclub.com${locale === "en" ? "" : `/${locale}`}/example/repo`,
    historyCoverage: { start: "2024-03-12", end_inclusive: "2025-02-08" },
  };
}
