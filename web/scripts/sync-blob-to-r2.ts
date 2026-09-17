// Optional one-shot Blob → R2 copy into a non-production prefix.
// Default is dry-run. Never writes production roots or VERCEL_ENV=production.
//
//   bun scripts/sync-blob-to-r2.ts
//   bun scripts/sync-blob-to-r2.ts --prefix views/ --execute
import { fileURLToPath } from "node:url";
import { getBlobWriteToken } from "@/lib/runtime-config";
import { createR2S3ObjectStore, createVercelBlobObjectStore } from "@/lib/storage";
import { describeBlobToR2SyncPlan } from "@/lib/storage/sync-plan";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";

const webDir = fileURLToPath(new URL("..", import.meta.url));
loadWebEnvFiles(webDir, { onDiagnostic: warnEnvFileDiagnostic });

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const prefixIndex = args.indexOf("--prefix");
const sourcePrefix = prefixIndex >= 0 ? (args[prefixIndex + 1] ?? "") : "";

const plan = describeBlobToR2SyncPlan({ execute, sourcePrefix });
console.log(
  `blob→r2 ${plan.execute ? "EXECUTE" : "dry-run"} source="${plan.sourcePrefix || "(store root)"}" dest="${plan.destinationPrefix}"`,
);

if (!getBlobWriteToken()) {
  console.log("dry-run listing skipped: BLOB_READ_WRITE_TOKEN is not set.");
  if (execute) throw new Error("BLOB_READ_WRITE_TOKEN is required for --execute");
  process.exit(0);
}

const source = createVercelBlobObjectStore();
const destination = createR2S3ObjectStore();
let copied = 0;
let cursor: string | undefined;
do {
  const page = await source.list({ prefix: plan.sourcePrefix, cursor, limit: 1000, mode: "expanded" });
  for (const object of page.blobs) {
    const current = await source.get(object.pathname);
    if (!current) continue;
    console.log(`${plan.execute ? "copy" : "would-copy"} ${object.pathname} -> ${plan.destinationPrefix}${object.pathname}`);
    if (plan.execute) {
      await destination.put(object.pathname, current.body, {
        allowOverwrite: true,
        contentType: current.contentType ?? "application/json",
      });
      copied += 1;
    }
  }
  cursor = page.cursor;
} while (cursor);

console.log(plan.execute ? `copied ${copied} object(s)` : "dry-run: nothing written to R2.");
