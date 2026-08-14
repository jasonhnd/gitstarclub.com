import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LANG_COOKIE, isLocale, type Locale } from "./lib/i18n";
import { isNonDefaultLocale, localizedPath } from "./lib/i18n/routing";

const STATIC_ROOT_FILES = new Set([
  "/3a620d7fc7e043aa854c68841375d81b.txt",
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/favicon.png",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/llms.txt",
  "/manifest.webmanifest",
  "/og.png",
  "/robots.txt",
  "/sw.js",
]);

export function proxy(request: NextRequest) {
  const { nextUrl } = request;
  const { pathname, search } = nextUrl;

  if (shouldIgnorePath(pathname) || !isDocumentNavigation(request)) {
    return NextResponse.next();
  }

  const firstSegment = pathname.split("/").filter(Boolean)[0] ?? "";

  if (firstSegment === DEFAULT_LOCALE) {
    return redirect(request, stripDefaultLocalePrefix(pathname) + search, 308);
  }

  if (isNonDefaultLocale(firstSegment)) {
    return NextResponse.next();
  }

  const cookieLocale = request.cookies.get(LANG_COOKIE)?.value;
  if (cookieLocale && isNonDefaultLocale(cookieLocale)) {
    return redirect(request, localizedPath(cookieLocale, pathname + search), 307);
  }

  if (pathname === "/" && !request.cookies.has(LANG_COOKIE)) {
    const headerLocale = preferredLocale(request.headers.get("accept-language"));
    if (headerLocale && isNonDefaultLocale(headerLocale)) {
      return redirect(request, localizedPath(headerLocale, pathname + search), 307);
    }
  }

  return NextResponse.next();
}

export function shouldIgnorePath(pathname: string): boolean {
  if (STATIC_ROOT_FILES.has(pathname)) return true;
  if (pathname === "/search-index" || pathname.startsWith("/search-index/")) return true;
  if (pathname === "/repo-curve" || pathname.startsWith("/repo-curve/")) return true;
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/data/")
  ) {
    return true;
  }

  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0] ?? "";
  if (/^sitemap(?:-[^/]+)?\.xml$/.test(firstSegment)) return true;
  return segments.includes("opengraph-image");
}

function isDocumentNavigation(request: NextRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (isPrefetch(request.headers)) return false;

  const destination = request.headers.get("sec-fetch-dest");
  if (destination && destination !== "document" && destination !== "empty") return false;
  if (destination === "document") return true;

  const mode = request.headers.get("sec-fetch-mode");
  if (mode === "navigate") return true;

  return request.headers.get("accept")?.includes("text/html") ?? false;
}

function isPrefetch(headers: Headers): boolean {
  const purpose = headers.get("purpose")?.toLowerCase() ?? "";
  const secPurpose = headers.get("sec-purpose")?.toLowerCase() ?? "";

  return (
    headers.get("next-router-prefetch") !== null ||
    headers.get("x-middleware-prefetch") !== null ||
    purpose.includes("prefetch") ||
    secPurpose.includes("prefetch")
  );
}

function stripDefaultLocalePrefix(pathname: string): string {
  const withoutLocale = pathname.slice(DEFAULT_LOCALE.length + 1);
  return withoutLocale === "" ? "/" : withoutLocale;
}

function preferredLocale(header: string | null): Locale | null {
  if (!header) return null;

  const weightedTags = header
    .split(",")
    .map((part, index) => {
      const [rawTag, ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="))
        ?.slice(2);
      return { tag: rawTag.trim(), q: q ? Number(q) : 1, index };
    })
    .filter(({ tag, q }) => tag !== "" && Number.isFinite(q) && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { tag } of weightedTags) {
    const locale = matchLocaleTag(tag);
    if (locale) return locale;
  }

  return null;
}

function matchLocaleTag(tag: string): Locale | null {
  const normalized = tag.toLowerCase();
  if (normalized === "*") return DEFAULT_LOCALE;

  if (normalized === "zh-tw" || normalized.startsWith("zh-hant")) return "zh-TW";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh";

  const primary = normalized.split("-")[0] ?? "";
  if (isLocale(primary)) return primary;

  return null;
}

function redirect(request: NextRequest, path: string, status: 307 | 308) {
  return NextResponse.redirect(new URL(path, request.url), status);
}

// Compile-time constant so Next can skip static/API/asset traffic before
// invoking locale proxy. Document navigations still match.
export const config = {
  matcher: [
    "/((?!_next/|api/|\\.well-known/|data/|search-index|repo-curve|favicon|icon-|apple-touch-icon|robots\\.txt|sitemap|manifest\\.webmanifest|sw\\.js|llms\\.txt|og\\.png|.*\\.(?:png|ico|svg|txt|webmanifest|js|xml)$).*)",
  ],
};
