import { test, expect, describe, beforeAll } from "bun:test";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../i18n";
import { localizedPath, stripLocale, toHreflang } from "../i18n/routing";

// Live SEO acceptance test (fetch-only, no browser) for the production site.
//
// This exercises rendered HTML / metadata and sitemap endpoints against docs/SEO.md:
//   - self-referential locale canonicals plus the complete hreflang matrix (SEO §10)
//   - English default-locale metadata and <html lang="en"> on unprefixed routes (SEO §10 / §3)
//   - per-page <title> / <meta description> / canonical-to-self + Open Graph (SEO §2 / §13)
//   - at least one valid schema.org JSON-LD block per page (SEO §6)
//   - /sitemap.xml indexes per-locale URL sets, which enumerate the long tail (SEO §4)
//   - preview remains noindex while production is indexable (SEO §5 / §11)
//
// Because the suite hits the network, it is opt-out via SEO_LIVE_BASE="". Set
// SEO_EXPECT_INDEXABLE=0 for preview or =1 for production; when omitted, the suite infers the
// expectation by comparing SEO_LIVE_BASE with SEO_CANON_ORIGIN.
//
// Run: cd web && bun test lib/integration/seo.test.ts

// Canonical host is the apex (no www); we fetch over www and follow no redirects for HTML so
// the served (pre-redirect) markup is asserted. SEO_LIVE_BASE overrides the fetch origin.
const BASE = process.env.SEO_LIVE_BASE ?? "https://www.gitstarclub.com";
const LIVE_SEO_ENABLED = BASE.trim().length > 0;
const describeLive = LIVE_SEO_ENABLED ? describe : describe.skip;
// The page's *own* canonical URL is built against the apex host the site canonicalizes to.
const CANON_ORIGIN = (process.env.SEO_CANON_ORIGIN ?? "https://gitstarclub.com").replace(/\/+$/, "");
const EXPECT_INDEXABLE = expectedIndexable();
const describePreview = LIVE_SEO_ENABLED && !EXPECT_INDEXABLE ? describe : describe.skip;
const describeProduction = LIVE_SEO_ENABLED && EXPECT_INDEXABLE ? describe : describe.skip;

const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
if (!NON_DEFAULT_LOCALE) throw new Error("live SEO acceptance requires at least one non-default locale");
const CHILD_SITEMAP_LOCALES: Locale[] = [DEFAULT_LOCALE, NON_DEFAULT_LOCALE];
const EXPECTED_HREFLANGS = ["x-default", ...LOCALES.map(toHreflang)];

type SeoPage = { label: string; path: string; canonPath: string };

const PAGES: SeoPage[] = [
  { label: "home", path: "/", canonPath: "" },
  { label: "repo detail (/vuejs/vue)", path: "/vuejs/vue", canonPath: "/vuejs/vue" },
  { label: "month rankings (/rankings/2024/6)", path: "/rankings/2024/6", canonPath: "/rankings/2024/6" },
];

const FETCH_TIMEOUT_MS = 30_000;

type Fetched = { status: number; html: string; contentType: string };

function expectedIndexable(): boolean {
  const configured = process.env.SEO_EXPECT_INDEXABLE;
  if (configured !== undefined && configured !== "0" && configured !== "1") {
    throw new Error("SEO_EXPECT_INDEXABLE must be either 0 or 1");
  }
  if (configured !== undefined) return configured === "1";
  if (!LIVE_SEO_ENABLED) return false;

  const liveHost = new URL(BASE).hostname.replace(/^www\./, "");
  const canonicalHost = new URL(CANON_ORIGIN).hostname.replace(/^www\./, "");
  return liveHost === canonicalHost;
}

async function get(path: string): Promise<Fetched> {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "gitstarclub-seo-acceptance/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // A canonicalization redirect (www -> apex, trailing slash, etc.) still resolves to the same
  // page; follow it once so we assert on the real document rather than a 3xx shell.
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const next = await fetch(loc.startsWith("http") ? loc : `${BASE}${loc}`, {
        redirect: "follow",
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": "gitstarclub-seo-acceptance/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return { status: next.status, html: await next.text(), contentType: next.headers.get("content-type") ?? "" };
    }
  }
  return { status: res.status, html: await res.text(), contentType: res.headers.get("content-type") ?? "" };
}

