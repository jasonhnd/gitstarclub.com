/// <reference types="bun" />

import { invalidateCfPreviewHotPaths, readCfPreviewIdentity } from "../lib/preview/cf";
import { getCfPreviewOrigin } from "../lib/runtime-config";

if (import.meta.main) await main();

async function main(): Promise<void> {
  const origin = getCfPreviewOrigin();
  const identity = await readCfPreviewIdentity();
  if (!identity) {
    throw new Error(`CF Preview identity failed at ${origin}`);
  }
  console.log(`CF Preview identity ok host=${identity.host ?? new URL(origin).host}`);

  if (!process.env.CRON_SECRET?.trim()) {
    console.log("CRON_SECRET unset; skipping /preview/invalidate (identity-only dual-run)");
    return;
  }

  const result = await invalidateCfPreviewHotPaths();
  const paths = result.recorded.filter((op) => op.kind === "path").map((op) => op.path);
  if (!paths.includes("/") || !paths.includes("/pulse")) {
    throw new Error(`CF Preview hot-path stub did not record / and /pulse: ${JSON.stringify(result)}`);
  }
  console.log(`CF Preview hot-path invalidate recorded ${paths.join(", ")}`);
}
