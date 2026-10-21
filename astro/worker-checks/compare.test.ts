import { expect, test } from "bun:test";
import { compareSites } from "../scripts/compare";

test("comparison detects body, metadata and JSON-LD changes without hiding them in shell mode", async () => {
  let text = "Original content as of 2026-07-17";
  let description = "Original description";
  let count = 1;
  const html = (body: string, desc: string, value: number, streamed = false) => `<html lang="en"><head><title>Example</title>${streamed ? "" : `<meta name="description" content="${desc}">`}<link rel="canonical" href="https://site.example/"><link rel="alternate" hreflang="en" href="https://site.example/"><script type="application/ld+json">{"@type":"Dataset","count":${value}}</script></head><body><header>Shared header</header><main>${body}</main><footer>Shared footer</footer>${streamed ? `<meta name="description" content="${desc}">` : ""}</body></html>`;
  const web = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html("Original content as of 2026-07-17", "Original description", 1, true), { headers: { "Content-Type": "text/html" } }) });
  const astro = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html(text, description, count), { headers: { "Content-Type": "text/html" } }) });
  try {
    text = "Changed content as of 2026-10-21";
    const strict = await compareSites({ web: web.url.origin, astro: astro.url.origin, paths: ["/"] });
    expect(strict.passed).toBe(false);
    expect(strict.results[0]?.differences).toContain("text");
    expect((await compareSites({ web: web.url.origin, astro: astro.url.origin, paths: ["/"], scope: "shell" })).passed).toBe(true);
    description = "Changed description"; count = 2;
    const facts = await compareSites({ web: web.url.origin, astro: astro.url.origin, paths: ["/"], scope: "shell" });
    expect(facts.passed).toBe(false);
    expect(facts.results[0]?.differences).toContain("meta");
    expect(facts.results[0]?.differences).toContain("jsonld");
  } finally { await web.stop(true); await astro.stop(true); }
}, 30_000);
