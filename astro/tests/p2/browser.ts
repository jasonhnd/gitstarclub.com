import { strict as assert } from "node:assert";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { startWorker } from "../../scripts/local-worker";
import { repositoryFixtures } from "./fixture";
import { getDictionary } from "../../src/lib/i18n";

const scratch = process.env.KANBAN_TMP;
if (!scratch) throw new Error("Set KANBAN_TMP before running browser checks.");
const worker = await startWorker(repositoryFixtures());
const context = await chromium.launchPersistentContext(resolve(scratch, "p2-control-browser"), { headless: true, serviceWorkers: "block" });
try {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const state = window as unknown as { copied: string[]; shared: string[] };
    state.copied = []; state.shared = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => { state.copied.push(value); } } });
    window.open = (url) => { state.shared.push(String(url)); return null; };
  });
  const origin = (await worker.ready).origin;
  await page.goto(`${origin}/example/history`, { waitUntil: "networkidle" });
  const t = await getDictionary("en");
  const share = page.locator("gsc-repo-share").first().locator("button");
  await share.first().click();
  await share.first().filter({ hasText: t.share.copied }).waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]), `${origin}/example/history`);
  await share.nth(1).click();
  const intent = await page.evaluate(() => (window as unknown as { shared: string[] }).shared[0]);
  assert.equal(new URL(intent).searchParams.get("url"), `${origin}/example/history`);
  const snippet = page.locator("gsc-repo-share").nth(1).locator("button");
  await snippet.first().click();
  await snippet.first().filter({ hasText: t.share.copied }).waitFor();
  await snippet.nth(1).click();
  await snippet.nth(1).filter({ hasText: t.share.embedCopied }).waitFor();
  assert.ok((await page.evaluate(() => (window as unknown as { copied: string[] }).copied.at(-1)))?.includes("<"));
  await snippet.nth(1).filter({ hasText: t.share.embed }).waitFor();
  assert.equal(await page.locator('main svg[role="img"]').count(), 1, "Monthly chart stays static without daily provenance");
  assert.equal(await page.locator("main astro-island").count(), 0, "Repository facts/charts do not hydrate");
  console.log("PASS P2 browser controls: link copy, X intent, snippet copy/embed, feedback reset, static chart/body.");
} finally { await context.close(); await worker.dispose(); }
