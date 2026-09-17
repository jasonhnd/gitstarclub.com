/// <reference types="bun" />

import { appendFileSync } from "node:fs";
import { readCfPreviewIdentity } from "../lib/preview/cf";
import { resolvePreviewTarget } from "../lib/preview/resolve";
import { getCfPreviewOrigin, getCfPreviewRequireSha } from "../lib/runtime-config";
import { resolveVercelPreview } from "./resolve-vercel-preview";

if (import.meta.main) await main();

async function main(): Promise<void> {
  const target = resolvePreviewTarget();
  switch (target) {
    case "vercel":
      await resolveVercelPreview();
      return;
    case "cf":
      await resolveCfPreview();
      return;
    default: {
      const _exhaustive: never = target;
      throw new Error(`unsupported PREVIEW_TARGET: ${String(_exhaustive)}`);
    }
  }
}

async function resolveCfPreview(): Promise<void> {
  const expectedSha = process.env["EXPECTED_SHA"]?.trim();
  const outputPath = required("GITHUB_OUTPUT");
  const origin = getCfPreviewOrigin();
  console.log(`Probing CF Preview identity at ${origin}`);
  const identity = await readCfPreviewIdentity();
  if (!identity) {
    throw new Error(`Failed to read CF Preview identity at ${origin} (Access Service Token required)`);
  }
  if (getCfPreviewRequireSha()) {
    if (!expectedSha) throw new Error("EXPECTED_SHA is required when CF_PREVIEW_REQUIRE_SHA=1");
    if (identity.commitSha !== expectedSha) {
      throw new Error(
        `CF Preview SHA mismatch: identity=${identity.commitSha ?? "none"} expected=${expectedSha}`,
      );
    }
  }
  const deploymentUrl = identity.deploymentUrl ?? origin;
  const sha = identity.commitSha ?? expectedSha ?? "";
  await Bun.write(
    "release-metadata.json",
    `${JSON.stringify({ commitSha: sha || null, deploymentUrl, resolvedFrom: origin, target: "cf" }, null, 2)}\n`,
  );
  appendFileSync(outputPath, `url=${deploymentUrl}\nsha=${sha}\n`);
  console.log(`Resolved CF Preview ${deploymentUrl}${sha ? ` for ${sha}` : ""}.`);
}

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required release-gate variable: ${key}`);
  return value;
}
