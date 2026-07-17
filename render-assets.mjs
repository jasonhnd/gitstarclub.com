import { createRequire } from "node:module";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  ASSET_FONT_PATHS,
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

async function loadRenderer() {
  const requireFromWeb = createRequire(resolve(REPO_ROOT, "web/package.json"));
  try {
    const modulePath = requireFromWeb.resolve("@resvg/resvg-wasm");
    const wasmPath = requireFromWeb.resolve("@resvg/resvg-wasm/index_bg.wasm");
    const imported = await import(pathToFileURL(modulePath).href);
    const renderer = imported.Resvg ? imported : imported.default;
    if (!renderer?.Resvg || !renderer?.initWasm) throw new Error("package exports are incomplete");
    await renderer.initWasm(readFileSync(wasmPath));
    return renderer.Resvg;
  } catch (error) {
    throw new Error(`resvg-wasm is unavailable; run 'cd web && bun install --frozen-lockfile': ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function renderTargets(outputDirectory) {
  const Resvg = await loadRenderer();
  const fontBuffers = ASSET_FONT_PATHS.map((fontPath) => readFileSync(resolve(REPO_ROOT, fontPath)));

  for (const target of RENDER_TARGETS) {
    const renderer = new Resvg(readFileSync(resolve(REPO_ROOT, target.source)), {
      font: {
        fontBuffers,
        defaultFontFamily: "Geist",
        sansSerifFamily: "Geist",
        monospaceFamily: "Geist Mono",
      },
      fitTo: { mode: "width", value: target.width },
      shapeRendering: 2,
      textRendering: 2,
    });
    try {
      const renderedImage = renderer.render();
      try {
        const output = resolve(outputDirectory, target.asset);
        const png = Buffer.from(renderedImage.asPng());
        writeFileSync(output, png);
        const dimensions = pngDimensions(png);
        if (dimensions.width !== target.width || dimensions.height !== target.height) {
          throw new Error(`${target.asset}: rendered ${dimensions.width}x${dimensions.height}, expected ${target.width}x${target.height}`);
        }
      } finally {
        renderedImage.free();
      }
    } finally {
      renderer.free();
    }
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
      console.log(`Asset check passed: ${RENDER_TARGETS.length} deterministic resvg renders and all deployed copies match`);
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
