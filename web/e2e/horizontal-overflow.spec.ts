import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "390px", width: 390, height: 1000 },
  { label: "360px", width: 360, height: 1000 },
] as const;

const ROUTES = [
  { label: "pulse", path: "/pulse" },
  { label: "rankings", path: "/rankings" },
  { label: "categories", path: "/categories" },
  { label: "repo detail", path: "/facebook/react" },
  { label: "org detail", path: "/o/vercel" },
  { label: "compare", path: "/compare" },
] as const;

test.describe("responsive horizontal overflow", () => {
  for (const viewport of VIEWPORTS) {
    test.describe(viewport.label, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const route of ROUTES) {
        test(`${route.label} does not overflow horizontally`, async ({ page }) => {
          const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
          expect(response, `No response for ${route.path}`).not.toBeNull();
          expect(response!.status(), `${route.path} returned ${response!.status()}`).toBeLessThan(400);

          await expect(page.locator("main")).toBeVisible();
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));

          const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
          }));

          expect(
            overflow.scrollWidth,
            `${route.path} document width ${overflow.scrollWidth}px exceeds viewport ${overflow.viewportWidth}px`,
          ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
        });
      }
    });
  }
});
