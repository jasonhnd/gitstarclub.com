import { bindings, defineConfig, defineWorker, triggers } from "cf/config";
import { accountId, buildVars, hostMode } from "./host-contract.mjs";

/** Full host contract. Only preview declares scheduled jobs. */
export function hostWorker(mode: string, shell: Record<string, string | undefined> = {}) {
  const target = hostMode(mode);
  const vars = buildVars(mode, shell);
  return defineWorker({
    name: target.name,
    entrypoint: "../workers/gitstarclub-web/src/index.ts",
    compatibilityDate: "2026-09-17",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    workersDev: target.workersDev,
    previewUrls: target.previewUrls,
    observability: { enabled: true },
    assets: {
      htmlHandling: "none", notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*", "!/assets/*"],
    },
    env: {
      ...Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, bindings.text(value)])),
      ASSETS: bindings.assets(),
      DATA: bindings.r2({ name: target.bucket }),
      MEDIA: bindings.r2({ name: "gitstarclub-assets" }),
      JOBS: bindings.queue({ name: target.queue }),
      WORKER_SELF_REFERENCE: bindings.worker({ worker: target.name }),
      // Existing gitstarclub-web-pre-gsc-cache; cf's KV options accept ids, not titles.
      GSC_CACHE: bindings.kv(mode === "pre" ? { id: "4c3107414bad4a0386fedfcf96dde6e2" } : {}),
    },
    triggers: [
      triggers.queue({ name: target.queue, maxBatchSize: 1, maxRetries: 2 }),
      ...(mode === "pre"
        ? ["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"].map((schedule) => triggers.scheduled({ schedule }))
        : []),
    ],
  });
}

export default defineConfig(({ mode }) => ({ accountId, worker: hostWorker(mode ?? "", process.env) }));
