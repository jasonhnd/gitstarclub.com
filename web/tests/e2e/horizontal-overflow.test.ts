import { expect, test } from "@playwright/test";

const viewports = [390, 360] as const;

const routes = [
  { label: "pulse", path: "/pulse" },
  { label: "rankings", path: "/rankings" },
  { label: "categories", path: "/categories" },
  { label: "repo detail", path: "/react/react" },
  { label: "org detail", path: "/o/react" },
  { label: "compare", path: "/compare?repos=react/react,vuejs/vue" },
] as const;

for (const width of viewports) {
  test.describe(`mobile width ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const route of routes) {
      test(`${route.label} has no page-level horizontal overflow`, async ({ page }) => {
        await page.goto(route.path);
        await expect(page.locator("#main")).toBeVisible();
        await page.waitForLoadState("networkidle");

        const dimensions = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        }));

        expect(
          dimensions.scrollWidth,
          `${route.path} at ${width}px produced documentElement.scrollWidth=${dimensions.scrollWidth}, window.innerWidth=${dimensions.viewportWidth}`,
        ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      });
    }
  });
}
