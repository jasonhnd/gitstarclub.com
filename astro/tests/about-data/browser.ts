import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import AxeBuilder from "../../../web/node_modules/@axe-core/playwright";
import { AboutThisDataContent, type DataLayer } from "../../src/components/AboutThisDataContent";
import { getDictionary, isLocale, LOCALES, toBcp47Locale } from "../../src/lib/i18n";
import { fixtureProps } from "./fixture";

const scratch = process.env.KANBAN_TMP;
assert.ok(scratch, "Set card-local KANBAN_TMP");
const evidence = resolve(scratch, "about-data-evidence");
mkdirSync(evidence, { recursive: true });
const assets = resolve(scratch, "astro-cloudflare/output/v0/workers/default/assets");
const css = readdirSync(resolve(assets, "_astro")).filter((file) => file.endsWith(".css"));
assert.ok(css.length, "Build Astro first");
const bundle = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../../src/components/about-this-data.ts")], target: "browser", minify: true });
assert.ok(bundle.success);
const script = await bundle.outputs[0].text();
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const dictionaries = await Promise.all(LOCALES.map(getDictionary));
const copyTable = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Issue 780 copy table</title><style>body{font:14px system-ui}table{border-collapse:collapse}td,th{padding:12px;border:1px solid #ccc;min-width:220px;vertical-align:top}</style><h1>About this data: seven-locale copy table</h1><p>Generated from the locale dictionaries. Braced fields are filled from the supplied page and publication.</p><table><thead><tr><th>Key</th>${LOCALES.map((locale) => `<th>${locale}</th>`).join("")}</tr></thead><tbody>${Object.keys(dictionaries[0].aboutData).map((key) => `<tr><th>${key}</th>${dictionaries.map((dictionary, index) => `<td lang="${toBcp47Locale(LOCALES[index])}">${escape(dictionary.aboutData[key as keyof typeof dictionary.aboutData])}</td>`).join("")}</tr>`).join("")}</tbody></table></html>`;
await Bun.write(resolve(evidence, "copy-table.html"), copyTable);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/controls.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
  if (url.pathname.startsWith("/_astro/")) {
    const file = resolve(assets, `.${url.pathname}`);
    if (!file.startsWith(`${assets}/_astro/`)) return new Response(null, { status: 404 });
    return new Response(Bun.file(file));
  }
  const locale = url.pathname.slice(1);
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  const props = await fixtureProps(locale);
  const t = props.dictionary;
  const fixtureDate = props.meta!.generated_at!.slice(0, 10);
  const layers: DataLayer[] = url.searchParams.has("all") ? ["currentTotals", "periodGains", "historyCurve"] : ["currentTotals"];
  const content = url.searchParams.has("before") ? "" : layers.map((layer) => renderToStaticMarkup(createElement(AboutThisDataContent, { ...props, layer }))).join("");
  return new Response(`<!doctype html><html lang="${toBcp47Locale(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>About this data fixture</title>${css.map((file) => `<link rel="stylesheet" href="/_astro/${file}">`).join("")}</head><body><main style="max-width:960px;margin:0 auto;padding:48px 24px"><p style="color:var(--color-on-surface-variant);font-size:12px;margin-bottom:16px">GitStarClub · Component test render · Synthetic data</p><h1 style="font-size:32px;font-weight:800;margin-bottom:16px">example/repo</h1><p>${escape(t.aboutData.dataAsOf)}: <time datetime="${fixtureDate}">${fixtureDate}</time></p>${content}<section style="margin-top:32px"><h2 style="font-size:22px;font-weight:700">${escape(t.common.faqHeading)}</h2></section></main><script type="module" src="/controls.js"></script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
} });
const context = await chromium.launchPersistentContext(mkdtempSync(resolve(scratch, "about-data-chromium-")), { headless: true, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
const errors: string[] = [];
try {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const locale of ["en", "ja"]) {
      await page.goto(`${server.url}${locale}?before`, { waitUntil: "networkidle" });
      await page.screenshot({ path: resolve(evidence, `${locale}-${width}-before.png`), fullPage: true });
      await page.goto(`${server.url}${locale}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(evidence, `${locale}-${width}-collapsed.png`), fullPage: true });
      await page.locator("summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("details").getAttribute("open"), "");
      assert.ok(await page.locator("[data-copy]").isVisible());
      await page.screenshot({ path: resolve(evidence, `${locale}-${width}-expanded.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale} ${width}: overflow`);
      const results = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) })), [], `${locale} ${width}: accessibility`);
      await page.locator("[data-copy]").click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator("[data-citation]").textContent());
      assert.equal(await page.locator("[data-copy-status]").textContent(), (await getDictionary(locale as "en" | "ja")).aboutData.copied);
      await page.locator("summary").focus();
      await page.keyboard.press("Space");
      assert.equal(await page.locator("details").getAttribute("open"), null);
    }
  }
  for (const mode of ["missing", "denied"]) {
    await page.goto(`${server.url}en?all`);
    await page.evaluate((mode) => Object.defineProperty(navigator, "clipboard", { configurable: true, value: mode === "missing" ? undefined : { writeText: () => Promise.reject(new Error("Denied")) } }), mode);
    for (let index = 0; index < 3; index++) {
      const block = page.locator("gsc-about-data").nth(index);
      await block.locator("summary").click();
      await block.locator("[data-copy]").click();
      assert.equal(await page.evaluate(() => window.getSelection()?.toString()), await block.locator("[data-citation]").textContent());
      assert.equal(await block.locator("[data-copy-status]").textContent(), dictionaries[0].aboutData.copyUnavailable);
    }
  }
  for (const locale of LOCALES) {
    await page.goto(`${server.url}${locale}?all`);
    await page.locator("summary").first().click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}: mobile overflow`);
  }
  const noScript = await context.browser()!.newContext({ javaScriptEnabled: false });
  try {
    const plain = await noScript.newPage();
    await plain.goto(`${server.url}en`);
    await plain.locator("summary").focus(); await plain.keyboard.press("Enter");
    assert.ok(await plain.locator("[data-citation]").isVisible());
    assert.equal(await plain.locator("[data-copy]").isVisible(), false);
    assert.equal(await plain.locator("details").getAttribute("open"), "");
  } finally { await noScript.close(); }
  assert.deepEqual(errors, []);
  await Bun.write(resolve(evidence, "results.json"), JSON.stringify({ passed: true, widths: [1440, 390], screenshotLocales: ["en", "ja"], copyLocales: LOCALES, checks: ["keyboard", "clipboard", "missing API", "denied permission", "multiple instances", "no JavaScript", "axe accessibility", "no overflow", "no browser errors"] }, null, 2));
  console.log(`About this data browser checks passed; evidence: ${evidence}`);
} finally { await context.close(); server.stop(true); }
