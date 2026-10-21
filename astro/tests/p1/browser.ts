import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

export async function verifyBrowser(web: string, astro: string) {
  const context = await chromium.launchPersistentContext(resolve(process.env.KANBAN_TMP!, "p1-browser"), { headless: true, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  const geometry: unknown[] = [];
  try {
    await context.route("https://twitter.com/**", (route) => route.fulfill({ body: "Local share intent probe" }));
    const page = await context.newPage();
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/rankings", "/rankings/2026", "/rankings/2026/7", "/rankings/2026/W29"]) {
        const snapshots = [];
        for (const origin of [web, astro]) {
          await page.goto(origin + path, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          snapshots.push(await page.evaluate(() => {
            const selectors = ["header", "main", "h1", "footer", "main section", "main table", "main h2"];
            const bounds = selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))
              .filter((element) => element.getBoundingClientRect().width && element.getBoundingClientRect().height)
              .map((element, index) => { const r = element.getBoundingClientRect(); return { selector, index, x: r.x, y: r.y, width: r.width, height: r.height }; }));
            return { bounds, width: document.documentElement.scrollWidth, viewport: window.innerWidth };
          }));
        }
        const first = snapshots[0], second = snapshots[1];
        assert.equal(first.bounds.length, second.bounds.length, `${path}: visible region count`);
        const differences = first.bounds.flatMap((before, index) => {
          const after = second.bounds[index];
          return ["x", "y", "width", "height"].flatMap((axis) => {
            const delta = Math.abs(before[axis as "x"] - after[axis as "x"]);
            return delta > 2 ? [{ selector: before.selector, index: before.index, axis, before: before[axis as "x"], after: after[axis as "x"], delta }] : [];
          });
        });
        geometry.push({ path, viewport, differences, web: first, astro: second });
        assert.ok(second.width <= second.viewport, `${path}: horizontal overflow`);
      }
    }
    await page.goto(astro + "/rankings/2026/W29", { waitUntil: "networkidle" });
    await page.locator("p1-share button").first().click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), astro + "/rankings/2026/W29");
    await page.locator("p1-snippet button").first().click();
    assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes("example/repo"));
    await page.locator("p1-snippet button").nth(1).click();
    assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes("<"));
    const popupPromise = page.waitForEvent("popup");
    await page.locator("p1-share button").nth(1).click();
    const popup = await popupPromise;
    assert.ok(popup.url().startsWith("https://twitter.com/intent/tweet?"));
    await popup.close();
    console.log("P1 browser: copy page, snippet, embed and share intent passed; geometry recorded for 10 cases.");
  } finally {
    writeFileSync(resolve(process.env.KANBAN_TMP!, "p1-geometry.json"), JSON.stringify(geometry, null, 2) + "\n");
    await context.close();
  }
}
