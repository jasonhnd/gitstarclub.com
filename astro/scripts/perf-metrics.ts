import { gzipSync } from "node:zlib";
import type { Browser } from "@playwright/test";
import { loopbackOrigin } from "./compare";

export type ScriptSize = { name: string; bytes: number; gzip: number };
export type PageSample = {
  bytes: number; gzip: number; scripts: ScriptSize[]; islandScripts: number | null;
  islandInstances: number; fcp: number; lcp: number;
};
export function scriptSize(name: string, body: Uint8Array): ScriptSize {
  return { name, bytes: body.byteLength, gzip: gzipSync(body, { level: 9 }).byteLength };
}
export function median(values: number[]): number {
  if (!values.length || values.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("Expected finite nonnegative measurements");
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}
export function summarize(samples: PageSample[]) {
  if (samples.length < 5) throw new Error("At least five cold-browser runs are required");
  // Sizes/entries must be stable; a missing hydration request must never improve a budget.
  const signature = (sample: PageSample) => JSON.stringify([sample.scripts, sample.islandScripts, sample.islandInstances]);
  if (samples.some((sample) => signature(sample) !== signature(samples[0]))) throw new Error("Script inventory changed across runs");
  return { ...samples[0], fcp: median(samples.map((s) => s.fcp)), lcp: median(samples.map((s) => s.lcp)), runs: samples.length };
}
export function budgetFailures(web: Pick<PageSample, "bytes" | "gzip" | "fcp">, astro: Pick<PageSample, "bytes" | "gzip" | "fcp">): string[] {
  const failures: string[] = [];
  if (astro.gzip > web.gzip) failures.push(`gzip JS ${astro.gzip} > ${web.gzip} bytes`);
  if (astro.bytes > web.bytes) failures.push(`decoded JS ${astro.bytes} > ${web.bytes} bytes`);
  const tolerance = Math.max(20, web.fcp * 0.1);
  if (astro.fcp > web.fcp + tolerance) failures.push(`FCP ${astro.fcp} > ${web.fcp} + ${tolerance} ms noise tolerance`);
  return failures;
}

/** Initial load only, no gestures. Fresh context and disabled HTTP cache per sample. */
export async function samplePage(browser: Browser, originValue: string, path: string): Promise<PageSample> {
  const origin = loopbackOrigin(originValue);
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Expected internal page path");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US", serviceWorkers: "block" });
  const errors: string[] = [];
  const scripts = new Map<string, ScriptSize>();
  const pending: Promise<void>[] = [];
  try {
    // Keep both hosts entirely offline, including remote avatar images/telemetry.
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.resourceType() === "script" && new URL(request.url()).origin === origin) errors.push(`Failed script ${request.url()}`);
    });
    page.on("response", (response) => {
      const request = response.request();
      if (request.resourceType() !== "script" && !/javascript/.test(response.headers()["content-type"] ?? "")) return;
      pending.push((async () => {
        if (!response.ok()) throw new Error(`Script HTTP ${response.status()}: ${response.url()}`);
        const url = new URL(response.url());
        if (url.origin !== origin) throw new Error(`Nonlocal script ${url.href}`);
        scripts.set(url.pathname + url.search, scriptSize(url.pathname + url.search, await response.body()));
      })().catch((error) => { errors.push(String(error)); }));
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.addInitScript(() => {
      const state = { lcp: 0 };
      Object.assign(window, { __gscPerf: state });
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) state.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
    if (!response || response.status() !== 200) throw new Error(`Page ${path}: HTTP ${response?.status()}`);
    if (new URL(page.url()).pathname !== path) throw new Error(`Unexpected redirect for ${path}`);
    const html = await response.text();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    const state = await page.evaluate((source) => {
      const initial = new DOMParser().parseFromString(source, "text/html");
      const inline = [...initial.scripts].filter((s) => !s.src && (!s.type || /^(?:module|(?:text|application)\/(?:java|ecma)script)$/.test(s.type))).map((s) => s.textContent ?? "");
      const islands = [...document.querySelectorAll("astro-island[client]")];
      if (islands.some((island) => island.hasAttribute("ssr"))) throw new Error("An interactive island did not hydrate");
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
      const lcp = (window as unknown as { __gscPerf: { lcp: number } }).__gscPerf.lcp;
      if (!document.querySelector("main") || fcp <= 0 || lcp <= 0) throw new Error("Missing page content or paint measurements");
      return { inline, islandScripts: islands.length ? new Set(islands.map((i) => i.getAttribute("component-url"))).size : null, islandInstances: islands.length, fcp, lcp };
    }, html);
    await Promise.all(pending);
    if (errors.length) throw new Error(errors.join("\n"));
    state.inline.forEach((body, index) => scripts.set(`inline:${index}`, scriptSize(`inline:${index}`, new TextEncoder().encode(body))));
    const inventory = [...scripts.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { bytes: inventory.reduce((sum, s) => sum + s.bytes, 0), gzip: inventory.reduce((sum, s) => sum + s.gzip, 0), scripts: inventory,
      islandScripts: state.islandScripts, islandInstances: state.islandInstances, fcp: state.fcp, lcp: state.lcp };
  } finally { await context.close(); }
}
