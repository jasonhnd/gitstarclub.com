import { FIRST_YEAR, isoWeek } from "./periods";
import { CATEGORY_DETAIL_PAGE_SIZE, ORG_INDEX_PAGE_SIZE, pageCount } from "./pagination";

type RepoLike = { full_name: string };
type CategoriesLike = {
  generated_at?: string;
  dimensions: Array<{ id: string; categories: Array<{ slug: string; count: number; sitemap?: boolean }> }>;
};
type SitemapMeta = { backfilled_at?: string; generated_at?: string };
type SitemapFrequency = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export const SITEMAP_FALLBACK_LAST_MODIFIED = "2026-06-04T00:00:00.000Z";
export const DEFAULT_SITE_URL = "https://gitstarclub.com";

export function siteBaseUrl(value = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL): string {
  return value.replace(/\/+$/, "");
}

export function absoluteCanonicalUrl(path: string, base = siteBaseUrl()): string {
  const normalized = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function resolveSitemapLastModified(meta?: SitemapMeta | null): Date {
  for (const value of [meta?.backfilled_at, meta?.generated_at, SITEMAP_FALLBACK_LAST_MODIFIED]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return new Date(SITEMAP_FALLBACK_LAST_MODIFIED);
}

export function sitemapLastModified(
  path: string,
  opts: {
    meta?: SitemapMeta | null;
    categories?: CategoriesLike | null;
  } = {},
): Date {
  const dataDate = resolveSitemapLastModified(opts.meta);
  const rankingDate = rankingPathLastModified(path, dataDate);
  if (rankingDate) return rankingDate;

  if (path === "/categories" || path.startsWith("/categories/")) {
    return validDate(opts.categories?.generated_at) ?? dataDate;
  }

  return dataDate;
}

export function weeksInIsoYear(year: number): number {
  return isoWeek(new Date(Date.UTC(year, 11, 28))).week;
}

export function buildSitemapPaths(opts: {
  now?: Date;
  repos?: Record<string, RepoLike> | null;
  orgs?: Record<string, unknown> | null;
  categories?: CategoriesLike | null;
} = {}): string[] {
  const now = opts.now ?? new Date();
  const curYear = now.getUTCFullYear();
  const curWeek = isoWeek(now);
  const paths: string[] = ["", "/pulse", "/rankings", "/categories", "/categories/language", "/compare", "/about"];

  for (let y = FIRST_YEAR; y <= curYear; y++) {
    paths.push(`/rankings/${y}`);
    const lastMonth = y === curYear ? now.getUTCMonth() + 1 : 12;
    for (let m = 1; m <= lastMonth; m++) paths.push(`/rankings/${y}/${m}`);
  }

  for (let y = FIRST_YEAR; y <= curYear; y++) {
    const lastWeek = y < curWeek.year ? weeksInIsoYear(y) : y === curWeek.year ? curWeek.week : 0;
    for (let w = 1; w <= lastWeek; w++) paths.push(`/rankings/${y}/W${String(w).padStart(2, "0")}`);
  }

  if (opts.repos) for (const e of Object.values(opts.repos)) paths.push(`/${e.full_name}`);
  if (opts.orgs) {
    const logins = Object.keys(opts.orgs);
    paths.push("/o");
    for (let page = 2; page <= pageCount(logins.length, ORG_INDEX_PAGE_SIZE); page++) paths.push(`/o/page/${page}`);
    for (const login of logins) paths.push(`/o/${login}`);
  }
  if (opts.categories) {
    for (const dimension of opts.categories.dimensions) {
      paths.push(`/categories/${dimension.id}`);
      for (const category of dimension.categories) {
        if (category.sitemap === false) continue;
        paths.push(`/categories/${dimension.id}/${category.slug}`);
        for (let page = 2; page <= pageCount(category.count, CATEGORY_DETAIL_PAGE_SIZE); page++) {
          paths.push(`/categories/${dimension.id}/${category.slug}/page/${page}`);
        }
      }
    }
  }

  return [...new Set(paths)];
}

export function sitemapChangeFrequency(path: string): SitemapFrequency {
  if (path === "" || path === "/pulse" || path === "/rankings") return "daily";
  if (path === "/categories" || path === "/o" || path.startsWith("/o/page/") || path.startsWith("/categories/")) return "weekly";
  if (path === "/compare" || path === "/about") return "yearly";
  if (/^\/rankings\/\d{4}(?:\/\d{1,2}|\/W\d{2})?$/.test(path)) return "monthly";
  return "monthly";
}

export function sitemapPriority(path: string): number {
  if (path === "") return 1;
  if (path === "/pulse" || path === "/rankings") return 0.9;
  if (path === "/categories" || path === "/o") return 0.8;
  if (path.startsWith("/categories/") || path.startsWith("/o/page/")) return 0.6;
  if (path.startsWith("/o/")) return 0.5;
  if (path === "/compare" || path === "/about") return 0.4;
  return 0.5;
}

function rankingPathLastModified(path: string, dataDate: Date): Date | null {
  const year = /^\/rankings\/(\d{4})$/.exec(path);
  if (year) return minDate(endOfYearUtc(Number(year[1])), dataDate);

  const month = /^\/rankings\/(\d{4})\/(\d{1,2})$/.exec(path);
  if (month) return minDate(endOfMonthUtc(Number(month[1]), Number(month[2])), dataDate);

  const week = /^\/rankings\/(\d{4})\/W(\d{2})$/.exec(path);
  if (week) return minDate(endOfIsoWeekUtc(Number(week[1]), Number(week[2])), dataDate);

  return null;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function endOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function endOfYearUtc(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
}

function endOfIsoWeekUtc(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekOneMonday = Date.UTC(year, 0, 4 - jan4Day + 1);
  return new Date(weekOneMonday + ((week - 1) * 7 + 6) * 24 * 60 * 60 * 1000 + (24 * 60 * 60 * 1000 - 1));
}
