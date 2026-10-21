import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { getDictionary } from "../../src/lib/i18n";

/** Exercise only existing interactive islands against the actual local Worker. */
export async function checkOrganizationControls(origin: string) {
  const t = await getDictionary("en");
  const context = await chromium.launchPersistentContext(resolve(process.env.KANBAN_TMP!, "p4-controls-browser"), { headless: true });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (value: string) => { (window as unknown as { copiedValue: string }).copiedValue = value; },
      } });
    });
    await page.goto(`${origin}/o/example`, { waitUntil: "networkidle" });
    const copiedValue = () => page.evaluate(() => (window as unknown as { copiedValue: string }).copiedValue);
    await page.getByRole("button", { name: t.share.label, exact: true }).click();
    await expect.poll(copiedValue).toBe("https://gitstarclub.com/o/example");
    await expect(page.getByRole("button", { name: t.share.copied, exact: true })).toBeVisible();
    await page.getByRole("button", { name: t.share.copy, exact: true }).click();
    await expect.poll(copiedValue).toContain("example/repo");
    await expect(page.getByRole("button", { name: t.share.copied, exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: t.share.embed, exact: true }).click();
    await expect.poll(copiedValue).toContain("<blockquote");
    await expect(page.getByRole("button", { name: t.share.embedCopied, exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    console.log("PASS share link, snippet text/embed clipboard actions and hydration");
  } finally { await context.close(); }
}
