import { hostWorker } from "../web/cloudflare.config.ts";

/** Shared resources and preview schedules, without importing the Astro adapter. */
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
