import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LOCALES } from "../i18n";

const webRoot = resolve(import.meta.dir, "../..");

async function runSeo(base?: string, preload?: string) {
  const child = Bun.spawn([
    process.execPath, "test", "./lib/integration/seo.test.ts",
    "--test-name-pattern", "sitemap-index acceptance|child-sitemap URL acceptance",
    ...(preload ? ["--preload", preload] : []),
  ], {
    cwd: webRoot,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      KANBAN_TMP: process.env.KANBAN_TMP,
      ...(base === undefined ? {} : { SEO_LIVE_BASE: base }),
    },
    stdout: "pipe", stderr: "pipe",
  });
  const [exit, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exit, output: out + err };
}

test("missing or blank SEO opt-in skips without any fetch", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "seo-opt-in-"));
  const guard = join(scratch, "no-fetch.ts");
  writeFileSync(guard, `const original = globalThis.fetch;
    process.on("exit", () => { globalThis.fetch = original; });
    globalThis.fetch = () => { throw new Error("Unexpected SEO network request"); };
  `);
  try {
    for (const base of [undefined, "", "   "]) {
      const result = await runSeo(base, guard);
      expect(result.exit, result.output).toBe(0);
      expect(result.output).toContain("0 fail");
      expect(result.output).toContain("skip");
      expect(result.output).not.toContain("Unexpected SEO network request");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("explicit loopback SEO opt-in tolerates slow sitemaps and still rejects missing locales", async () => {
  const canonical = "https://gitstarclub.com";
  const paths = ["/", "/rankings/2024/6", "/vuejs/vue", "/o/microsoft", "/categories/language/python"];
  // Reuse the product's locale routing, without mocking any module in this process.
  const { DEFAULT_LOCALE } = await import("../i18n");
  const { localizedPath, toHreflang } = await import("../i18n/routing");
  const url = (locale: typeof LOCALES[number], path: string) => {
    const localized = localizedPath(locale, path);
    return canonical + (localized === "/" ? "" : localized);
  };
  let incomplete = false;
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === "/sitemap.xml") {
        if (!incomplete) await Bun.sleep(5_100);
        const locales = incomplete ? LOCALES.slice(1) : LOCALES;
        return new Response(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locales.map((locale) => `<sitemap><loc>${canonical}/sitemap-${locale}.xml</loc><lastmod>2024-06-01</lastmod></sitemap>`).join("")}</sitemapindex>`, { headers: { "content-type": "application/xml" } });
      }
      const locale = LOCALES.find((candidate) => path === `/sitemap-${candidate}.xml`);
      if (locale) {
        const entries = paths.map((entry) => {
          const alternates = [{ code: "x-default", href: url(DEFAULT_LOCALE, entry) }, ...LOCALES.map((lang) => ({ code: toHreflang(lang), href: url(lang, entry) }))];
          return `<url><loc>${url(locale, entry)}</loc>${alternates.map(({ code, href }) => `<xhtml:link rel="alternate" hreflang="${code}" href="${href}" />`).join("")}</url>`;
        });
        return new Response(`<?xml version="1.0"?><urlset xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join("")}</urlset>`, { headers: { "content-type": "application/xml" } });
      }
      return new Response("fixture", { status: path.includes("999999") ? 404 : 200 });
    },
  });
  try {
    const valid = await runSeo(server.url.origin);
    expect(valid.exit, valid.output).toBe(0);
    expect(valid.output).toContain("9 pass");
    expect(requests).toContain("/sitemap.xml");
    expect(requests).toContain("/sitemap-en.xml");
    expect(requests).toContain("/sitemap-ja.xml");
    incomplete = true;
    const invalid = await runSeo(server.url.origin);
    expect(invalid.exit, invalid.output).toBe(1);
    expect(invalid.output).toContain("(fail) sitemap-index acceptance > contains the exact locale sitemap set");
  } finally {
    await server.stop(true);
  }
}, 15_000);
