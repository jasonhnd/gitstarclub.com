/** Guarded repair publisher. Execute with Bun --no-env-file; no ambient targets. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapGenerationPrefix, sha256Bytes } from "../../pipeline/lib/bootstrap-publication.mjs";
import { ACTIVE_WORKFLOW_PATH } from "../../pipeline/lib/bootstrap-lease.mjs";
import { prepareRepairGeneration, stagePreparedRepairGeneration } from "./publish-repair-generation";
import { publishRepairGeneration, rollbackRepairGeneration, RepairPublication, RepairPublicationError, RECOVERY_BASE_PREFIX, RECOVERY_CANONICAL_KEYS } from "./repair-publish-commit";
import { resolvePublishTarget, formatRollbackCommand } from "./repair-publish-target";
import { runCf, type CfRunner } from "./repair-publish-cf";

export function parseRepairArgs(argv: string[]) {
  const allowed = ["--target", "--bucket", "--generation-dir", "--generation", "--recovery-generation", "--recovery-base-keys", "--confirm-production", "--rollback"];
  const values: Record<string, string> = {};
  let dryRun = false;
  // bun run SCRIPT -- FLAGS forwards the separator to the script.
  if (argv[0] === "--") argv = argv.slice(1);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") { assert(!dryRun, "Duplicate --dry-run"); dryRun = true; continue; }
    assert(allowed.includes(flag) && !Object.hasOwn(values, flag), `Unknown or duplicate argument: ${flag}`);
    const value = argv[++i];
    assert(value && !value.startsWith("--"), `Expected value for ${flag}`);
    values[flag] = value;
  }
  assert(values["--target"] && values["--bucket"], "Required: --target pre|production|rehearsal --bucket NAME");
  const rollback = values["--rollback"];
  if (rollback) {
    assert(!["--generation-dir", "--generation", "--recovery-generation", "--recovery-base-keys"].some((flag) => values[flag]), "--rollback cannot publish builder output");
  } else {
    assert(values["--generation-dir"] && values["--recovery-base-keys"], "Required: --generation-dir DIRECTORY --recovery-base-keys INVENTORY_JSON");
    assert(!values["--generation-dir"].includes("://"), "Expected local builder output directory");
  }
  const built = values["--generation-dir"];
  let generation = rollback ?? values["--generation"];
  if (!generation) {
    const entries = readdirSync(join(built, "bootstrap/generations"), { withFileTypes: true });
    assert(entries.length === 1 && entries[0].isDirectory(), "Builder output must contain exactly one generation; otherwise pass --generation");
    generation = entries[0].name;
  }
  bootstrapGenerationPrefix(generation);
  const recoveryGeneration = values["--recovery-generation"] ?? `bootstrap-recovery-${sha256Bytes(Buffer.from(generation)).slice(0, 24)}`;
  bootstrapGenerationPrefix(recoveryGeneration);
  assert(generation !== recoveryGeneration, "Recovery generation must differ from publication");
  return { target: values["--target"], bucket: values["--bucket"], generation, recoveryGeneration,
    built, recoveryBaseKeysFile: values["--recovery-base-keys"], confirmProduction: values["--confirm-production"], rollback, dryRun };
}

/** Simulate writes privately, forwarding ONLY list/get to the real read runner.
 * The unchanged lease/seal/stage/commit path verifies its simulated readbacks.
 */
function dryRunRunner(readRunner: CfRunner, log: (line: string) => void): CfRunner {
  const overlay = new Map<string, Buffer>();
  return async (args, child) => {
    const operation = args[2], key = args[3];
    if (operation === "put") {
      overlay.set(key, readFileSync(args[args.indexOf("--file") + 1]));
      log(`WOULD WRITE ${key}`);
      return { code: 0, stdout: "", stderr: "" };
    }
    assert(operation === "get" || operation === "list", `Dry run refuses cf ${operation}`);
    if (operation === "get" && overlay.has(key)) return { code: 0, stdout: overlay.get(key)!, stderr: "" };
    const result = await readRunner(args, child);
    if (operation !== "list" || result.code !== 0) return result;
    const page = JSON.parse(result.stdout.toString());
    assert(Array.isArray(page), "Invalid cf object listing");
    const prefix = args[args.indexOf("--prefix") + 1];
    // Keep the upstream array intact so full-page ambiguity and malformed entries
    // still fail closed in the original modules.
    return { ...result, stdout: JSON.stringify([...page.map((entry) => overlay.has(entry?.key)
      ? { ...entry, size: overlay.get(entry.key)!.length } : entry),
    ...[...overlay].filter(([key]) => key.startsWith(prefix) && !page.some((entry) => entry?.key === key))
      .map(([key, body]) => ({ key, size: body.length }))]) };
  };
}

export async function main(argv = process.argv.slice(2), runner: CfRunner = runCf, log: (line: string) => void = console.log) {
  const options = parseRepairArgs(argv);
  log("STEP resolve and guard target (read only)");
  const target = await resolvePublishTarget(options, runner);
  // This line must precede even the first lease or recovery put.
  log(formatRollbackCommand(target.target, options.rollback ?? options.recoveryGeneration));
  const workDir = mkdtempSync(join(tmpdir(), "repair-publish-"));
  const effectiveRunner = options.dryRun ? dryRunRunner(runner, log) : runner;
  const commitOptions = { ...options, runCf: effectiveRunner, workDir };
  try {
    if (options.rollback) {
      log("STEP acquire lease; verify sealed rollback generation; swap bootstrap/latest.json; release lease");
      const result = await rollbackRepairGeneration(commitOptions);
      log(`${options.dryRun ? "DRY RUN " : ""}${result.status}: ${options.generation}`);
      return result;
    }
    log("STEP verify both builder manifests and every local object (SHA-256, size cap, no symlinks)");
    const stageOptions = { built: options.built, generation: options.generation, bucket: target.bucket };
    const prepared = await prepareRepairGeneration(stageOptions);
    // Validate the explicit inventory before acquiring the lease as well.
    const inventory = await new RepairPublication(commitOptions).baseInventory();
    log(`STEP acquire lease: ${ACTIVE_WORKFLOW_PATH}`);
    log(`STEP seal and verify recovery: ${options.recoveryGeneration} (${inventory.length} base objects from ${RECOVERY_BASE_PREFIX}; ${RECOVERY_CANONICAL_KEYS.length} canonical objects)`);
    const result = await publishRepairGeneration({ ...commitOptions, stage: async (publication) => {
      log("STEP stage new generation create-only (matching bytes resume)");
      const staged = await stagePreparedRepairGeneration(stageOptions, prepared, publication.stageRunner);
      log(JSON.stringify(staged));
      log("STEP verify staged generation; commit bootstrap/latest.json with recoveryGeneration; release lease");
    } });
    log(`${options.dryRun ? "DRY RUN " : ""}${result.status}: ${options.generation}; recoveryGeneration: ${options.recoveryGeneration}`);
    return result;
  } finally {
    // Both verification phases and lease release settle inside the awaited
    // publication/rollback calls before any scratch files can be removed.
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function reportRepairError(error: unknown, log: (line: string) => void = console.error) {
  log(error instanceof Error ? error.message : String(error));
  if (error instanceof RepairPublicationError) {
    log(`phase=${error.phase}; pointerMayHaveMoved=${error.pointerMayHaveMoved}`);
    if (error.releaseError) log(`Separate lease release failure: ${String(error.releaseError)}`);
    if (error.phase === "release") log("Pointer commit succeeded; lease release failed separately. Inspect the pointer and lease before retrying.");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { reportRepairError(error); process.exitCode = 1; });
}
