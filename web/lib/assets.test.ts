import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  inspectAssetCopies,
  pngDimensions,
  REPO_ROOT,
  STATIC_ASSETS,
  syncAssetCopies,
} from "../../scripts/assets.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function assetFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "gsc-assets-check-"));
  roots.push(root);
  mkdirSync(join(root, "assets"), { recursive: true });
  for (const { asset } of STATIC_ASSETS) {
    copyFileSync(join(REPO_ROOT, "assets", asset), join(root, "assets", asset));
  }
  syncAssetCopies(root);
  return root;
}

describe("asset generation contract", () => {
  test("checked-in PNG dimensions match every served contract", () => {
    expect(pngDimensions(readFileSync(join(REPO_ROOT, "assets", "favicon.png")))).toEqual({ width: 64, height: 64 });
    expect(pngDimensions(readFileSync(join(REPO_ROOT, "assets", "apple-touch-icon.png")))).toEqual({ width: 180, height: 180 });
    expect(pngDimensions(readFileSync(join(REPO_ROOT, "assets", "og.png")))).toEqual({ width: 1200, height: 630 });
  });

  test("a synchronized canonical/deployed fixture passes", () => {
    expect(inspectAssetCopies(assetFixture())).toEqual([]);
  });

  test("detects deployed content drift and missing assets", () => {
    const root = assetFixture();
    writeFileSync(join(root, "web", "public", "og.png"), "drift");
    rmSync(join(root, "web", "public", "favicon.svg"));
    expect(inspectAssetCopies(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("og.png: deployed not a PNG"),
        expect.stringContaining("og.png: deployed copy drift"),
        "favicon.svg: missing deployed web/public/favicon.svg",
      ]),
    );
  });
});
