import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Theme = "light" | "dark";
type Locale = (typeof SUPPORTED_LOCALES)[number];

const SUPPORTED_LOCALES = ["en", "ja", "zh", "zh-TW", "ko", "es", "fr"] as const;
const THEMES = ["light", "dark"] as const satisfies readonly Theme[];
const VIEWPORTS = [
  { label: "1440x1100", width: 1440, height: 1100 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "390x1200", width: 390, height: 1200 },
  { label: "360x1000", width: 360, height: 1000 },
] as const;

const outputDir = path.resolve(process.cwd(), process.env.BASELINE_SCREENSHOT_DIR ?? "test-results/baseline-screenshots");
const baseURL = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const locales = parseLocales(process.env.BASELINE_SCREENSHOT_LOCALES);
const routes = selectRoutes(buildRoutes());
const shots = buildShots();

test.describe("baseline screenshots", () => {
  test.beforeAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });
    await writeManifest();
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test.describe(`${viewport.label} ${theme}`, () => {
        test.use({
          colorScheme: theme,
          viewport: { width: viewport.width, height: viewport.height },
        });

        for (const shot of shots.filter((entry) => entry.viewport === viewport.label && entry.theme === theme)) {
          test(shot.label, async ({ page }, testInfo) => {
            await setTheme(page, shot.theme);

            const response = await page.goto(shot.routePath, { waitUntil: "domcontentloaded" });
            expect(response, `No response for ${shot.routePath}`).not.toBeNull();
            expect(response!.status(), `${shot.routePath} returned ${response!.status()}`).toBeLessThan(400);

            await expect(page.locator("main")).toBeVisible();
            await settleForScreenshot(page);
            await mkdir(path.dirname(shot.filePath), { recursive: true });
            await page.screenshot({ path: shot.filePath, animations: "disabled" });
            await testInfo.attach("baseline screenshot", { path: shot.filePath, contentType: "image/png" });
          });
        }
      });
    }
  }
});

type BaselineRoute = {
  id: string;
  path: string;
};

type Shot = {
  label: string;
  routeId: string;
  routePath: string;
  viewport: string;
  width: number;
  height: number;
  locale: Locale;
  theme: Theme;
  filePath: string;
};

function buildRoutes(): BaselineRoute[] {
  const year = process.env.BASELINE_SCREENSHOT_YEAR ?? String(new Date().getUTCFullYear());
  const monthRoute = monthPath(year);
  const weekRoute = weekPath();
  const repo = splitPair(process.env.BASELINE_SCREENSHOT_REPO ?? "microsoft/markitdown", "repo");
  const category = splitPair(process.env.BASELINE_SCREENSHOT_CATEGORY ?? "language/python", "category");
  const org = requiredValue(process.env.BASELINE_SCREENSHOT_ORG ?? "microsoft", "BASELINE_SCREENSHOT_ORG");

  return [
    { id: "pulse", path: "/pulse" },
    { id: "rankings", path: "/rankings" },
    { id: "ranking-year", path: `/rankings/${year}` },
    { id: "ranking-month", path: monthRoute },
    { id: "ranking-week", path: weekRoute },
    { id: "categories", path: "/categories" },
    { id: "category-detail", path: `/categories/${category.first}/${category.second}` },
    { id: "repo-detail", path: `/${repo.first}/${repo.second}` },
    { id: "org-detail", path: `/o/${org}` },
    { id: "compare", path: "/compare" },
    { id: "about", path: "/about" },
  ];
}

function buildShots(): Shot[] {
  return locales.flatMap((locale) =>
    VIEWPORTS.flatMap((viewport) =>
      THEMES.flatMap((theme) =>
        routes.map((route) => {
          const routePath = localizedPath(locale, route.path);
          const label = `${route.id}__${routeSlug(routePath)}__${viewport.label}__${locale}__${theme}`;
          return {
            label,
            routeId: route.id,
            routePath,
            viewport: viewport.label,
            width: viewport.width,
            height: viewport.height,
            locale,
            theme,
            filePath: path.join(outputDir, locale, theme, viewport.label, `${label}.png`),
          };
        }),
      ),
    ),
  );
}

