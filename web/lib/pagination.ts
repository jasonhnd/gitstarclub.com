export const CATEGORY_DETAIL_PAGE_SIZE = 100;
export const ORG_INDEX_PAGE_SIZE = 100;

export function pageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
}

export function parsePositivePage(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}

export function slicePage<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
