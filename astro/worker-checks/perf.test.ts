import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { samplePage, scriptSize } from "../scripts/perf-metrics";

test("browser collector includes dynamic imports and executable inline JS once, rejects missing scripts", async () => {
  const module = 'import "./shared.js"; import("./shared.js");';
  const shared = 'window.perfProbe = true;';
  const inline = 'window.inlineProbe = true;';
  let broken = false;
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith(".js")) return new Response(path === "/entry.js" ? module : shared, { status: broken ? 404 : 200, headers: { "content-type": "text/javascript" } });
    return new Response(`<html><head><script type="application/ld+json">{"name":"excluded"}</script><script>${inline}</script><script type="module" src="/entry.js"></script></head><body><main><h1>Paint probe</h1><astro-island client="load" component-url="/entry.js"></astro-island></main></body></html>`, { headers: { "content-type": "text/html" } });
  } });
  const profile = await chromium.launchPersistentContext(resolve(process.env.KANBAN_TMP!, "perf-test-browser"), { headless: true });
  try {
    const result = await samplePage(profile.browser()!, fixture.url.origin, "/");
    const expected = [scriptSize("/entry.js", new TextEncoder().encode(module)), scriptSize("/shared.js", new TextEncoder().encode(shared)), scriptSize("inline:0", new TextEncoder().encode(inline))];
    expect(result.scripts).toEqual(expected);
    expect(result.bytes).toBe(expected.reduce((sum, s) => sum + s.bytes, 0));
    expect(result.gzip).toBe(expected.reduce((sum, s) => sum + s.gzip, 0));
    expect(result.islandScripts).toBe(1);
    expect(result.fcp).toBeGreaterThan(0);
    expect(result.lcp).toBeGreaterThan(0);
    broken = true;
    await expect(samplePage(profile.browser()!, fixture.url.origin, "/")).rejects.toThrow("Script HTTP 404");
  } finally { await profile.close(); await fixture.stop(true); }
}, 30_000);
