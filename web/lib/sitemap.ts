import { FIRST_YEAR, isoWeek } from "./periods";
import { categoryPageAvailabilityKey } from "./categories/rank-pages";
import { ORG_INDEX_PAGE_SIZE, pageCount } from "./pagination";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n";
import { localizedPath, toHreflang } from "./i18n/routing";
import { isRenderableRepoFullName } from "./repo-readiness";

type RepoLike = { full_name: string };
type CategoriesLike = {
  generated_at?: string;
  dimensions: Array<{ id: string; categories: Array<{ slug: string; count: number; sitemap?: boolean }> }>;
};
type SitemapMeta = { backfilled_at?: string; generated_at?: string; folded_through?: { month?: string; week?: string } };
type SitemapFrequency = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
export type SitemapAlternate = { hreflang: string; href: string };
export type LocaleSitemapEntry = {
  loc: string;
  lastModified: Date;
  changeFrequency: SitemapFrequency;
  priority: number;
  alternates: SitemapAlternate[];
};
export type SitemapIndexEntry = { loc: string; lastModified: Date };

export const SITEMAP_FALLBACK_LAST_MODIFIED = "2026-06-04T00:00:00.000Z";
export const DEFAULT_SITE_URL = "https://gitstarclub.com";

export function siteBaseUrl(value = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL): string {
  return value.replace(/\/+$/, "");
}

export function absoluteCanonicalUrl(path: string, base = siteBaseUrl()): string {
  const normalized = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function localizedCanonicalUrl(locale: Locale, canonicalPath: string, base = siteBaseUrl()): string {
  return absoluteCanonicalUrl(localizedPath(locale, canonicalPath), base);
}

export function localizedAlternateUrls(canonicalPath: string, base = siteBaseUrl()): SitemapAlternate[] {
  const englishUrl = localizedCanonicalUrl(DEFAULT_LOCALE, canonicalPath, base);
  return [
    { hreflang: "x-default", href: englishUrl },
    ...LOCALES.map((locale) => ({ hreflang: toHreflang(locale), href: localizedCanonicalUrl(locale, canonicalPath, base) })),
  ];
}

export function localeSitemapPath(locale: Locale): string {
  return `/sitemap-${locale}.xml`;
}

export function buildSitemapIndexEntries(lastModified: Date, base = siteBaseUrl()): SitemapIndexEntry[] {
  return LOCALES.map((locale) => ({
    loc: absoluteCanonicalUrl(localeSitemapPath(locale), base),
    lastModified,
  }));
}

export function buildLocaleSitemapEntries(
  locale: Locale,
  paths: string[],
  opts: {
    meta?: SitemapMeta | null;
    categories?: CategoriesLike | null;
    base?: string;
  } = {},
): LocaleSitemapEntry[] {
  const base = opts.base ?? siteBaseUrl();
  return paths.map((path) => ({
    loc: localizedCanonicalUrl(locale, path, base),
    alternates: localizedAlternateUrls(path, base),
    lastModified: sitemapLastModified(path, { meta: opts.meta, categories: opts.categories }),
    changeFrequency: sitemapChangeFrequency(path),
    priority: sitemapPriority(path),
  }));
}

export function buildSitemapIndexXml(entries: SitemapIndexEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.flatMap((entry) => ["  <sitemap>", `    <loc>${escapeXml(entry.loc)}</loc>`, `    <lastmod>${entry.lastModified.toISOString()}</lastmod>`, "  </sitemap>"]),
    "</sitemapindex>",
    "",
  ].join("\n");
}

export function buildSitemapXml(entries: LocaleSitemapEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.flatMap((entry) => [
      "  <url>",
      `    <loc>${escapeXml(entry.loc)}</loc>`,
      ...entry.alternates.map(
        (alternate) => `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}" />`,
      ),
      `    <lastmod>${entry.lastModified.toISOString()}</lastmod>`,
      `    <changefreq>${entry.changeFrequency}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      "  </url>",
    ]),
    "</urlset>",
    "",
  ].join("\n");
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
  meta?: SitemapMeta | null;
  renderableRepoIds?: ReadonlySet<string> | null;
  categoryPages?: Record<string, readonly number[]> | null;
} = {}): string[] {
  const now = opts.now ?? new Date();
  const paths: string[] = [
    "",
    "/pulse",
    "/rankings",
    "/categories",
    "/categories/language",
    "/compare",
    "/about",
    ...publishedRankingPeriodPaths(opts.meta, now),
  ];

  if (opts.repos) {
    for (const [id, e] of Object.entries(opts.repos)) {
      if (opts.renderableRepoIds && !opts.renderableRepoIds.has(id)) continue;
      if (!isRenderableRepoFullName(e.full_name)) continue;
      paths.push(`/${e.full_name}`);
    }
  }
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
        const availablePages = opts.categoryPages?.[categoryPageAvailabilityKey(dimension.id, category.slug)] ?? [];
        for (const page of availablePages.filter((value) => value > 1)) {
          paths.push(`/categories/${dimension.id}/${category.slug}/page/${page}`);
        }
      }
    }
  }

  return [...new Set(paths)];
}

export function publishedRankingPeriodPaths(meta?: SitemapMeta | null, now = new Date()): string[] {
  const bounds = publishedRankingBounds(meta, now);
  const paths: string[] = [];

  for (let y = FIRST_YEAR; y <= bounds.latestYear; y++) paths.push(`/rankings/${y}`);

  if (bounds.month) {
    for (let y = FIRST_YEAR; y <= bounds.month.year; y++) {
      const lastMonth = y === bounds.month.year ? bounds.month.month : 12;
      for (let m = 1; m <= lastMonth; m++) paths.push(`/rankings/${y}/${m}`);
    }
  }

  if (bounds.week) {
    for (let y = FIRST_YEAR; y <= bounds.week.year; y++) {
      const lastWeek = y === bounds.week.year ? bounds.week.week : weeksInIsoYear(y);
      for (let w = 1; w <= lastWeek; w++) paths.push(`/rankings/${y}/W${String(w).padStart(2, "0")}`);
    }
  }

  return paths;
}

function publishedRankingBounds(meta: SitemapMeta | null | undefined, now: Date): {
  latestYear: number;
  month: { year: number; month: number } | null;
  week: { year: number; week: number } | null;
} {
  const hasFoldedBounds = !!meta?.folded_through?.month || !!meta?.folded_through?.week;
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const currentWeek = isoWeek(now);
  const month = parseSitemapMonthPeriod(meta?.folded_through?.month) ?? (hasFoldedBounds ? null : currentMonth);
  const week = parseSitemapWeekPeriod(meta?.folded_through?.week) ?? (hasFoldedBounds ? null : currentWeek);
  const latestYear = Math.max(month?.year ?? FIRST_YEAR, week?.year ?? FIRST_YEAR);

  return { latestYear, month, week };
}

function parseSitemapMonthPeriod(value: string | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function parseSitemapWeekPeriod(value: string | undefined): { year: number; week: number } | null {
  const match = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value ?? "");
  if (!match) return null;
  return { year: Number(match[1]), week: Number(match[2]) };
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

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}
