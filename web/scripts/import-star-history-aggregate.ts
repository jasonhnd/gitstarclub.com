import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createR2BootstrapStore } from "../../pipeline/lib/r2-bootstrap-store.mjs";
import { resolveR2Location } from "../../pipeline/lib/bootstrap-cli.mjs";
import { R2S3ObjectStore } from "../lib/storage/r2-s3-store";
import { AggregateHistoryWorkerClient, aggregateWorkerOrigin } from "./lib/aggregate-history-worker-client";
import { loadAggregateBundle } from "./lib/aggregate-history-input";
import { importAggregateHistory, PREVIEW_BUCKET } from "./lib/aggregate-history-import";

export function parseAggregateImportArgs(argv: string[]): { source: string; generation: string; execute: boolean; workerUrl?: string; checkpoint?: string; secretFile?: string } {
  let source = "";
  let generation = "";
  let execute = false;
  let workerUrl: string | undefined;
  let checkpoint: string | undefined;
  let secretFile: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--execute") execute = true;
    else if (flag === "--source" || flag === "--generation" || flag === "--target" || flag === "--worker-url" || flag === "--checkpoint" || flag === "--secret-file") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--source") source = value;
      else if (flag === "--generation") generation = value;
      else if (flag === "--worker-url") workerUrl = aggregateWorkerOrigin(value);
      else if (flag === "--checkpoint") checkpoint = value;
      else if (flag === "--secret-file") secretFile = value;
      else if (value !== "pre") throw new Error("Only --target pre is supported");
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!source || !generation || !argv.includes("--target")) throw new Error("Required: --target pre --source DIR --generation bootstrap-aggregate-<id> [--execute]");
  if (workerUrl && execute && !checkpoint) throw new Error("--checkpoint is required for Worker execution");
  if (secretFile && !workerUrl) throw new Error("--secret-file requires --worker-url");
  if (checkpoint && !workerUrl) throw new Error("--checkpoint requires --worker-url");
  return { source, generation, execute, ...(workerUrl ? { workerUrl } : {}), ...(checkpoint ? { checkpoint } : {}), ...(secretFile ? { secretFile } : {}) };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseAggregateImportArgs(argv);
  const bundle = loadAggregateBundle(resolve(args.source));
  if (args.workerUrl) {
    const client = new AggregateHistoryWorkerClient({ origin: args.workerUrl, generation: args.generation, checkpoint: args.checkpoint, secret: args.secretFile ? readFileSync(args.secretFile, "utf8").trim() : process.env.CRON_SECRET ?? "" });
    const result = await importAggregateHistory({ ...args, bundle, store: client.store, publisher: client });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  // Use explicitly supplied S3 credentials, never ambient platform login or
  // another target's environment files. The same identity guard protects writes.
  const location = resolveR2Location(process.env, "pre");
  if (location.bucket !== PREVIEW_BUCKET) throw new Error("Only gitstarclub-data-pre is supported");
  const guard = createR2BootstrapStore(location);
  await guard.checkIdentity!();
  const result = await importAggregateHistory({ ...args, bundle, store: new R2S3ObjectStore(location) });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
