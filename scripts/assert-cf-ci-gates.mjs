import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAllowedCfPreviewOrigin, assertRepositoryCfCiGates } from "./cf-ci-gates.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  if (process.argv.includes("--preview-origin")) {
    const origin = assertAllowedCfPreviewOrigin(process.env.CF_PREVIEW_ORIGIN);
    console.log(`CF_PREVIEW_ORIGIN=${origin}`);
  } else {
    const summary = assertRepositoryCfCiGates(repoRoot);
    console.log(
      `CF CI gates ok: ${summary.previewEnv}→${summary.previewWorker}; probe ${summary.previewOrigin}; production ${summary.productionWorker} triggers.crons=[]; no live deploy`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
