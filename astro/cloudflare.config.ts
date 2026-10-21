import { bindings, defineConfig, defineWorker } from "cf/config";

// Gate 0 is local only. These fixture resource names are never deployed.
export default defineConfig({
  worker: defineWorker({
    name: "gitstarclub-astro-gate0",
    entrypoint: "src/worker.ts",
    compatibilityDate: "2026-09-17",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: false,
    previewUrls: false,
    env: { DATA: bindings.r2({ name: "gitstarclub-astro-gate0-fixture" }), GSC_CACHE: bindings.kv() },
  }),
});
