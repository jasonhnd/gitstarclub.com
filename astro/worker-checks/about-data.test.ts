import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { startWorker } from "../scripts/local-worker";
import { p1FixtureRecords } from "../tests/p1/fixture";

test("home and Pulse ship Copy with the document citation; other page families do not load it", async () => {
  const worker = await startWorker(p1FixtureRecords());
  const profile = mkdtempSync(resolve(process.env.KANBAN_TMP!, "about-pages-chromium-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const origin = (await worker.ready).origin;
    for (const path of ["/", "/ja", "/pulse", "/ja/pulse"]) {
      await page.goto(origin + path);
      const disclosure = page.locator("gsc-about-data");
      expect(await disclosure.count()).toBe(1);
      await disclosure.locator("summary").click();
      const copy = disclosure.locator("[data-copy]");
      await copy.waitFor({ state: "visible" });
      const citation = await disclosure.locator("[data-citation]").textContent();
      expect(citation).toContain(await page.title());
      expect(citation).toContain(await page.locator('link[rel="canonical"]').getAttribute("href"));
      expect(await disclosure.locator('a[href$="/about#period-gains"]').count()).toBe(1);
      expect(await disclosure.locator('a[href$="/about#current-totals"]').count()).toBe(1);
      await copy.click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(citation);
    }
    for (const path of ["/rankings", "/compare", "/about"]) {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      expect(await page.locator("gsc-about-data").count()).toBe(0);
      expect(await page.evaluate(() => !!customElements.get("gsc-about-data"))).toBe(false);
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await worker.dispose();
  }
}, 30_000);
