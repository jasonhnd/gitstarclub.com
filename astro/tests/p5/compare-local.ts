import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSync, closeSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { strict as assert } from "node:assert";
import { chromium } from "@playwright/test";
import { startFixture } from "../../scripts/fixture";
import { startWorker } from "../../scripts/local-worker";
import { prepareWebOutput } from "../../scripts/prepare-web";
import { compareSites } from "../../scripts/compare";
import { p5Records } from "./fixtures";
import { getDictionary, LOCALES, localizedPath } from "../../src/lib/i18n";

const scratch = process.env.KANBAN_TMP;
if (!scratch || resolve(process.env.TMPDIR ?? "") !== resolve(scratch)) throw new Error("Set card-local TMPDIR and KANBAN_TMP.");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const records = p5Records();
const fixture = startFixture(records);
const env = { ...process.env, BLOB_BASE_URL: fixture.url.origin };
async function run(command: string[], directory: string) {
  const child = Bun.spawn(command, { cwd: resolve(root, directory), env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`${command.join(" ")} failed.`);
}
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let preview: ReturnType<typeof Bun.spawn> | undefined;
let gateway: ReturnType<typeof Bun.serve> | undefined;
const log = openSync(resolve(scratch, "p5-web-preview.log"), "w");
try {
  prepareWebOutput();
  {
    await run(["bun", "run", "build:pre"], "web");
    await run(["bun", "run", "build"], "astro");
  }
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No free preview port.");
  const port = address.port;
  await new Promise<void>((done, reject) => probe.close((error) => error ? reject(error) : done()));
  preview = Bun.spawn(["node", "node_modules/vite/bin/vite.js", "preview", "--mode", "pre", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: resolve(root, "web"), env, stdin: "ignore", stdout: log, stderr: log });
  const web = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${web}/.well-known/deployment`)).ok) { ready = true; break; } } catch { /* Wait only for this process. */ }
    if (preview.exitCode !== null) throw new Error("Web preview exited; see p5-web-preview.log.");
    await Bun.sleep(500);
  }
  if (!ready) throw new Error("Web preview did not become ready.");
  worker = await startWorker(records);
  const astro = (await worker.ready).origin;
  // P2/P6 own these endpoints. Delegate only their APIs to the unchanged local
  // web fixture host until those packages land; all page and island assets are Astro.
  gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const target = ["/search-index", "/repo-curve"].includes(url.pathname) ? web : astro;
    console.log(`Gateway GET ${url.pathname}${url.search}`);
    const response = await fetch(new Request(`${target}${url.pathname}${url.search}`, request), { redirect: "manual" });
    // Bun fetch decompresses the body before this local gateway forwards it.
    const headers = new Headers(response.headers);
    headers.delete("content-encoding"); headers.delete("content-length");
    const body = await response.arrayBuffer();
    console.log(`Gateway ${response.status} ${url.pathname}: ${body.byteLength} bytes`);
    return new Response(body, { status: response.status, headers });
  } });
  for (const locale of LOCALES) {
    for (const route of ["/compare", "/pulse"]) {
      const response = await fetch(`${astro}${localizedPath(locale, route)}`, { headers: { "accept-language": "en" } });
      const html = await response.text();
      assert.equal(response.status, 200, `${locale} ${route}`);
      assert.equal(html.includes('component-export="CompareClient"'), route === "/compare");
      assert.ok(html.includes('type="application/ld+json"'));
      assert.ok(html.includes("react/react"), "Seeded rows must render on the server");
    }
  }
  console.log("PASS: 14 direct Worker page/locale responses, structured data and body island boundary");
  const paths = JSON.parse(await Bun.file(new URL("./paths.json", import.meta.url)).text()) as string[];
  const report = await compareSites({ web, astro: gateway.url.origin, paths, screenshots: process.argv.includes("--screenshots") });
  const browser = await chromium.launchPersistentContext(resolve(scratch, "p5-interaction-browser"), { headless: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  try {
    const page = await browser.newPage();
    const t = await getDictionary("en");
    const path = "/compare?repos=react%2Freact%2Cvuejs%2Fvue";
    await page.goto(`${gateway.url.origin}${path}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: t.compare.modeAlign10k, exact: true }).click();
    assert.equal(await page.getByRole("button", { name: t.compare.modeAlign10k, exact: true }).getAttribute("aria-pressed"), "true");
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    await page.locator("#compare-workbench").scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({ y: scrollY, marker: performance.timeOrigin }));
    await page.getByRole("button", { name: `${t.compare.remove} vuejs/vue`, exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("repos"), "react/react");
    await page.getByRole("searchbox", { name: t.compare.pickerPlaceholder, exact: true }).fill("vue");
    await page.getByRole("button").filter({ hasText: "vuejs/vue" }).click();
    assert.equal(new URL(page.url()).searchParams.get("repos"), "react/react,vuejs/vue");
    const after = await page.evaluate(() => ({ y: scrollY, marker: performance.timeOrigin }));
    assert.equal(after.marker, before.marker); assert.equal(navigations.length, 0);
    assert.ok(Math.abs(after.y - before.y) < 2, "Selection preserves scroll");
    await page.evaluate(() => { history.pushState(null, "", "/compare?repos=nuxt%2Fnuxt"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.getByRole("button", { name: `${t.compare.remove} nuxt/nuxt`, exact: true }).waitFor();
    await page.goto(`${gateway.url.origin}/ja/compare`, { waitUntil: "networkidle" });
    const ja = await getDictionary("ja");
    await page.getByRole("searchbox", { name: ja.compare.pickerPlaceholder, exact: true }).fill("react");
    await page.getByRole("button").filter({ hasText: "react/react" }).click();
    assert.equal(new URL(page.url()).pathname, "/ja/compare");
    assert.equal(new URL(page.url()).searchParams.get("repos"), "react/react");
    console.log("PASS: hydrated comparison mode, add/remove, shareable URL, no reload/scroll, popstate and localized selection");
  } finally { await browser.close(); }
  writeFileSync(resolve(scratch, "p5-verification.json"), JSON.stringify({ directLocalePages: 14, interaction: "passed", endpointDependency: "P2 /repo-curve and P6 /search-index delegated to the same local web fixture host", parityPassed: report.passed, cases: report.results.length }, null, 2) + "\n");
  process.exitCode = report.passed ? 0 : 1;
} finally {
  await gateway?.stop(true);
  if (preview) { preview.kill(); await preview.exited; }
  await worker?.dispose(); await fixture.stop(true); closeSync(log);
}
