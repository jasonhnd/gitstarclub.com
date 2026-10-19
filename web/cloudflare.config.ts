import { bindings, defineConfig, defineWorker } from "cf/config";

// Local proof only. No account, domain, remote storage, queue, or schedule.
export default defineConfig({
  worker: defineWorker({
    name: "gsc-0074-local-proof",
    entrypoint: "./spike/worker.ts",
    compatibilityDate: "2026-10-19",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/assets/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      GSC_CACHE: bindings.kv(),
      SITE_INDEXABLE: bindings.text("0"),
      BLOB_BASE_URL: bindings.text("http://127.0.0.1:4074"),
    },
  }),
});
