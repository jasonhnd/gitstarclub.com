import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RepairRemovalNotice } from "../../web/app/_explore/RepairRemovalNotice";
import { getDictionary } from "../../web/lib/i18n";
import { startWorker } from "../scripts/local-worker";
import { p1FixtureRecords } from "../tests/p1/fixture";

test("built notice border contrasts with its fill and matches the capsule radius in both themes", async () => {
  const worker = await startWorker(p1FixtureRecords());
  const context = await chromium.launchPersistentContext(
    mkdtempSync(resolve(process.env.KANBAN_TMP!, "notice-chromium-")), { headless: true },
  );
  try {
    const page = await context.newPage();
    await page.goto((await worker.ready).origin + "/rankings/2026/7");
    // The committed date stays disabled. Render the real component with a test date
    // into the built page so its actual shipped CSS, including theme tokens, applies.
    const markup = renderToStaticMarkup(createElement(RepairRemovalNotice, {
      window: "month", entity: "repo", period: "2026-07", locale: "en",
      copy: (await getDictionary("en")).rankings, notice: { date: "2026-10-27", count: 4 },
    }));
    await page.locator('[data-testid="answer-capsule"]').evaluate((capsule, html) => {
      capsule.insertAdjacentHTML("afterend", html);
    }, markup);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const colors = await page.locator('[data-testid="answer-capsule"]').evaluate((capsule) => {
        const strip = getComputedStyle(capsule.nextElementSibling!);
        return {
          border: strip.borderLeftColor, fill: strip.backgroundColor,
          width: strip.borderLeftWidth, radius: strip.borderRadius,
          capsuleRadius: getComputedStyle(capsule).borderRadius,
        };
      });
      expect(colors.border).not.toBe(colors.fill);
      expect(colors.width).toBe("2px");
      expect(colors.radius).toBe(colors.capsuleRadius);
      expect(colors.radius).not.toBe("0px");
    }
  } finally {
    await context.close();
    await worker.dispose();
  }
}, 30_000);
