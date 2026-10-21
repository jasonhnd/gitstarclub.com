import { chromium } from "@playwright/test";
import { resolve } from "node:path";

/** Catch missing shared-component utility styles that text/metadata parity cannot see. */
export async function comparePageLayouts(web: string, astro: string) {
  const scratch = process.env.KANBAN_TMP;
  if (!scratch) throw new Error("Set KANBAN_TMP before comparing layout.");
  const context = await chromium.launchPersistentContext(resolve(scratch, "p6-layout-browser"), {
    headless: true, reducedMotion: "reduce", serviceWorkers: "block", locale: "en-US",
  });
  const results = [];
  try {
    const page = await context.newPage();
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of ["/about", "/ja/about", "/privacy"]) {
        const snapshots = [];
        for (const origin of [web, astro]) {
          await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          snapshots.push(await page.evaluate(() => Array.from(document.querySelectorAll("main,main > *,main section,main h1,main h2,main p,main dl,main dt,main dd"))
            .filter((element) => element.getBoundingClientRect().height > 0)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return { tag: element.tagName, rect: [rect.x, rect.y, rect.width, rect.height], style: [style.display, style.fontSize, style.lineHeight, style.fontWeight, style.letterSpacing, style.padding, style.margin, style.gridTemplateColumns] };
            })));
        }
        const old = snapshots[0], next = snapshots[1];
        const differences: unknown[] = [];
        if (old.length !== next.length) differences.push({ count: [old.length, next.length] });
        for (let index = 0; index < Math.min(old.length, next.length); index++) {
          const before = old[index], after = next[index];
          if (before.tag !== after.tag || JSON.stringify(before.style) !== JSON.stringify(after.style)
            || before.rect.some((value, axis) => Math.abs(value - after.rect[axis]) > 0.5)) differences.push({ index, before, after });
        }
        const passed = differences.length === 0;
        results.push({ path, width: viewport.width, passed, comparedElements: old.length, differences });
        console.log(`${passed ? "PASS" : "DIFF"} layout ${viewport.width} ${path}: ${old.length} body elements`);
      }
    }
  } finally { await context.close(); }
  await Bun.write(resolve(scratch, "p6-layout.json"), JSON.stringify(results, null, 2) + "\n");
  return results.every((result) => result.passed);
}
