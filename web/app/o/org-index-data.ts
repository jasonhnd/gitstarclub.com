import type { OrgLookupEntry } from "@/lib/contracts";
import { ORG_INDEX_PAGE_SIZE, pageCount, slicePage } from "@/lib/pagination";

export type OrgIndexRow = OrgLookupEntry;

export function orgIndexPath(page = 1): string {
  return page <= 1 ? "/o" : `/o/page/${page}`;
}

export function orgIndexRows(orgs: Record<string, OrgLookupEntry> | null): OrgIndexRow[] {
  return Object.values(orgs ?? {}).sort((a, b) => b.current_stars_sum - a.current_stars_sum || a.login.localeCompare(b.login));
}

export function orgIndexPageCount(total: number): number {
  return pageCount(total, ORG_INDEX_PAGE_SIZE);
}

export function orgIndexPageRows(rows: readonly OrgIndexRow[], page: number): OrgIndexRow[] {
  return slicePage(rows, page, ORG_INDEX_PAGE_SIZE);
}
