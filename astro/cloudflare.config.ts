import { defineConfig } from "cf/config";
import { hostWorker } from "../web/cloudflare.config.ts";
import { accountId } from "../web/host-contract.mjs";

/** Preserve the existing resource identities and queue policy; add no schedules. */
export function astroHostWorker(mode: string, shell: Record<string, string | undefined> = {}) {
  return {
    ...hostWorker(mode, shell),
    entrypoint: "src/worker.ts",
    assets: {
      htmlHandling: "none" as const, notFoundHandling: "none" as const,
      runWorkerFirst: ["/*", "!/_astro/*", "!/assets/*"],
    },
  };
}

export default defineConfig(({ mode }) => ({ accountId, worker: astroHostWorker(mode ?? "", process.env) }));
