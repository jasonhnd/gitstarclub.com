import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createR2BootstrapStore } from "../../pipeline/lib/r2-bootstrap-store.mjs";
import { resolveR2Location } from "../../pipeline/lib/bootstrap-cli.mjs";
import { R2S3ObjectStore } from "../lib/storage/r2-s3-store";
import { loadAggregateBundle } from "./lib/aggregate-history-input";
import { importAggregateHistory, PREVIEW_BUCKET } from "./lib/aggregate-history-import";

export function parseAggregateImportArgs(argv: string[]): { source: string; generation: string; execute: boolean } {
  let source = "";
  let generation = "";
  let execute = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--execute") execute = true;
    else if (flag === "--source" || flag === "--generation" || flag === "--target") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--source") source = value;
      else if (flag === "--generation") generation = value;
      else if (value !== "pre") throw new Error("Only --target pre is supported");
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!source || !generation || !argv.includes("--target")) throw new Error("Required: --target pre --source DIR --generation bootstrap-aggregate-<id> [--execute]");
  return { source, generation, execute };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseAggregateImportArgs(argv);
  const bundle = loadAggregateBundle(resolve(args.source));
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
