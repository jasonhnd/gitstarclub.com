// Idempotent operator for a missing bootstrap/latest.json.
//
// Dry-run (default):
//   bun scripts/ensure-bootstrap-pointer.ts
//
// Commit a discovered sealed generation (requires BLOB_READ_WRITE_TOKEN):
//   bun scripts/ensure-bootstrap-pointer.ts --execute
import { list } from "@vercel/blob";
import { fileURLToPath } from "node:url";
import { createBlobBootstrapStore } from "../../pipeline/lib/blob-bootstrap-store.mjs";
import { commitBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";
import { BootstrapPublicationPointer } from "../lib/contracts";
import {
  parseListedBootstrapGenerations,
  selectBootstrapGenerationToCommit,
} from "../lib/data/ensure-bootstrap-pointer";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";

const webDir = fileURLToPath(new URL("..", import.meta.url));
loadWebEnvFiles(webDir, {
  onDiagnostic: warnEnvFileDiagnostic,
});

const execute = process.argv.includes("--execute");

async function readPublicPointer(blobBase: string) {
  const response = await fetch(`${blobBase.replace(/\/+$/, "")}/bootstrap/latest.json`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`bootstrap/latest.json -> ${response.status}`);
  return BootstrapPublicationPointer.parse(await response.json());
}

async function listGenerations(token: string) {
  const prefixes: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "bootstrap/generations/", mode: "folded", token, cursor });
    prefixes.push(...(page.folders ?? []));
    cursor = page.cursor ?? undefined;
  } while (cursor);
  return parseListedBootstrapGenerations(prefixes);
}

async function main() {
  const blobBase = process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) throw new Error("BLOB_BASE_URL is required");
  const pointer = await readPublicPointer(blobBase);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const candidates = token ? await listGenerations(token) : [];
  const plan = selectBootstrapGenerationToCommit(pointer, candidates);

  console.log(JSON.stringify({ execute, plan }, null, 2));

  if (plan.action !== "commit") return;
  if (!execute) {
    console.log("dry-run: pass --execute to commit the discovered generation");
    return;
  }
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for --execute");
  const result = await commitBootstrapGeneration({
    generation: plan.generation,
    store: createBlobBootstrapStore(token),
  });
  console.log(JSON.stringify({ committed: result }, null, 2));
}

await main();
