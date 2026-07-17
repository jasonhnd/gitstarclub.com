import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const ASSET_FONT_PATHS = [
  "assets/fonts/Geist-Regular.ttf",
  "assets/fonts/Geist-SemiBold.ttf",
  "assets/fonts/Geist-ExtraBold.ttf",
  "assets/fonts/GeistMono-Medium.ttf",
];

export const RENDER_TARGETS = [
  { source: "assets/og.svg", asset: "og.png", width: 1200, height: 630 },
  { source: "assets/favicon.svg", asset: "favicon.png", width: 64, height: 64 },
  { source: "assets/favicon.svg", asset: "apple-touch-icon.png", width: 180, height: 180 },
];

export const STATIC_ASSETS = [
  ...RENDER_TARGETS.map(({ asset, width, height }) => ({ asset, width, height })),
  { asset: "favicon.svg" },
];

export function pngDimensions(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("not a PNG with an IHDR header");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function syncAssetCopies(root = REPO_ROOT, { includeLegacyPublic = false } = {}) {
  const destinations = [resolve(root, "web/public")];
  if (includeLegacyPublic) destinations.push(resolve(root, "public"));
  for (const destination of destinations) {
    mkdirSync(destination, { recursive: true });
    for (const { asset } of STATIC_ASSETS) {
      copyFileSync(resolve(root, "assets", asset), resolve(destination, asset));
    }
  }
}

export function inspectAssetCopies(root = REPO_ROOT) {
  const issues = [];
  for (const target of STATIC_ASSETS) {
    const canonicalPath = resolve(root, "assets", target.asset);
    const deployedPath = resolve(root, "web/public", target.asset);
    if (!existsSync(canonicalPath)) {
      issues.push(`${target.asset}: missing canonical assets/${target.asset}`);
      continue;
    }
    if (!existsSync(deployedPath)) {
      issues.push(`${target.asset}: missing deployed web/public/${target.asset}`);
      continue;
    }
    const canonical = readFileSync(canonicalPath);
    const deployed = readFileSync(deployedPath);
    if ("width" in target && "height" in target) {
      for (const [label, buffer] of [["canonical", canonical], ["deployed", deployed]]) {
        try {
          const dimensions = pngDimensions(buffer);
          if (dimensions.width !== target.width || dimensions.height !== target.height) {
            issues.push(`${target.asset}: ${label} dimensions ${dimensions.width}x${dimensions.height}, expected ${target.width}x${target.height}`);
          }
        } catch (error) {
          issues.push(`${target.asset}: ${label} ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (!canonical.equals(deployed)) {
      issues.push(`${target.asset}: deployed copy drift (assets ${sha256(canonical)}, web/public ${sha256(deployed)})`);
    }
  }
  return issues;
}
