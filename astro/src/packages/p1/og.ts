import YearImage from "../../../../web/app/(en)/rankings/[year]/opengraph-image";
import PeriodImage from "../../../../web/app/(en)/rankings/[year]/[period]/opengraph-image";
import { withPublishedData } from "../../lib/published-fetch";

/** Reuse the existing deterministic ranking card and its validated data joins. */
export function rankingImage(year: string, period?: string): Promise<Response> {
  return withPublishedData(() => period === undefined
    ? YearImage({ params: Promise.resolve({ year }) })
    : PeriodImage({ params: Promise.resolve({ year, period }) }));
}