// --- tiny HTML extractors (attribute-order tolerant; case-insensitive) ----------------------

/** Inner text of the first <title>…</title>. */
function title(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].trim() : null;
}

/** content="" of the first <meta name="<n>">, regardless of attribute order. */
function metaName(html: string, name: string): string | null {
  const tag = new RegExp(`<meta\\b[^>]*\\bname=["']${name}["'][^>]*>`, "i").exec(html)?.[0];
  return tag ? content(tag) : null;
}

/** content="" of the first <meta property="<p>"> (Open Graph), regardless of attribute order. */
function metaProp(html: string, prop: string): string | null {
  const tag = new RegExp(`<meta\\b[^>]*\\bproperty=["']${prop}["'][^>]*>`, "i").exec(html)?.[0];
  return tag ? content(tag) : null;
}

/** href of <link rel="canonical">, regardless of attribute order. */
function canonical(html: string): string | null {
  const tag = /<link\b[^>]*\brel=["']canonical["'][^>]*>/i.exec(html)?.[0];
  if (!tag) return null;
  const m = /\bhref=["']([^"']*)["']/i.exec(tag);
  return m ? m[1] : null;
}

function content(tag: string): string | null {
  return attribute(tag, "content");
}

function attribute(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1] : null;
}

/** Raw inner JSON of every <script type="application/ld+json"> block on the page. */
function ldJsonBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim());
  return out;
}

type AlternateLink = { hreflang: string; href: string };

/** hreflang alternate links from HTML or xhtml-prefixed sitemap markup. */
function alternateLinks(markup: string): AlternateLink[] {
  const tags = markup.match(/<(?:[a-z][\w.-]*:)?link\b[^>]*>/gi) ?? [];
  return tags.flatMap((tag) => {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const hreflang = attribute(tag, "hreflang");
    const href = attribute(tag, "href");
    return rel.includes("alternate") && hreflang && href ? [{ hreflang, href }] : [];
  });
}

function expectedAlternates(canonicalPath: string): AlternateLink[] {
  const englishHref = canonicalUrl(localizedPath(DEFAULT_LOCALE, canonicalPath));
  return [
    { hreflang: "x-default", href: englishHref },
    ...LOCALES.map((locale) => ({ hreflang: toHreflang(locale), href: canonicalUrl(localizedPath(locale, canonicalPath)) })),
  ];
}

function canonicalUrl(path: string): string {
  return path === "" || path === "/" ? CANON_ORIGIN : `${CANON_ORIGIN}${path}`;
}

function assertAlternateMatrix(actual: AlternateLink[], canonicalPath: string): void {
  const expected = expectedAlternates(canonicalPath);
  const codes = actual.map(({ hreflang }) => hreflang);
  expect([...codes].sort()).toEqual([...EXPECTED_HREFLANGS].sort());
  expect(new Set(codes).size).toBe(codes.length);
  expect(Object.fromEntries(actual.map(({ hreflang, href }) => [hreflang, href]))).toEqual(
    Object.fromEntries(expected.map(({ hreflang, href }) => [hreflang, href])),
  );

  // x-default intentionally aliases the unprefixed English URL. Locale-specific hrefs must
  // otherwise remain unique so two languages never claim the same localized route.
  const localizedHrefs = actual.filter(({ hreflang }) => hreflang !== "x-default").map(({ href }) => href);
  expect(new Set(localizedHrefs).size).toBe(localizedHrefs.length);
}

function locUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => decodeXml(match[1].trim()));
}

function xmlBlocks(xml: string, name: "sitemap" | "url"): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "gi"))].map((match) => match[1]);
}

