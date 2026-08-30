import { expect, test } from "@playwright/test";

const PRIMARY_NAV = ["Pulse", "Rankings", "Categories", "Compare", "About"] as const;

test("/cockpit is isolated from the live reading surfaces", async ({ page }) => {
  const response = await page.goto("/cockpit", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/i);

  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const label of PRIMARY_NAV) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Cockpit", exact: true })).toHaveCount(0);

  await expect(page.getByTestId("cockpit-timeline")).toBeVisible();
  await expect(page.getByTestId("cockpit-month")).toHaveText("2026-08");
  const todayStars = await page.getByTestId("cockpit-stars").innerText();

  const rail = page.getByTestId("cockpit-timeline");
  await rail.focus();
  await rail.press("Home");
  await expect(page.getByTestId("cockpit-month")).toHaveText("2015-01");
  await expect(page.getByTestId("cockpit-stars")).not.toHaveText(todayStars);

  const box = await rail.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.12, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.92, box!.y + box!.height / 2);
  await page.mouse.up();
  await expect(page.getByTestId("cockpit-month")).not.toHaveText("2015-01");
});

test("/pulse does not download a three.js chunk", async ({ page }) => {
  const threeRequests: string[] = [];
  page.on("request", (request) => {
    if (/three/i.test(request.url()) && !request.url().includes("mrdoob")) {
      threeRequests.push(request.url());
    }
  });

  const response = await page.goto("/pulse", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  expect(threeRequests).toEqual([]);
});
