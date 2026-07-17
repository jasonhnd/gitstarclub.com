import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const searchRepos = [
  {
    id: 1,
    full_name: "facebook/react",
    owner: "facebook",
    language: "JavaScript",
    current_stars: 232_000,
    description: "A library for web and native user interfaces",
  },
  {
    id: 2,
    full_name: "vuejs/vue",
    owner: "vuejs",
    language: "TypeScript",
    current_stars: 208_000,
    description: "The progressive JavaScript framework",
  },
  {
    id: 3,
    full_name: "facebook/react-native",
    owner: "facebook",
    language: "JavaScript",
    current_stars: 125_000,
    description: "A framework for building native applications using React",
  },
] as const;

const curves = {
  "1": {
    id: 1,
    full_name: "facebook/react",
    current_stars: 232_000,
    crossed_10k: "2014-02-01",
    points: [
      ["2014-02", 10_400],
      ["2015-02", 32_000],
    ],
  },
  "2": {
    id: 2,
    full_name: "vuejs/vue",
    current_stars: 208_000,
    crossed_10k: "2016-01-01",
    points: [
      ["2016-01", 10_200],
      ["2017-01", 44_000],
    ],
  },
} as const;

test.describe("search accessibility and recovery", () => {
  test("Search dialog keeps real focus, native Tab order, and independent compare state", async ({ page }) => {
    const index = await serveSearchIndex(page);
    await gotoCompare(page);
    await index.ready;

    const search = page.getByRole("combobox", { name: "Search", exact: true });
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.fill("facebook");
    await expect(search).toHaveAttribute("aria-expanded", "true");

    const dialog = page.getByRole("dialog", { name: "Search" });
    const firstLink = dialog.getByRole("link", { name: /^facebook\/react /i });
    const lastLink = dialog.getByRole("link", { name: /facebook\/react-native/i });
    const compareToggle = dialog.getByRole("button", { name: "Add to compare: facebook/react", exact: true });
    await expect(firstLink).toBeVisible();
    await expect(dialog.getByRole("option")).toHaveCount(0);
    await expect(dialog.getByRole("listbox")).toHaveCount(0);

    await search.press("Tab");
    await expect(firstLink).toBeFocused();
    await firstLink.press("Shift+Tab");
    await expect(search).toBeFocused();

    await search.press("ArrowUp");
    await expect(lastLink).toBeFocused();
    await lastLink.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(search).toBeFocused();

    await search.press("ArrowDown");
    await expect(firstLink).toBeFocused();
    await firstLink.press("Tab");
    await expect(compareToggle).toBeFocused();
    await compareToggle.press("Enter");
    const removeToggle = dialog.getByRole("button", { name: "Remove: facebook/react", exact: true });
    await expect(removeToggle).toHaveAttribute("aria-pressed", "true");

    await removeToggle.press("ArrowDown");
    await expect(lastLink).toBeFocused();
    await lastLink.press("Escape");
    await expect(search).toBeFocused();

    await search.press("Enter");
    await page.waitForURL(/\/facebook\/react$/);
  });

  test("open populated Search dialog has no serious or critical Axe violations", async ({ page }) => {
    const index = await serveSearchIndex(page);
    await gotoCompare(page);
    await index.ready;

    await page.getByRole("combobox", { name: "Search", exact: true }).fill("facebook");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog.getByRole("link", { name: /^facebook\/react /i })).toBeVisible();

    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const violations = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(
      violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  });

  test("Enter cannot commit old hits before the new worker response", async ({ page }) => {
    const index = await serveSearchIndex(page);
    await gotoCompare(page);
    await index.ready;

    const search = page.getByRole("combobox", { name: "Search", exact: true });
    const dialog = page.getByRole("dialog", { name: "Search" });
    await search.fill("facebook");
    await expect(dialog.getByRole("link", { name: /^facebook\/react /i })).toBeVisible();

    // Keep the input event and Enter in one browser task. The worker cannot deliver
    // the vue result between them, so Enter must not observe the old facebook hits.
    await search.evaluate((element) => {
      const input = element as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!valueSetter) throw new Error("HTMLInputElement value setter is unavailable");
      valueSetter.call(input, "vue");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    });

    await expect(dialog.getByRole("link", { name: /^vuejs\/vue /i })).toBeVisible();
    await expect(page).toHaveURL(/\/compare$/);
  });
});

test("Compare retries a failed index and malformed curve without a page reload", async ({ page }) => {
  let indexRequests = 0;
  const curveRequests = new Map<string, number>();

  await page.route("**/search-index", async (route) => {
    indexRequests += 1;
    await fulfillJson(
      route,
      indexRequests === 1 ? { count: 2, repos: [searchRepos[0]] } : { count: searchRepos.length, repos: searchRepos },
    );
  });
  await page.route("**/repo-curve?**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id") ?? "";
    const count = (curveRequests.get(id) ?? 0) + 1;
    curveRequests.set(id, count);
    if (id === "1" && count === 1) {
      await fulfillJson(route, { ...curves["1"], points: "cached malformed payload" });
      return;
    }
    const curve = curves[id as keyof typeof curves];
    if (!curve) {
      await route.fulfill({ status: 404, body: "missing fixture" });
      return;
    }
    await fulfillJson(route, curve);
  });

  await gotoCompare(page, "/compare?repos=facebook%2Freact%2Cvuejs%2Fvue");

  const pickerFailure = page.getByText("Repository search could not load right now.");
  await expect(pickerFailure).toBeVisible();
  await pickerFailure.locator("..").getByRole("button", { name: "Retry" }).click();
  await expect(pickerFailure).toBeHidden();
  expect(indexRequests).toBe(2);

  const curveFailure = page.getByText("Could not load star history for facebook/react.");
  await expect(curveFailure).toBeVisible();
  await curveFailure.locator("..").getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("img", { name: /Star history overlay of 2 repositories/ })).toBeVisible();
  expect(curveRequests.get("1")).toBe(2);
  expect(curveRequests.get("2")).toBe(1);
});

async function serveSearchIndex(page: Page) {
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  await page.route("**/search-index", async (route) => {
    await fulfillJson(route, { count: searchRepos.length, repos: searchRepos });
    markReady();
  });
  return { ready };
}

async function gotoCompare(page: Page, path = "/compare") {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
  await expect(page.locator("main")).toBeVisible();
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Cache-Control": "public, max-age=3600" },
    body: JSON.stringify(body),
  });
}
