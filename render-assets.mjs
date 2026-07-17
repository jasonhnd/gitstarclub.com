import { createRequire } from "node:module";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  inspectAssetCopies,
  pngDimensions,
  RENDER_TARGETS,
  REPO_ROOT,
  sha256,
  syncAssetCopies,
} from "./scripts/assets.mjs";

const args = new Set(process.argv.slice(2));
const checkMode = args.has("--check");
const syncOnly = args.has("--sync-only");
const unknown = [...args].filter((arg) => arg !== "--check" && arg !== "--sync-only");
if (unknown.length > 0 || (checkMode && syncOnly)) {
  console.error("usage: bun render-assets.mjs [--check | --sync-only]");
  process.exit(2);
}

async function loadChromium() {
  const requireFromWeb = createRequire(resolve(REPO_ROOT, "web/package.json"));
  try {
    const playwright = requireFromWeb("playwright");
    return playwright.chromium;
  } catch (error) {
    throw new Error(`Playwright is unavailable; run 'cd web && bun install --frozen-lockfile': ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function renderTargets(outputDirectory) {
  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--allow-file-access-from-files",
        "--disable-gpu",
        "--disable-lcd-text",
        "--font-render-hinting=none",
        "--force-color-profile=srgb",
      ],
    });
  } catch (error) {
    throw new Error(`Playwright Chromium is unavailable; run 'cd web && bunx playwright install chromium': ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    for (const target of RENDER_TARGETS) {
      const context = await browser.newContext({
        viewport: { width: target.width, height: target.height },
        deviceScaleFactor: 1,
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await page.goto(pathToFileURL(resolve(REPO_ROOT, target.source)).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if ("fonts" in target) {
          const missingFonts = await page.evaluate((fonts) => fonts.filter((font) => !document.fonts.check(`16px "${font}"`)), target.fonts);
          if (missingFonts.length > 0) throw new Error(`${target.asset}: local font(s) failed to load: ${missingFonts.join(", ")}`);
        }
        const output = resolve(outputDirectory, target.asset);
        await page.screenshot({ path: output, animations: "disabled", omitBackground: true });
        const dimensions = pngDimensions(readFileSync(output));
        if (dimensions.width !== target.width || dimensions.height !== target.height) {
          throw new Error(`${target.asset}: rendered ${dimensions.width}x${dimensions.height}, expected ${target.width}x${target.height}`);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (syncOnly) {
    syncAssetCopies(REPO_ROOT);
    console.log("Synchronized canonical assets to web/public");
    return;
  }

  const temporary = mkdtempSync(join(tmpdir(), "gsc-assets-"));
  try {
    await renderTargets(temporary);
    if (checkMode) {
      const issues = inspectAssetCopies(REPO_ROOT);
      for (const target of RENDER_TARGETS) {
        const rendered = readFileSync(resolve(temporary, target.asset));
        const canonical = readFileSync(resolve(REPO_ROOT, "assets", target.asset));
        if (!rendered.equals(canonical)) {
          issues.push(`${target.asset}: rendered source drift (rendered ${sha256(rendered)}, assets ${sha256(canonical)})`);
        }
      }
      if (issues.length > 0) throw new Error(`asset check failed:\n- ${issues.join("\n- ")}`);
      console.log(`Asset check passed: ${RENDER_TARGETS.length} deterministic renders and all deployed copies match`);
      return;
    }

    for (const target of RENDER_TARGETS) {
      copyFileSync(resolve(temporary, target.asset), resolve(REPO_ROOT, "assets", target.asset));
      console.log(`Rendered assets/${target.asset} (${target.width}x${target.height})`);
    }
    syncAssetCopies(REPO_ROOT);
    console.log("Synchronized canonical assets to web/public");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

await main();