async function writeManifest() {
  const manifest = {
    baseURL,
    generatedAt: new Date().toISOString(),
    outputDir,
    routes,
    viewports: VIEWPORTS,
    locales,
    themes: THEMES,
    shots: shots.map((shot) => ({
      label: shot.label,
      routeId: shot.routeId,
      routePath: shot.routePath,
      viewport: shot.viewport,
      width: shot.width,
      height: shot.height,
      locale: shot.locale,
      theme: shot.theme,
      file: path.relative(outputDir, shot.filePath).replaceAll(path.sep, "/"),
    })),
  };
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function setTheme(page: Page, theme: Theme) {
  await page.addInitScript((requestedTheme) => {
    localStorage.setItem("theme", requestedTheme);
    document.documentElement.setAttribute("data-theme", requestedTheme);
  }, theme);
}

async function settleForScreenshot(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

function parseLocales(raw: string | undefined): Locale[] {
  if (!raw) return ["en"];
  const selected = raw
    .split(",")
    .map((locale) => locale.trim())
    .filter(Boolean);

  for (const locale of selected) {
    if (!isSupportedLocale(locale)) {
      throw new Error(`Unsupported BASELINE_SCREENSHOT_LOCALES value "${locale}". Use one of: ${SUPPORTED_LOCALES.join(", ")}`);
    }
  }

  return selected as Locale[];
}

function selectRoutes(allRoutes: BaselineRoute[]): BaselineRoute[] {
  const raw = process.env.BASELINE_SCREENSHOT_ROUTE_IDS;
  if (!raw) return allRoutes;
  const selected = new Set(
    raw
      .split(",")
      .map((route) => route.trim())
      .filter(Boolean),
  );
  const unknown = [...selected].filter((route) => !allRoutes.some((known) => known.id === route));
  if (unknown.length > 0) {
    throw new Error(`Unknown BASELINE_SCREENSHOT_ROUTE_IDS value(s): ${unknown.join(", ")}`);
  }
  return allRoutes.filter((route) => selected.has(route.id));
}

function localizedPath(locale: Locale, canonicalPath: string): string {
  if (locale === "en") return canonicalPath;
  if (canonicalPath === "/") return `/${locale}`;
  return `/${locale}${canonicalPath}`;
}

function monthPath(defaultYear: string): string {
  const raw = process.env.BASELINE_SCREENSHOT_MONTH;
  if (!raw) return `/rankings/${defaultYear}/${new Date().getUTCMonth() + 1}`;

  const period = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (period) return `/rankings/${period[1]}/${Number(period[2])}`;

  const month = Number(raw);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("BASELINE_SCREENSHOT_MONTH must be 1-12 or YYYY-MM.");
  }
  return `/rankings/${defaultYear}/${month}`;
}

function weekPath(): string {
  const period = process.env.BASELINE_SCREENSHOT_WEEK ?? currentUtcWeekPeriod();
  const match = /^(\d{4})-W(\d{1,2})$/i.exec(period);
  if (!match) throw new Error("BASELINE_SCREENSHOT_WEEK must use YYYY-Www, for example 2026-W26.");

  const week = Number(match[2]);
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    throw new Error("BASELINE_SCREENSHOT_WEEK week number must be 1-53.");
  }
  return `/rankings/${match[1]}/W${String(week).padStart(2, "0")}`;
}

function currentUtcWeekPeriod(): string {
  const date = new Date();
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function splitPair(value: string, name: string): { first: string; second: string } {
  const [first, second, extra] = value.split("/");
  if (!first || !second || extra) {
    throw new Error(`BASELINE_SCREENSHOT_${name.toUpperCase()} must have exactly two slash-separated segments.`);
  }
  return { first, second };
}

function requiredValue(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} must not be empty.`);
  return value.trim();
}

function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function routeSlug(routePath: string): string {
  return routePath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .toLowerCase() || "root";
}
