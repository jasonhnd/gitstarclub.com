/// <reference types="bun" />

import { appendFileSync } from "node:fs";
import { readCfPreviewIdentity } from "../lib/preview/cf";
import { resolvePreviewTarget } from "../lib/preview/resolve";
import { getCfPreviewOrigin, getCfPreviewRequireSha } from "../lib/runtime-config";
import { requiredReleaseEnv, resolveCfPreviewDecision } from "./lib/resolve-preview-cf";
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
  const outputPath = requiredReleaseEnv(process.env, "GITHUB_OUTPUT");
  const origin = getCfPreviewOrigin();
  console.log(`Probing CF Preview identity at ${origin}`);
  const decision = resolveCfPreviewDecision({
    identity: await readCfPreviewIdentity(),
    expectedSha,
    requireSha: getCfPreviewRequireSha(),
    origin,
  });
  await Bun.write("release-metadata.json", `${JSON.stringify(decision.metadata, null, 2)}\n`);
  appendFileSync(outputPath, decision.githubOutput);
  console.log(decision.logLine);
}
