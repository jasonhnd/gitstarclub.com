// Idempotent operator for a missing bootstrap/latest.json.
//
// Dry-run (default). Blob:
//   bun scripts/ensure-bootstrap-pointer.ts
// R2 dry-run:
//   bun scripts/ensure-bootstrap-pointer.ts --store r2 --target pre
// Commit a discovered sealed generation:
//   bun scripts/ensure-bootstrap-pointer.ts --execute
//   bun scripts/ensure-bootstrap-pointer.ts --store r2 --target pre --execute
// Empty R2 bucket, no legacy flat layout:
//   bun scripts/ensure-bootstrap-pointer.ts --store r2 --target pre --execute --initial-commit
import { fileURLToPath } from "node:url";
import { commitBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";
import { BootstrapPublicationPointer } from "../lib/contracts";
import {
  parseListedBootstrapGenerations,
  selectBootstrapGenerationToCommit,
} from "../lib/data/ensure-bootstrap-pointer";
import { requireStorageWriteConfig } from "../lib/runtime-config";
import { createObjectStoreBootstrapAdapter } from "../lib/storage/bootstrap-adapter";
import { getReadObjectStore, getWriteObjectStore } from "../lib/storage";
import {
  applyOpsSelection,
  assertPublicReadMatchesTarget,
  opsCredentialsPresent,
  opsEnvKeys,
  takeOpsFlags,
  type OpsSelection,
} from "../lib/storage/ops-target";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";

const HELP = `Commit one discovered sealed bootstrap generation. Dry-run unless --execute.

  bun scripts/ensure-bootstrap-pointer.ts
  bun scripts/ensure-bootstrap-pointer.ts --execute
  bun scripts/ensure-bootstrap-pointer.ts --store r2 --target pre
  bun scripts/ensure-bootstrap-pointer.ts --store r2 --target pre --execute --initial-commit

--store blob is the default and does not take --initial-commit or --target.
--store r2 requires --target prod|pre. Writes use the storage driver and the bucket-identity marker.
--initial-commit is R2 only, and only when bootstrap/latest.json, views/latest.json, and canonical/v2/meta.json are absent.
`;

const webDir = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const { selection, rest } = takeOpsFlags(argv);
const initialCommit = rest.includes("--initial-commit");
const dry = rest.includes("--dry") || rest.includes("--dry-run");
const execute = rest.includes("--execute") && !dry;
const unknown = rest.filter(
  (arg) => arg !== "--initial-commit" && arg !== "--execute" && arg !== "--dry" && arg !== "--dry-run",
);
if (unknown.length > 0) throw new Error(`unknown argument ${unknown[0]}`);
if (initialCommit && selection.store !== "r2") throw new Error("--initial-commit requires --store r2");

loadWebEnvFiles(webDir, {
  keys: opsEnvKeys(selection, true),
  onDiagnostic: warnEnvFileDiagnostic,
});
applyOpsSelection(process.env, selection);

async function readPublicPointer(base: string) {
  const response = await fetch(`${base}/bootstrap/latest.json`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`bootstrap/latest.json -> ${response.status}`);
  return BootstrapPublicationPointer.parse(await response.json());
}

async function listGenerations() {
  const prefixes: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await getReadObjectStore().list({
      prefix: "bootstrap/generations/",
      mode: "folded",
      cursor,
    });
    prefixes.push(...page.folders);
    cursor = page.cursor;
  } while (cursor);
  return parseListedBootstrapGenerations(prefixes);
}

async function main(active: OpsSelection) {
  const base = await assertPublicReadMatchesTarget(process.env, active);
  const pointer = await readPublicPointer(base);
  const candidates = opsCredentialsPresent(process.env, active) ? await listGenerations() : [];
  const plan = selectBootstrapGenerationToCommit(pointer, candidates);

  console.log(JSON.stringify({ execute, store: active.store, target: active.target, plan }, null, 2));

  if (plan.action !== "commit") return;
  if (!execute) {
    console.log("dry-run: pass --execute to commit the discovered generation");
    return;
  }
  requireStorageWriteConfig();
  const result = await commitBootstrapGeneration({
    generation: plan.generation,
    store: createObjectStoreBootstrapAdapter(getWriteObjectStore()),
    initialCommit: active.store === "r2" && initialCommit,
  });
  console.log(JSON.stringify({ committed: result }, null, 2));
}

await main(selection);
