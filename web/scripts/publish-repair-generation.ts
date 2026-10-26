/** Issue #824-A: staging core only. Run with Bun --no-env-file.
 * All cf commands use one injectable runner. No pointer or recovery writes.
 * cf put has no conditional write: callers must exclude concurrent writers.
 */
import assert from "node:assert/strict";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOOTSTRAP_PHASES, bootstrapGenerationPrefix, sha256Bytes, verifyBootstrapGeneration,
} from "../../pipeline/lib/bootstrap-publication.mjs";

import { cfBytes, runCf, type CfRunner } from "./repair-publish-cf";
export { runCf, type CfRunner } from "./repair-publish-cf";
export type PublishOptions = { built: string; generation: string; bucket: string; concurrency?: number; dryRun?: boolean };
type ObjectBytes = { key: string; size: number; sha256: string; body: Buffer };
// cf r2 objects put documents a 300 MB request body limit.
const MAX_OBJECT_BYTES = 300_000_000;

function parallelism(value = 4): number {
  assert(Number.isSafeInteger(value) && value >= 1 && value <= 32, "Concurrency must be an integer from 1 to 32");
  return value;
}

export function parsePublishArgs(argv: string[]): PublishOptions {
  const fields = { "--built": "built", "--generation": "generation", "--bucket": "bucket", "--concurrency": "concurrency" } as const;
  const values: Record<string, string> = {};
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") { assert(!dryRun, "Duplicate --dry-run"); dryRun = true; continue; }
    assert(Object.hasOwn(fields, flag) && !Object.hasOwn(values, flag), `Unknown or duplicate argument: ${flag}`);
    const value = argv[++i];
    assert(value && !value.startsWith("--"), `Expected value for ${flag}`);
    values[flag] = value;
  }
  assert(values["--built"] && values["--generation"] && values["--bucket"], "Required: --built DIRECTORY --generation BOOTSTRAP_ID --bucket BUCKET");
  assert(!values["--built"].includes("://"), "Expected local builder output directory");
  return { built: values["--built"], generation: values["--generation"], bucket: values["--bucket"],
    concurrency: parallelism(values["--concurrency"] === undefined ? undefined : Number(values["--concurrency"])), dryRun };
}

/** Snapshot all verified bytes before the first cf call, including both manifests.
 * The snapshot prevents a subsequent local edit from changing uploaded content.
 */
export async function prepareRepairGeneration({ built, generation }: PublishOptions) {
  const root = resolve(built), prefix = bootstrapGenerationPrefix(generation);
  const snapshot = new Map<string, Buffer>();
  const read = async (key: string): Promise<Buffer> => {
    assert(key.startsWith(`${prefix}/`), `Outside generation: ${key}`);
    const parts = key.split("/");
    assert(parts.every((part) => part && part !== "." && !part.includes("..") && !part.includes("\\")), `Invalid object key: ${key}`);
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), "Expected regular builder directory");
    for (let i = 1; i <= parts.length; i++) {
      const stat = lstatSync(join(root, ...parts.slice(0, i)));
      assert(!stat.isSymbolicLink() && (i === parts.length ? stat.isFile() : stat.isDirectory()), `Expected regular local input: ${key}`);
    }
    const fd = openSync(join(root, key), constants.O_RDONLY | constants.O_NOFOLLOW);
    let body: Buffer;
    try {
      const stat = fstatSync(fd);
      assert(stat.isFile(), `Expected regular local input: ${key}`);
      assert(stat.size <= MAX_OBJECT_BYTES, `Object exceeds cf 300 MB body limit: ${key}`);
      body = readFileSync(fd);
      assert(body.length <= MAX_OBJECT_BYTES, `Object exceeds cf 300 MB body limit: ${key}`);
    } finally { closeSync(fd); }
    snapshot.set(key, body);
    return body;
  };
  const verified = await verifyBootstrapGeneration({ generation, store: { read } });
  const item = (key: string): ObjectBytes => {
    const body = snapshot.get(key); assert(body, `Missing verified object: ${key}`);
    return { key, size: body.length, sha256: sha256Bytes(body), body };
  };
  return BOOTSTRAP_PHASES.map((phase) => ({
    objects: verified[phase as "base" | "canonical"].manifest.objects.map((entry: { path: string }) => item(`${prefix}/${entry.path}`)),
    manifest: item(`${prefix}/manifests/${phase}.json`),
  }));
}

