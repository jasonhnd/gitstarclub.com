import { CATEGORY_DETAIL_PAGE_SIZE } from "@/lib/pagination";

export const CATEGORY_RANK_PAGE_SIZE = CATEGORY_DETAIL_PAGE_SIZE;

export function categoryAllTimeRankPath(dimension: string, slug: string, page = 1): string {
  return page <= 1
    ? `rank/category/${dimension}/${slug}/all-time/repo/stock.json`
    : `rank/category/${dimension}/${slug}/all-time/repo/stock/page/${page}.json`;
}
