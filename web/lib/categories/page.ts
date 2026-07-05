import type { CategoryAssignments, RankItem, RepoLookupEntry } from "@/lib/contracts";
import type { CategoryDimension } from "@/lib/categories/rules";
import { pageCount, slicePage } from "@/lib/pagination";

export interface CategoryRepositoryRow {
  owner: string;
  name: string;
  lang: string | null;
  total: number;
}

export interface CategoryRowsPageInput {
  categoryId: string;
  dimension: CategoryDimension;
  rankItems: readonly RankItem[];
  lookup: Record<string, RepoLookupEntry> | null;
  assignments: CategoryAssignments | null;
  page: number;
  pageSize: number;
  totalCountHint?: number;
}

export interface CategoryRowsPage {
  rows: CategoryRepositoryRow[];
  totalRows: number;
  totalPages: number;
  source: "rank" | "assignments" | "empty";
}

function compareCategoryRows(a: CategoryRepositoryRow, b: CategoryRepositoryRow): number {
  return b.total - a.total || `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`);
}

function rowFromLookup(id: number, value: number | undefined, lookup: Record<string, RepoLookupEntry>): CategoryRepositoryRow | null {
  const repo = lookup[String(id)];
  return repo ? { owner: repo.owner, name: repo.name, lang: repo.language, total: value ?? repo.current_stars } : null;
}

function rankRowsPage(
  rankItems: readonly RankItem[],
  lookup: Record<string, RepoLookupEntry>,
  page: number,
  pageSize: number,
): CategoryRepositoryRow[] {
  return slicePage(rankItems, page, pageSize).flatMap((item) => {
    if (item.id == null) return [];
    const row = rowFromLookup(item.id, item.value, lookup);
    return row ? [row] : [];
  });
}

interface AssignmentRowsPageInput {
  categoryId: string;
  dimension: CategoryDimension;
  lookup: Record<string, RepoLookupEntry>;
  assignments: CategoryAssignments;
  page: number;
  pageSize: number;
}

function assignmentRowsPage({ categoryId, dimension, lookup, assignments, page, pageSize }: AssignmentRowsPageInput): {
  rows: CategoryRepositoryRow[];
  totalRows: number;
} {
  const keep = Math.max(page * pageSize, pageSize);
  let totalRows = 0;
  let topRows: CategoryRepositoryRow[] = [];

  for (const [id, assignment] of Object.entries(assignments.repositories)) {
    if (!assignment[dimension].includes(categoryId)) continue;
    const repo = lookup[id];
    if (!repo) continue;

    totalRows++;
    topRows.push({ owner: repo.owner, name: repo.name, lang: repo.language, total: repo.current_stars });
    if (topRows.length > keep * 2) topRows = topRows.sort(compareCategoryRows).slice(0, keep);
  }

  topRows = topRows.sort(compareCategoryRows).slice(0, keep);
  return { rows: slicePage(topRows, page, pageSize), totalRows };
}

export function categoryRowsPage(input: CategoryRowsPageInput): CategoryRowsPage {
  const { rankItems, lookup, assignments, page, pageSize, totalCountHint } = input;
  if (!lookup) return { rows: [], totalRows: 0, totalPages: 1, source: "empty" };

  const requestedEnd = page * pageSize;
  if (rankItems.length > 0 && requestedEnd <= rankItems.length) {
    const totalRows = Math.max(rankItems.length, totalCountHint ?? 0);
    return {
      rows: rankRowsPage(rankItems, lookup, page, pageSize),
      totalRows,
      totalPages: pageCount(totalRows, pageSize),
      source: "rank",
    };
  }

  if (assignments) {
    const result = assignmentRowsPage({ ...input, lookup, assignments });
    return {
      rows: result.rows,
      totalRows: result.totalRows,
      totalPages: pageCount(result.totalRows, pageSize),
      source: "assignments",
    };
  }

  const totalRows = rankItems.length;
  return {
    rows: rankRowsPage(rankItems, lookup, page, pageSize),
    totalRows,
    totalPages: pageCount(totalRows, pageSize),
    source: totalRows > 0 ? "rank" : "empty",
  };
}
