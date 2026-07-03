import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from ".";

export type NonDefaultLocale = Exclude<Locale, typeof DEFAULT_LOCALE>;

export const NON_DEFAULT_LOCALES = LOCALES.filter((locale): locale is NonDefaultLocale => locale !== DEFAULT_LOCALE);

export const HREFLANG_BY_LOCALE: Record<Locale, string> = {
  en: "en",
  ja: "ja",
  zh: "zh-CN",
  "zh-TW": "zh-TW",
  ko: "ko",
  es: "es",
  fr: "fr",
};

export const BCP47_LOCALE_BY_LOCALE = HREFLANG_BY_LOCALE;

export const OPEN_GRAPH_LOCALE_BY_LOCALE: Record<Locale, string> = {
  en: "en_US",
  ja: "ja_JP",
  zh: "zh_CN",
  "zh-TW": "zh_TW",
  ko: "ko_KR",
  es: "es_ES",
  fr: "fr_FR",
};

export const RESERVED_LOCALIZED_TOP_LEVEL_ROUTES = ["about", "categories", "compare", "o", "privacy", "pulse", "rankings"] as const;

export type ReservedLocalizedTopLevelRoute = (typeof RESERVED_LOCALIZED_TOP_LEVEL_ROUTES)[number];

export type StripLocaleResult = {
  locale: Locale;
  path: string;
};

export type RouteClassification =
  | { kind: "root"; locale: typeof DEFAULT_LOCALE; path: "/" }
  | { kind: "localized-root"; locale: NonDefaultLocale; path: "/" }
  | { kind: "default-locale-prefix"; locale: typeof DEFAULT_LOCALE; path: string; segments: string[] }
  | { kind: "reserved-route"; locale: typeof DEFAULT_LOCALE; path: string; route: ReservedLocalizedTopLevelRoute; segments: string[] }
  | { kind: "localized-reserved-route"; locale: NonDefaultLocale; path: string; route: ReservedLocalizedTopLevelRoute; segments: string[] }
  | { kind: "repo-route"; locale: typeof DEFAULT_LOCALE; path: string; owner: string; name: string }
  | { kind: "localized-repo-route"; locale: NonDefaultLocale; path: string; owner: string; name: string }
  | { kind: "other"; locale: typeof DEFAULT_LOCALE; path: string; segments: string[] };

export function localizedPath(locale: Locale, canonicalPath: string): string {
  const { pathname, suffix } = splitPath(canonicalPath);
  if (locale === DEFAULT_LOCALE) return `${pathname}${suffix}`;
  if (pathname === "/") return `/${locale}${suffix}`;
  return `/${locale}${pathname}${suffix}`;
}

export function stripLocale(path: string): StripLocaleResult {
  const { pathname, suffix } = splitPath(path);
  const first = firstSegment(pathname);

  if (first && isNonDefaultLocale(first)) {
    return { locale: first, path: `${stripFirstSegment(pathname)}${suffix}` };
  }

  return { locale: DEFAULT_LOCALE, path: `${pathname}${suffix}` };
}

export function toHreflang(locale: Locale): string {
  return HREFLANG_BY_LOCALE[locale];
}

export const localeToHreflang = toHreflang;

export function toBcp47Locale(locale: Locale): string {
  return BCP47_LOCALE_BY_LOCALE[locale];
}

export const localeToBcp47 = toBcp47Locale;

export function toOpenGraphLocale(locale: Locale): string {
  return OPEN_GRAPH_LOCALE_BY_LOCALE[locale];
}

export const localeToOpenGraphLocale = toOpenGraphLocale;

export function isNonDefaultLocale(value: string): value is NonDefaultLocale {
  return value !== DEFAULT_LOCALE && isLocale(value);
}

export function isReservedLocalizedTopLevelRoute(value: string): value is ReservedLocalizedTopLevelRoute {
  return (RESERVED_LOCALIZED_TOP_LEVEL_ROUTES as readonly string[]).includes(value);
}

export function classifyRoute(path: string): RouteClassification {
  const { pathname } = splitPath(path);
  const segments = pathSegments(pathname);

  if (segments.length === 0) return { kind: "root", locale: DEFAULT_LOCALE, path: "/" };

  const [first, second, third] = segments;

  if (first === DEFAULT_LOCALE) {
    return { kind: "default-locale-prefix", locale: DEFAULT_LOCALE, path: pathFromSegments(segments.slice(1)), segments: segments.slice(1) };
  }

  if (isNonDefaultLocale(first)) {
    if (segments.length === 1) return { kind: "localized-root", locale: first, path: "/" };

    if (second && isReservedLocalizedTopLevelRoute(second)) {
      const localizedSegments = segments.slice(1);
      return {
        kind: "localized-reserved-route",
        locale: first,
        path: pathFromSegments(localizedSegments),
        route: second,
        segments: localizedSegments,
      };
    }

    if (segments.length === 3 && second && third) {
      return {
        kind: "localized-repo-route",
        locale: first,
        path: pathFromSegments([second, third]),
        owner: second,
        name: third,
      };
    }
  }

  if (isReservedLocalizedTopLevelRoute(first)) {
    return { kind: "reserved-route", locale: DEFAULT_LOCALE, path: pathname, route: first, segments };
  }

  if (segments.length === 2 && second) {
    return { kind: "repo-route", locale: DEFAULT_LOCALE, path: pathname, owner: first, name: second };
  }

  return { kind: "other", locale: DEFAULT_LOCALE, path: pathname, segments };
}

export const classifyPath = classifyRoute;

export function isLocalizedRoutePath(path: string): boolean {
  const classification = classifyRoute(path);
  return (
    classification.kind === "localized-root" ||
    classification.kind === "localized-reserved-route" ||
    classification.kind === "localized-repo-route"
  );
}

export function isRepoRoutePath(path: string): boolean {
  const classification = classifyRoute(path);
  return classification.kind === "repo-route" || classification.kind === "localized-repo-route";
}

function splitPath(path: string): { pathname: string; suffix: string } {
  const raw = path || "/";
  const suffixIndex = firstSuffixIndex(raw);
  const rawPathname = suffixIndex === -1 ? raw : raw.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : raw.slice(suffixIndex);
  return { pathname: withLeadingSlash(rawPathname), suffix };
}

function firstSuffixIndex(path: string): number {
  const query = path.indexOf("?");
  const hash = path.indexOf("#");
  if (query === -1) return hash;
  if (hash === -1) return query;
  return Math.min(query, hash);
}

function withLeadingSlash(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function firstSegment(pathname: string): string | null {
  return pathSegments(pathname)[0] ?? null;
}

function stripFirstSegment(pathname: string): string {
  const first = firstSegment(pathname);
  if (!first) return "/";
  return pathname.slice(first.length + 1) || "/";
}

function pathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter((segment) => segment.length > 0);
}

function pathFromSegments(segments: readonly string[]): string {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
