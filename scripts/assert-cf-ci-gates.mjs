import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRepositoryCfCiGates } from "./cf-ci-gates.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const summary = assertRepositoryCfCiGates(repoRoot);
  console.log(
    `CF CI gates ok: ${summary.previewEnv}→${summary.previewWorker}; probe ${summary.previewOrigin}; no live deploy to ${summary.productionWorker}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
