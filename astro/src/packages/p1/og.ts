import YearImage from "../../../../web/app/(en)/rankings/[year]/opengraph-image";
import PeriodImage from "../../../../web/app/(en)/rankings/[year]/[period]/opengraph-image";
import { withPublishedReaders } from "../../lib/published-readers";

/** Reuse the existing deterministic ranking card and its validated data joins. */
import type { PublishedData } from "./page";

export function rankingImage(data: PublishedData, year: string, period?: string): Promise<Response> {
  return withPublishedReaders(data, () => period === undefined
    ? YearImage({ params: Promise.resolve({ year }) })
    : PeriodImage({ params: Promise.resolve({ year, period }) }));
}
