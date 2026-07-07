import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ROUTES = [
  { label: "pulse", path: "/pulse" },
  { label: "rankings", path: "/rankings" },
  { label: "ranking detail", path: "/rankings/2026" },
  { label: "categories", path: "/categories" },
  { label: "category detail", path: "/categories/language/python" },
  { label: "repo detail", path: "/facebook/react" },
  { label: "org detail", path: "/o/vercel" },
  { label: "compare", path: "/compare" },
  { label: "about", path: "/about" },
] as const;

const VIEWPORTS = [
  { label: "1440px", width: 1440, height: 1100 },
  { label: "768px", width: 768, height: 1024 },
  { label: "390px", width: 390, height: 1000 },
  { label: "360px", width: 360, height: 1000 },
] as const;

test.describe("phase 7 accessibility", () => {
  for (const route of ROUTES) {
    test(`${route.label} has no serious or critical axe violations`, async ({ page }) => {
      await gotoRoute(page, route.path);

      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");

      expect(formatViolations(violations)).toEqual([]);
    });
  }
});

test.describe("phase 7 responsive layout", () => {
  for (const viewport of VIEWPORTS) {
    test.describe(viewport.label, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const route of ROUTES) {
        test(`${route.label} has a visible main landmark and no page overflow`, async ({ page }) => {
          await gotoRoute(page, route.path);

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

async function gotoRoute(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `No response for ${path}`).not.toBeNull();
  expect(response!.status(), `${path} returned ${response!.status()}`).toBeLessThan(400);

  await expect(page.locator("main")).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

function formatViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }));
}
