import { DEFAULT_LOCALE, LANG_COOKIE, isLocale, type Locale } from "../../../web/lib/i18n/locales";
import { classifyRoute, isNonDefaultLocale, localizedPath, stripLocale } from "../../../web/lib/i18n/routing";
import { safeInternalRedirectPath } from "../../../web/lib/route-utils";

/** Framework-independent translation of web/proxy.ts; tested against the original. */
export function negotiateLocale(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (ignoreLocale(url.pathname) || !documentNavigation(request)) return;
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (first === DEFAULT_LOCALE) return redirect(request, (url.pathname.slice(3) || "/") + url.search, 308);
  if (isNonDefaultLocale(first)) return;
  const cookie = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${LANG_COOKIE}=`));
  let locale = cookie?.slice(LANG_COOKIE.length + 1);
  let cookiePresent = cookie !== undefined;
  try { if (locale) locale = decodeURIComponent(locale); } catch { locale = undefined; cookiePresent = false; }
  if (locale && isNonDefaultLocale(locale)) return redirect(request, localizedPath(locale, url.pathname + url.search), 307);
  if (url.pathname === "/" && !cookiePresent) {
    const preferred = preferredLocale(request.headers.get("accept-language"));
    if (preferred && isNonDefaultLocale(preferred)) return redirect(request, localizedPath(preferred, "/" + url.search), 307);
  }
}

export function languageRedirect(request: Request): Response {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const locale = lang && isLocale(lang) ? lang : DEFAULT_LOCALE;
  const next = safeInternalRedirectPath(url.searchParams.get("next"), url);
  const canonical = safeInternalRedirectPath(stripLocale(next).path, url);
  let destination = new URL(localizedPath(locale, canonical), url);
  if (destination.origin !== url.origin || destination.username || destination.password) destination = new URL(localizedPath(locale, "/"), url);
  return new Response(null, { status: 307, headers: {
    Location: destination.href,
    "Set-Cookie": `${LANG_COOKIE}=${locale}; Max-Age=31536000; Path=/; Secure; SameSite=Lax`,
  } });
}

export function pageRoute(path: string): { locale: Locale; path: string } | null {
  if (/^\/(?:api|preview|_next|_astro|data|\.well-known|search-index|repo-curve)(?:\/|$)/.test(path)) return null;
  const route = classifyRoute(path);
  if (route.kind === "repo-route" && isNonDefaultLocale(path.split("/").filter(Boolean)[0] ?? "")) return null;
  if (["root", "localized-root", "repo-route", "localized-repo-route"].includes(route.kind)) return { locale: route.locale, path: route.path };
  if (route.kind !== "reserved-route" && route.kind !== "localized-reserved-route") return null;
  const valid = /^\/(?:about|privacy|pulse|compare|rankings|categories|o)$/.test(route.path)
    || /^\/rankings\/\d{4}(?:\/(?:\d{1,2}|W\d{1,2}))?$/.test(route.path)
    || /^\/categories\/[^/]+(?:\/[^/]+(?:\/page\/[1-9]\d*)?)?$/.test(route.path)
    || /^\/o\/(?:page\/[1-9]\d*|[^/]+)$/.test(route.path);
  return valid ? { locale: route.locale, path: route.path } : null;
}

function redirect(request: Request, path: string, status: number): Response {
  return new Response(null, { status, headers: { Location: new URL(path, request.url).href } });
}

function documentNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (["next-router-prefetch", "x-middleware-prefetch"].some((name) => request.headers.has(name))
    || ["purpose", "sec-purpose"].some((name) => request.headers.get(name)?.toLowerCase().includes("prefetch"))) return false;
  const destination = request.headers.get("sec-fetch-dest");
  if (destination && destination !== "document" && destination !== "empty") return false;
  return destination === "document" || request.headers.get("sec-fetch-mode") === "navigate" || (request.headers.get("accept")?.includes("text/html") ?? false);
}

const staticFiles = new Set(["/3a620d7fc7e043aa854c68841375d81b.txt", "/apple-touch-icon.png", "/favicon.ico", "/favicon.png", "/favicon.svg",
  "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/llms.txt", "/manifest.webmanifest", "/og.png", "/robots.txt", "/sw.js"]);
function ignoreLocale(path: string): boolean {
  if (staticFiles.has(path) || /^\/(?:search-index|repo-curve|cockpit|api)(?:\/|$)/.test(path)
    || /^\/(?:_next|_astro|\.well-known|data)\//.test(path)) return true;
  const segments = path.split("/").filter(Boolean);
  return /^sitemap(?:-[^/]+)?\.xml$/.test(segments[0] ?? "") || segments.includes("opengraph-image");
}

function preferredLocale(header: string | null): Locale | null {
  if (!header) return null;
  const weighted = header.split(",").map((part, index) => {
    const [raw = "", ...params] = part.trim().split(";");
    const q = params.map((value) => value.trim()).find((value) => value.startsWith("q="))?.slice(2);
    return { tag: raw.trim().toLowerCase(), q: q ? Number(q) : 1, index };
  }).filter(({ tag, q }) => tag !== "" && Number.isFinite(q) && q > 0).sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of weighted) {
    if (tag === "*") return DEFAULT_LOCALE;
    if (tag === "zh-tw" || tag.startsWith("zh-hant")) return "zh-TW";
    if (tag === "zh" || tag.startsWith("zh-")) return "zh";
    const primary = tag.split("-")[0] ?? "";
    if (isLocale(primary)) return primary;
  }
  return null;
}
