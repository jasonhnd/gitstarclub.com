import { AsyncLocalStorage } from "node:async_hooks";
import { CategoryRegistry, CategoryRankList, Meta, ReposLookup } from "../../../../web/lib/contracts";
import { categoryAllTimeRankPath } from "../../../../web/lib/categories/rank-pages";
import { CATEGORY_DETAIL_PAGE_SIZE, pageCount } from "../../../../web/lib/pagination";
import type { pageData } from "../../lib/data";
export { joinRepoRank } from "../../../../web/lib/data/rank";

type Reader = Pick<ReturnType<typeof pageData>, "base">;
type RequestData = { reader: Reader; reads: Map<string, Promise<unknown>> };
const scope = new AsyncLocalStorage<RequestData>();

/** Each render uses the Worker's captured publication, including concurrent locales. */
export function withCategoryData<T>(reader: Reader, run: () => T): T {
  return scope.run({ reader, reads: new Map() }, run);
}

function read<T>(path: string, schema: { parse(value: unknown): T }): Promise<T | null> {
  const request = scope.getStore();
  if (!request) throw new Error("Category reads require a request-scoped publication.");
  if (!request.reads.has(path)) request.reads.set(path, request.reader.base(path, schema));
  return request.reads.get(path) as Promise<T | null>;
}

export const getCategoryRegistry = () => read("categories/registry.json", CategoryRegistry);
export const getMeta = () => read("meta.json", Meta);
export const getReposLookupDaily = () => read("lookup/repos.json", ReposLookup);
export const getCategoryAllTimePage = (dimension: string, slug: string, page: number) =>
  read(categoryAllTimeRankPath(dimension, slug, page), CategoryRankList);

/** Preserve the existing availability algorithm: stop at the first missing/empty page. */
export async function resolveAvailableCategoryPages(dimension: string, slug: string, totalRows: number) {
  const safeTotalRows = Math.max(0, totalRows);
  const totalPagesFromRegistry = pageCount(safeTotalRows, CATEGORY_DETAIL_PAGE_SIZE);
  if (safeTotalRows === 0) return { totalRows: safeTotalRows, availablePages: [1], totalPagesFromRegistry };
  const availablePages: number[] = [];
  for (let page = 1; page <= totalPagesFromRegistry; page++) {
    const rank = await getCategoryAllTimePage(dimension, slug, page);
    if (!rank || rank.items.length === 0) break;
    availablePages.push(page);
  }
  return { totalRows: safeTotalRows, availablePages, totalPagesFromRegistry };
}

export class CategoryNotFound extends Error {}
export function notFound(): never { throw new CategoryNotFound("Category not found"); }