function assertXmlShape(xml: string, root: "sitemapindex" | "urlset", item: "sitemap" | "url"): void {
  const blocks = xmlBlocks(xml, item);
  expect(xml.trimStart()).toMatch(/^<\?xml\s[^>]*\?>/i);
  expect(xml.match(new RegExp(`<${root}\\b`, "gi"))?.length ?? 0).toBe(1);
  expect(xml.match(new RegExp(`<\\/${root}>`, "gi"))?.length ?? 0).toBe(1);
  expect(xml.match(new RegExp(`<${item}>`, "gi"))?.length ?? 0).toBe(blocks.length);
  expect(xml.match(new RegExp(`<\\/${item}>`, "gi"))?.length ?? 0).toBe(blocks.length);
  expect(blocks.every((block) => locUrls(block).length === 1)).toBe(true);
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function urlBlock(xml: string, expectedLoc: string): string {
  const block = xmlBlocks(xml, "url").find((candidate) => locUrls(candidate)[0] === expectedLoc);
  if (!block) throw new Error(`sitemap entry not found: ${expectedLoc}`);
  return block;
}

function hasFutureRankingPeriod(url: string, now = new Date()): boolean {
  const path = stripLocale(new URL(url).pathname).path;
  const match = /^\/rankings\/(\d{4})(?:\/(\d{1,2})|\/W(\d{2}))?$/.exec(path);
  if (!match) return false;

  const year = Number(match[1]);
  if (match[2]) {
    const month = Number(match[2]);
    return Date.UTC(year, month - 1, 1) > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  }
  if (match[3]) return isoWeekStartUtc(year, Number(match[3])) > isoWeekStartUtc(...currentIsoWeek(now));
  return year > now.getUTCFullYear();
}

function currentIsoWeek(date: Date): [number, number] {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const year = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  return [year, Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)];
}

function isoWeekStartUtc(year: number, week: number): number {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  return Date.UTC(year, 0, 4 - jan4Day + 1 + (week - 1) * 7);
}

// --- shared fetch (one round trip per page, reused across assertions) ------------------------

const fetched = new Map<string, Fetched>();

beforeAll(async () => {
  if (!LIVE_SEO_ENABLED) return;

  await Promise.all(
    PAGES.map(async (p) => {
      fetched.set(p.path, await get(p.path));
    }),
  );
});

const page = (path: string): Fetched => {
  const f = fetched.get(path);
  if (!f) throw new Error(`page not fetched: ${path}`);
  return f;
};

// --------------------------------------------------------------------------------------------
// Per-page metadata: title / description / canonical-to-self / Open Graph / JSON-LD
// --------------------------------------------------------------------------------------------

describeLive.each(PAGES)("rendered metadata acceptance — $label", ({ path, canonPath }) => {
  test("responds 200 with HTML", () => {
    const p = page(path);
    expect(p.status).toBe(200);
    expect(p.contentType.toLowerCase()).toContain("text/html");
  });

  test("has a non-empty <title>", () => {
    const t = title(page(path).html);
    expect(t).toBeTruthy();
    expect((t ?? "").length).toBeGreaterThan(0);
  });

  test("has a non-empty <meta name=description>", () => {
    const d = metaName(page(path).html, "description");
    expect(d).toBeTruthy();
    expect((d ?? "").length).toBeGreaterThan(0);
  });

  test("has <link rel=canonical> pointing at this page's own URL", () => {
    const c = canonical(page(path).html);
    expect(c).toBeTruthy();
    // English routes are unprefixed and canonicalize to the production origin in every environment.
    expect(c).toBe(`${CANON_ORIGIN}${canonPath}`);
  });

  test("has Open Graph og:title and og:description", () => {
    const html = page(path).html;
    expect(metaProp(html, "og:title")).toBeTruthy();
    expect(metaProp(html, "og:description")).toBeTruthy();
  });

  test("og:url is the canonical self URL", () => {
    expect(metaProp(page(path).html, "og:url")).toBe(`${CANON_ORIGIN}${canonPath}`);
  });

  test("has at least one valid (parseable) JSON-LD block", () => {
    const blocks = ldJsonBlocks(page(path).html);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    for (const raw of blocks) {
      // Must be valid JSON (SEO §6 — server-rendered structured data).
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed).toBeTruthy();
      expect(parsed["@context"]).toBeDefined();
    }
  });
});

describeLive.each(PAGES)("hreflang matrix acceptance — $label", ({ path, canonPath }) => {
  test("emits the exact locale matrix for the same logical page", () => {
    assertAlternateMatrix(alternateLinks(page(path).html), canonPath || "/");
  });

  test("keeps the rendered locale canonical self-referential", () => {
    expect(canonical(page(path).html)).toBe(canonicalUrl(canonPath));
  });
});

