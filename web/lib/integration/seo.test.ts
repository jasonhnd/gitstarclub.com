import { test, expect, describe, beforeAll } from "bun:test";

// Live SEO acceptance test (fetch-only, no browser) for the production site.
//
// This exercises the rendered HTML / metadata endpoints of https://www.gitstarclub.com
// against the policy in docs/SEO.md:
//   - default English URL plus localized alternates and hreflang matrix (SEO §10)
//   - English default-locale metadata, <html lang="en"> (SEO §10 / §3)
//   - per-page <title> / <meta description> / canonical-to-self + Open Graph (SEO §2 / §13)
//   - at least one valid schema.org JSON-LD block per page (SEO §6)
//   - /sitemap.xml is a sitemap index; per-locale sitemap files enumerate the long tail (SEO §4)
//   - /robots.txt is well-formed (SEO §5 / §11)
//
// Because the suite hits the network, it is opt-out via SEO_LIVE_BASE="" and tolerant of the
// site's launch state: docs/SEO.md §11 keeps the site noindex / robots `Disallow: /` until
// SITE_INDEXABLE=1 at launch. Where the live state legitimately differs from the
// fully-launched policy (robots advertising the sitemap; rankings OG image), the assertion
// stays green but the gap is surfaced via console.warn so it shows up in the run output.
//
// Run: cd web && bun test lib/integration/seo.test.ts

// Canonical host is the apex (no www); we fetch over www and follow no redirects for HTML so
// the served (pre-redirect) markup is asserted. SEO_LIVE_BASE overrides the fetch origin.
const BASE = process.env.SEO_LIVE_BASE ?? "https://www.gitstarclub.com";
// The page's *own* canonical URL is built against the apex host the site canonicalizes to.
const CANON_ORIGIN = (process.env.SEO_CANON_ORIGIN ?? "https://gitstarclub.com").replace(/\/+$/, "");

const PAGES = [
  { label: "home", path: "/", canonPath: "" },
  { label: "repo detail (/vuejs/vue)", path: "/vuejs/vue", canonPath: "/vuejs/vue" },
  { label: "month rankings (/rankings/2024/6)", path: "/rankings/2024/6", canonPath: "/rankings/2024/6" },
] as const;

const FETCH_TIMEOUT_MS = 30_000;

type Fetched = { status: number; html: string; contentType: string };

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
  const m = /\bcontent=["']([^"']*)["']/i.exec(tag);
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

/** Count of hreflang alternate links from the locale URL matrix. */
function hreflangCount(html: string): number {
  const matches = html.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhreflang=/gi);
  return matches ? matches.length : 0;
}

// --- shared fetch (one round trip per page, reused across assertions) ------------------------

const fetched = new Map<string, Fetched>();

beforeAll(async () => {
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

describe.each(PAGES)("SEO basics — $label", ({ path, canonPath }) => {
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
    // Policy: language-neutral canonical to self (SEO §2 / §7). The live site canonicalizes
    // to the apex host, so the expected canonical is apex + this page's path.
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

  test("emits a localized hreflang alternate matrix", () => {
    expect(hreflangCount(page(path).html)).toBeGreaterThanOrEqual(8);
  });
});

// --------------------------------------------------------------------------------------------
// og:image — pageMeta now emits openGraph.images + twitter on every page; repo pages keep their
// per-repo card, the rest fall back to the site OG card.
// --------------------------------------------------------------------------------------------

describe("Open Graph image (og:image)", () => {
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

describe("document language", () => {
  test("<html> declares lang=en on every page", () => {
    for (const { path } of PAGES) {
      const tag = /<html\b[^>]*>/i.exec(page(path).html)?.[0] ?? "";
      const lang = /\blang=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
      expect(lang.toLowerCase()).toBe("en");
    }
  });
});

// --------------------------------------------------------------------------------------------
// /sitemap.xml — valid XML sitemap index; /sitemap-en.xml enumerates English URLs (SEO §4).
// --------------------------------------------------------------------------------------------

describe("/sitemap.xml", () => {
  let xml = "";
  let enXml = "";
  let status = 0;
  let ctype = "";

  beforeAll(async () => {
    const r = await get("/sitemap.xml");
    xml = r.html;
    status = r.status;
    ctype = r.contentType;
    enXml = (await get("/sitemap-en.xml")).html;
  });

  test("responds 200 as XML", () => {
    expect(status).toBe(200);
    expect(ctype.toLowerCase()).toMatch(/xml/);
  });

  test("is a well-formed <sitemapindex> document", () => {
    expect(xml).toContain("<?xml");
    expect(xml).toMatch(/<sitemapindex[\s>]/);
    expect(xml).toMatch(/<\/sitemapindex>/);
  });

  test("contains one sitemap entry per supported locale", () => {
    const locs = xml.match(/<loc>/gi) ?? [];
    expect(locs.length).toBe(7);
    expect(xml).toContain(`${CANON_ORIGIN}/sitemap-en.xml`);
    expect(xml).toContain(`${CANON_ORIGIN}/sitemap-ja.xml`);
    expect(xml).toContain(`${CANON_ORIGIN}/sitemap-fr.xml`);
  });

  test("English sitemap enumerates the homepage + rankings + repo URLs", () => {
    const locUrls = [...enXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
    // homepage (apex, with or without trailing slash)
    expect(locUrls.some((u) => u === CANON_ORIGIN || u === `${CANON_ORIGIN}/`)).toBe(true);
    // a rankings month URL
    expect(locUrls).toContain(`${CANON_ORIGIN}/rankings/2024/6`);
    // a rankings year URL
    expect(locUrls).toContain(`${CANON_ORIGIN}/rankings/2024`);
    // a repo detail URL (long-tail discovery)
    expect(locUrls).toContain(`${CANON_ORIGIN}/vuejs/vue`);
  });
});

// --------------------------------------------------------------------------------------------
// /robots.txt — 200 + well-formed. Sitemap reference is gated behind launch (SEO §11):
// pre-launch the site is noindex with `Disallow: /` and no Sitemap line.
// --------------------------------------------------------------------------------------------

describe("/robots.txt", () => {
  let txt = "";
  let status = 0;

  beforeAll(async () => {
    const r = await get("/robots.txt");
    txt = r.html;
    status = r.status;
  });

  test("responds 200", () => {
    expect(status).toBe(200);
  });

  test("is a well-formed robots file (declares a User-agent)", () => {
    expect(txt).toMatch(/User-agent:/i);
  });

  test("references the sitemap once indexing is enabled (reported pre-launch)", () => {
    const launched = /^\s*Allow:\s*\/\s*$/im.test(txt) && !/^\s*Disallow:\s*\/\s*$/im.test(txt);
    if (launched) {
      // Launched policy (SITE_INDEXABLE=1): robots advertises the sitemap.
      expect(txt).toMatch(/Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/i);
    } else {
      // Pre-launch private preview (SEO §11): whole-site Disallow, no sitemap advertised.
      expect(txt).toMatch(/^\s*Disallow:\s*\/\s*$/im);
      expect(txt).not.toMatch(/Sitemap:/i);
      console.warn(
        "[SEO][state] /robots.txt is in pre-launch noindex mode (`Disallow: /`, no Sitemap line). " +
          "This is intentional per SEO §11; set SITE_INDEXABLE=1 at launch so robots advertises /sitemap.xml.",
      );
    }
  });
});
