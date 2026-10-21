import { Miniflare, Log, LogLevel } from "miniflare";
import { resolve, relative } from "node:path";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { fixtureRecords } from "./fixture";
import type { R2Bucket } from "../../web/lib/storage/r2-binding-store";

export async function startWorker(records = fixtureRecords()) {
  const scratch = process.env.KANBAN_TMP;
  if (!scratch) throw new Error("Set KANBAN_TMP before starting the local Worker.");
  const output = resolve(scratch, "astro-cloudflare/output/v0/workers/default");
  const bundle = resolve(output, "bundle");
  const modules: Record<string, { type: "esm"; contents: string }> = {};
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".mjs")) modules[relative(bundle, path)] = { type: "esm", contents: readFileSync(path, "utf8") };
    }
  }
  walk(bundle);
  const resourceTmpPath = resolve(scratch, "astro-local-state");
  mkdirSync(resourceTmpPath, { recursive: true });
  const worker = new Miniflare({
    workers: [{ config: {
      name: "astro-local",
      compatibilityDate: "2026-09-17", compatibilityFlags: ["nodejs_compat"],
      triggers: [{ type: "fetch", pattern: "*/*" }],
      manifest: { mainModule: "entry.mjs", modules },
      env: { DATA: { type: "r2", name: "astro-fixture" }, GSC_CACHE: { type: "kv" }, ASSETS: { type: "assets" } },
      assets: { directory: resolve(output, "assets"), htmlHandling: "none", notFoundHandling: "none" },
    } }],
    resourceTmpPath, telemetry: { enabled: false },
    host: "127.0.0.1", port: 0, log: new Log(LogLevel.ERROR),
  });
  try {
    const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
    for (const [key, body] of records) await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
    await worker.ready;
    return worker;
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}

if (import.meta.main) {
  const worker = await startWorker();
  console.log(`Local Astro Worker: ${(await worker.ready).origin}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await worker.dispose(); process.exit(0); });
}