/** Pinned cf prints only the result array, without pagination metadata. */
async function exists(key: string, bucket: string, runner: CfRunner): Promise<boolean> {
  const perPage = 1000;
  const args = ["r2", "objects", "list", "--bucket-name", bucket, "--prefix", key, "--per-page", String(perPage)];
  const page = JSON.parse((await cfBytes(runner, args)).toString("utf8"));
  assert(Array.isArray(page) &&
    page.every((entry: { key?: unknown }) => typeof entry?.key === "string" && entry.key.startsWith(key)), "Invalid cf object listing");
  if (page.some((entry: { key: string }) => entry.key === key)) return true;
  assert(page.length < perPage, "Incomplete cf object listing");
  return false;
}

export async function publishRepairGeneration(options: PublishOptions, runner: CfRunner = runCf,
  log: (line: string) => void = console.log) {
  parallelism(options.concurrency);
  assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(options.bucket), "Expected bucket name");
  const phases = await prepareRepairGeneration(options);
  return stagePreparedRepairGeneration(options, phases, runner, log);
}

/** Stage only the immutable snapshot verified before lease acquisition. */
export async function stagePreparedRepairGeneration(options: PublishOptions,
  phases: Awaited<ReturnType<typeof prepareRepairGeneration>>, runner: CfRunner, log: (line: string) => void = console.log) {
  const concurrency = parallelism(options.concurrency);
  const result = { created: 0, skipped: 0, planned: 0 };
  if (options.dryRun) {
    for (const phase of phases) for (const { key, size, sha256 } of [...phase.objects, phase.manifest]) {
      log(JSON.stringify({ key, size, sha256 })); result.planned++;
    }
    return result;
  }
  const scratch = mkdtempSync(join(tmpdir(), "publish-repair-"));
  let failure: unknown, stopped = false, sequence = 0;
  async function stage(item: ObjectBytes) {
    const present = await exists(item.key, options.bucket, runner);
    if (stopped) return;
    if (present) {
      const body = await cfBytes(runner, ["r2", "objects", "get", item.key, "--bucket-name", options.bucket]);
      assert(body.length === item.size && sha256Bytes(body) === item.sha256, `Existing object differs: ${item.key}`);
      result.skipped++; return;
    }
    if (stopped) return;
    const file = join(scratch, `${sequence++}`);
    writeFileSync(file, item.body, { flag: "wx" });
    try {
      await cfBytes(runner, ["r2", "objects", "put", item.key, "--bucket-name", options.bucket, "--file", file,
        "--content-type", item.key.endsWith(".json") ? "application/json" : "application/octet-stream"]);
      result.created++;
    } finally { rmSync(file, { force: true }); }
  }
  async function pool(items: ObjectBytes[]) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!stopped && next < items.length) {
        try { await stage(items[next++]); }
        catch (error) { if (!stopped) failure = error; stopped = true; }
      }
    }));
    if (stopped) throw failure;
  }
  try {
    for (const phase of phases) {
      await pool(phase.objects);
      await pool([phase.manifest]);
    }
    return result;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export async function main(argv = process.argv.slice(2), runner: CfRunner = runCf, log = console.log): Promise<void> {
  const result = await publishRepairGeneration(parsePublishArgs(argv), runner, log);
  log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error("Required: use the guarded repair:publish command (web/scripts/repair-publish.ts)");
  process.exitCode = 1;
}