// --------------------------------------------------------------------------------------------
// og:image — pageMeta now emits openGraph.images + twitter on every page; repo pages keep their
// per-repo card, the rest fall back to the site OG card.
// --------------------------------------------------------------------------------------------

describeLive("Open Graph image (og:image)", () => {
  test("home and repo pages expose an absolute og:image", () => {
    for (const path of ["/", "/vuejs/vue"]) {
      const img = metaProp(page(path).html, "og:image");
      expect(img).toBeTruthy();
      expect(img).toMatch(/^https?:\/\//);
    }
  });

  test("rankings page exposes an absolute og:image + twitter:image", async () => {
    // cache-bust: on-demand ISR pages can briefly serve a pre-deploy copy from the edge cache.
    const { html } = await get(`/rankings/2024/6?v=${Date.now()}`);
    const og = metaProp(html, "og:image");
    expect(og).toBeTruthy();
    expect(og).toMatch(/^https?:\/\//);
    expect(metaName(html, "twitter:image")).toMatch(/^https?:\/\//);
  });
});

// --------------------------------------------------------------------------------------------
// <html lang="en"> — default-locale static (SEO §10 / §3).
// --------------------------------------------------------------------------------------------

describeLive("document language", () => {
  test("<html> declares lang=en on every page", () => {
    for (const { path } of PAGES) {
      const tag = /<html\b[^>]*>/i.exec(page(path).html)?.[0] ?? "";
      const lang = /\blang=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
      expect(lang.toLowerCase()).toBe("en");
    }
  });
});

// --------------------------------------------------------------------------------------------
// /sitemap.xml — sitemap index containing exactly one child per supported locale (SEO §4).
// --------------------------------------------------------------------------------------------

describeLive("sitemap-index acceptance", () => {
  let xml = "";
  let status = 0;
  let ctype = "";

  beforeAll(async () => {
    const r = await get("/sitemap.xml");
    xml = r.html;
    status = r.status;
    ctype = r.contentType;
  });

  test("responds 200 as XML", () => {
    expect(status).toBe(200);
    expect(ctype.toLowerCase()).toMatch(/xml/);
  });

  test("is a structurally complete <sitemapindex> document", () => {
    assertXmlShape(xml, "sitemapindex", "sitemap");
    expect(xml).toMatch(/<sitemapindex\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i);
    expect(xml).not.toMatch(/<urlset[\s>]/i);
  });

  test("contains the exact locale sitemap set without duplicate locations", () => {
    const actual = locUrls(xml);
    const expected = LOCALES.map((locale) => `${CANON_ORIGIN}/sitemap-${locale}.xml`);
    expect([...actual].sort()).toEqual([...expected].sort());
    expect(new Set(actual).size).toBe(actual.length);
    expect(xmlBlocks(xml, "sitemap").every((block) => locUrls(block).length === 1 && /<lastmod>[^<]+<\/lastmod>/i.test(block))).toBe(true);
  });
});

// --------------------------------------------------------------------------------------------
// Child locale sitemaps — URL sets own long-tail discovery and hreflang alternates (SEO §4).
// --------------------------------------------------------------------------------------------

const childSitemaps = new Map<Locale, Fetched>();
const REPRESENTATIVE_SITEMAP_PATHS = [
  { label: "core", path: "/" },
  { label: "ranking", path: "/rankings/2024/6" },
  { label: "repository", path: "/vuejs/vue" },
  { label: "organization", path: "/o/microsoft" },
  { label: "category", path: "/categories/language/python" },
] as const;
const UNAVAILABLE_CATEGORY_PATH = "/categories/language/python/page/999999";

describeLive("child-sitemap URL acceptance", () => {
  beforeAll(async () => {
    const results = await Promise.all(
      CHILD_SITEMAP_LOCALES.map(async (locale) => [locale, await get(`/sitemap-${locale}.xml`)] as const),
    );
    for (const [locale, result] of results) childSitemaps.set(locale, result);
  });

  test.each(CHILD_SITEMAP_LOCALES)("sitemap-%s.xml is a complete XML urlset", (locale) => {
    const sitemap = childSitemaps.get(locale);
    if (!sitemap) throw new Error(`child sitemap not fetched: ${locale}`);
    expect(sitemap.status).toBe(200);
    expect(sitemap.contentType.toLowerCase()).toMatch(/xml/);
    assertXmlShape(sitemap.html, "urlset", "url");
    expect(sitemap.html).toMatch(/<urlset\b[^>]*xmlns:xhtml=["']http:\/\/www\.w3\.org\/1999\/xhtml["']/i);
  });

  test.each(CHILD_SITEMAP_LOCALES)("sitemap-%s.xml contains representative localized long-tail URLs", (locale) => {
    const xml = childSitemaps.get(locale)?.html ?? "";
    const locations = locUrls(xml);

    for (const { label, path } of REPRESENTATIVE_SITEMAP_PATHS) {
      const expectedLoc = canonicalUrl(localizedPath(locale, path));
      expect(locations, `${label} URL missing from sitemap-${locale}.xml`).toContain(expectedLoc);
      assertAlternateMatrix(alternateLinks(urlBlock(xml, expectedLoc)), path);
    }
  });

  test.each(CHILD_SITEMAP_LOCALES)("sitemap-%s.xml has no duplicate locations, future rankings, or unavailable category pages", async (locale) => {
    const locations = locUrls(childSitemaps.get(locale)?.html ?? "");
    const unavailablePath = localizedPath(locale, UNAVAILABLE_CATEGORY_PATH);
    const unavailablePage = await get(unavailablePath);
    expect(new Set(locations).size).toBe(locations.length);
    expect(locations.filter((url) => hasFutureRankingPeriod(url))).toEqual([]);
    expect(unavailablePage.status).toBe(404);
    expect(locations).not.toContain(canonicalUrl(unavailablePath));
  });
});

// --------------------------------------------------------------------------------------------
// Preview and production indexing policies are intentionally different (SEO §5 / §11).
// --------------------------------------------------------------------------------------------

type RobotsResponse = { txt: string; status: number };
let robotsResponse: RobotsResponse = { txt: "", status: 0 };

beforeAll(async () => {
  if (!LIVE_SEO_ENABLED) return;
  const result = await get("/robots.txt");
  robotsResponse = { txt: result.html, status: result.status };
});

describeLive("robots endpoint acceptance", () => {
  test("responds 200 with a declared user agent", () => {
    expect(robotsResponse.status).toBe(200);
    expect(robotsResponse.txt).toMatch(/User-agent:/i);
  });
});

describePreview("preview robots policy", () => {
  test("rendered pages remain noindex, nofollow with production canonicals", () => {
    for (const { path, canonPath } of PAGES) {
      const directives = new Set((metaName(page(path).html, "robots") ?? "").toLowerCase().split(/\s*,\s*/));
      expect(directives.has("noindex")).toBe(true);
      expect(directives.has("nofollow")).toBe(true);
      expect(canonical(page(path).html)).toBe(canonicalUrl(canonPath));
    }
  });

  test("robots.txt disallows crawling and does not advertise a sitemap", () => {
    expect(robotsResponse.txt).toMatch(/^\s*Disallow:\s*\/\s*$/im);
    expect(robotsResponse.txt).not.toMatch(/^\s*Sitemap:/im);
  });
});

describeProduction("production robots policy", () => {
  test("rendered pages are indexable with self-referential production canonicals", () => {
    for (const { path, canonPath } of PAGES) {
      const directives = new Set((metaName(page(path).html, "robots") ?? "").toLowerCase().split(/\s*,\s*/));
      expect(directives.has("index")).toBe(true);
      expect(directives.has("follow")).toBe(true);
      expect(directives.has("noindex")).toBe(false);
      expect(directives.has("nofollow")).toBe(false);
      expect(canonical(page(path).html)).toBe(canonicalUrl(canonPath));
    }
  });

  test("robots.txt allows crawling and advertises the root sitemap", () => {
    expect(robotsResponse.txt).toMatch(/^\s*Allow:\s*\/\s*$/im);
    expect(robotsResponse.txt).not.toMatch(/^\s*Disallow:\s*\/\s*$/im);
    expect(robotsResponse.txt).toMatch(new RegExp(`^\\s*Sitemap:\\s*${CANON_ORIGIN.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\/sitemap\\.xml\\s*$`, "im"));
  });
});
