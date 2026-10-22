import { defineConfig } from "cf/config";
import { hostWorker } from "../web/cloudflare.config.ts";
import { accountId } from "../web/host-contract.mjs";

/** Reuse web's preview schedules and steady-state vars; production stays queue-only. */
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
