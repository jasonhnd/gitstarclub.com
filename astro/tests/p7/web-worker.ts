import { Miniflare, Log, LogLevel } from "miniflare";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";

/** Load the built original Worker directly, without Vite preview's CORS wrapper. */
export async function startWebWorker(root: string, scratch: string, records: Map<string, string>, fixtureOrigin: string, strings: Record<string, string> = {}) {
  const output = resolve(root, "../web/.cloudflare/output/v0/workers/default");
  const bundle = resolve(output, "bundle");
  const modules: Record<string, { type: "esm" | "wasm"; contents: string | Uint8Array<ArrayBuffer> }> = {};
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:m?js|wasm)$/.test(entry.name)) modules[relative(bundle, path)] = entry.name.endsWith(".wasm")
        ? { type: "wasm", contents: new Uint8Array(readFileSync(path)) }
        : { type: "esm", contents: readFileSync(path, "utf8") };
    }
  }
  walk(bundle);
  const resourceTmpPath = resolve(scratch, "p7-web-state"); mkdirSync(resourceTmpPath, { recursive: true });
  const worker = new Miniflare({
    workers: [{ config: {
      name: "p7-original-local", compatibilityDate: "2026-09-17", compatibilityFlags: ["nodejs_compat"],
      triggers: [{ type: "fetch", pattern: "*/*" }],
      manifest: { mainModule: "index.js", modules },
      assets: { directory: resolve(output, "assets"), htmlHandling: "none", notFoundHandling: "none" },
      env: {
        DATA: { type: "r2", name: "p7-original-fixture" }, GSC_CACHE: { type: "kv" }, ASSETS: { type: "assets" },
        HOSTING_TARGET: { type: "text", value: "cf" }, DEPLOY_ENV: { type: "text", value: "pre" },
        BLOB_BASE_URL: { type: "text", value: fixtureOrigin }, R2_PUBLIC_BASE_URL: { type: "text", value: fixtureOrigin },
        ...Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, { type: "text" as const, value }])),
      },
    } }],
    resourceTmpPath, telemetry: { enabled: false }, host: "127.0.0.1", port: 0, log: new Log(LogLevel.ERROR),
  });
  try {
    const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
    for (const [key, body] of records) await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
    await worker.ready;
    return worker;
  } catch (error) { await worker.dispose(); throw error; }
}
