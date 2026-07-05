export const YEAR_RANKING_PREVIEW_LIMIT = 24;
export const MONTH_RANKING_PREVIEW_LIMIT = 18;
export const WEEK_RANKING_PREVIEW_LIMIT = 32;
export const COMPLETE_RANKING_RENDER_LIMIT = 100;

export function boundedRankItems<T>(items: readonly T[], limit = COMPLETE_RANKING_RENDER_LIMIT): T[] {
  return items.slice(0, limit);
}

export function hasMoreRankItems(totalItems: number, visibleItems: number): boolean {
  return totalItems > visibleItems;
}
