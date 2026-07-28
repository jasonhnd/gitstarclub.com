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

const THEMES = ["light", "dark"] as const;

test.describe("phase 7 accessibility", () => {
  for (const route of ROUTES) {
    test(`${route.label} has no serious or critical axe violations`, async ({ page }) => {
      await gotoRoute(page, route.path);

      // Theme changes animate body colors for sighted users. Axe must inspect
      // the settled palette instead of a transient frame from that transition.
      await page.emulateMedia({ reducedMotion: "reduce" });

      for (const theme of THEMES) {
        await setTheme(page, theme);

        const results = await new AxeBuilder({ page }).analyze();
        const violations = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");

        expect(formatViolations(violations), `${route.path} has accessibility violations in ${theme} mode`).toEqual([]);

        if (route.path === "/pulse") {
          const contrast = await activePeriodContrast(page);
          expect(contrast, `Active PeriodSwitcher control contrast is ${contrast.toFixed(2)}:1 in ${theme} mode`).toBeGreaterThanOrEqual(4.5);
        }
      }

      if (route.path === "/pulse") {
        await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
        // Active period control is always present; "Latest available" badge only appears when
        // the published period lags the calendar (absent once live data is current).
        await expect(activePeriodControl(page)).toBeVisible();
      }
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

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((requestedTheme) => {
    localStorage.setItem("theme", requestedTheme);
    document.documentElement.setAttribute("data-theme", requestedTheme);
  }, theme);
}

function activePeriodControl(page: Page) {
  return page.locator('nav[aria-label="Ranking period"] a[aria-current="page"]');
}

function activeBadge(page: Page) {
  return activePeriodControl(page).locator("span").filter({ hasText: "Latest available:" });
}

async function activePeriodContrast(page: Page) {
  const control = activePeriodControl(page);
  await expect(control).toHaveCount(1);

  // Prefer the "Latest available" badge when present (stale-data state); otherwise measure
  // the active period control itself (current-data state after live refresh recovered).
  const badge = activeBadge(page);
  const target = (await badge.count()) === 1 ? badge : control;

  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    const anchor = element.closest("a") ?? element;
    const foreground = parseRgb(style.color);
    const background = parseRgb(getComputedStyle(anchor).backgroundColor);
    const luminance = ([red, green, blue]: number[]) => {
      const channels = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);

    function parseRgb(color: string): number[] {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${color}`);
      return channels;
    }
  });
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
