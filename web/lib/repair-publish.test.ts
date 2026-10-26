import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bootstrapGenerationPrefix, buildBootstrapPhaseManifest, sha256Bytes, verifyBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";
import { ACTIVE_WORKFLOW_PATH as LEASE } from "../../pipeline/lib/bootstrap-lease.mjs";
import { RECOVERY_BASE_PREFIX as BASE, RECOVERY_CANONICAL_KEYS, RepairPublicationError } from "../scripts/repair-publish-commit";
import { main, parseRepairArgs, reportRepairError } from "../scripts/repair-publish";
import { formatRollbackCommand, type PublishTarget } from "../scripts/repair-publish-target";
import type { CfRunner } from "../scripts/repair-publish-cf";

const GEN = "bootstrap-repaired-824d", RECOVERY = "bootstrap-recovery-824d", POINTER = "bootstrap/latest.json";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });

// cf@1.0.0-beta.18: result array + newline, raw GET bytes, boxed APIError.
// No envelope, pagination metadata, URL decoding, or JSON error parsing.
function boxedError(key: string, status = 500) {
  return `\n┌ APIError\n│ [${status === 404 ? "10007" : "10000"}] ${status === 404 ? "The specified key does not exist." : "Injected failure"}\n│ ${status} ${status === 404 ? "Not Found" : "Internal Server Error"} · HTTP /accounts/fake/r2/buckets/fake/objects/${encodeURIComponent(key)}\n└\n`;
}
const buckets = { pre: "gitstarclub-data-pre", production: "gitstarclub-data-prod", rehearsal: "gitstarclub-data-rehearsal" };
const confirmation = (target: PublishTarget, generation: string) => target === "rehearsal"
  ? `rehearse ${generation} in ${buckets[target]}` : `publish ${generation} to ${buckets[target]}`;
function fixture(target: PublishTarget = "production") {
  const root = mkdtempSync(join(tmpdir(), "repair-824d-")); scratch.push(root);
  const bucketDir = join(root, "bucket"), built = join(root, "built");
  const bucket = buckets[target];
  const events: string[] = [], calls: string[][] = [];
  const put = (directory: string, key: string, body: Buffer) => {
    const path = join(directory, key); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body);
  };
  const read = (key: string) => readFileSync(join(bucketDir, key));
  const seed = (key: string, value: unknown) => put(bucketDir, key, encode(value));
  const keys = (directory = bucketDir, prefix = ""): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? keys(join(directory, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
  seed("_meta/bucket-identity.json", { bucket, deploy_env: target });
  const basePaths = ["meta.json", "lookup/repos.json", "lookup/orgs.json", "rank/all-time/repo/stock.json",
    "rank/all-time/org/stock.json", "heatmap/month/2026-05.json", "entity/repo/1.json"];
  for (const path of basePaths) seed(`${BASE}${path}`, { frozen: path });
  for (const key of RECOVERY_CANONICAL_KEYS) seed(key, { frozen: key });
  const inventoryFile = join(root, "recovery-base-keys.json");
  writeFileSync(inventoryFile, encode(basePaths.map((path) => {
    const key = `${BASE}${path}`, body = read(key);
    return { key, bytes: body.length, sha256: sha256Bytes(body) };
  })));
  const prefix = bootstrapGenerationPrefix(GEN);
  for (const phase of ["base", "canonical"] as const) {
    const paths = phase === "base" ? basePaths.map((path) => `views/${path}`)
      : ["canonical/v2/meta.json", ...["repos", "repo-monthly", "repo-weekly", "repo-recent-daily"].flatMap((family) =>
        Array.from({ length: 32 }, (_, shard) => `canonical/v2/${family}/${shard}.json`)), "canonical/v2/site-daily/2026.json"];
    const items = paths.map((path) => ({ path, body: encode({ repaired: path }) }));
    for (const { path, body } of items) put(built, `${prefix}/${path}`, body);
    put(built, `${prefix}/manifests/${phase}.json`, encode(buildBootstrapPhaseManifest(GEN, phase, items)));
  }
  let hook: ((args: string[], body?: Buffer) => boolean) | undefined;
  let listing: ((prefix: string) => unknown) | undefined;
  const runner: CfRunner = async (args, child) => {
    expect(child.env.CF_DELEGATION).toBe("1");
    expect(args.slice(0, 2)).toEqual(["r2", "objects"]);
    expect(args[args.indexOf("--bucket-name") + 1]).toBe(bucket);
    expect(args).not.toContain("--cursor"); expect(args).not.toContain("--delimiter");
    calls.push([...args]);
    const op = args[2], key = args[3];
    const body = op === "put" ? readFileSync(args[args.indexOf("--file") + 1]) : undefined;
    events.push(`${op} ${key}`);
    if (hook?.(args, body)) return { code: 1, stdout: "", stderr: boxedError(key) };
    if (op === "list") {
      const prefix = args[args.indexOf("--prefix") + 1];
      expect(args[args.indexOf("--per-page") + 1]).toBe("1000");
      return { code: 0, stdout: JSON.stringify(listing?.(prefix) ?? keys().filter((key) => key.startsWith(prefix)).sort().slice(0, 1000)
        .map((key) => ({ key, size: read(key).length, uploaded: "2026-10-26T00:00:00Z" })), null, 2) + "\n", stderr: "" };
    }
    if (op === "get") return existsSync(join(bucketDir, key)) ? { code: 0, stdout: read(key), stderr: "" }
      : { code: 1, stdout: "", stderr: boxedError(key, 404) };
    if (op === "put") { put(bucketDir, key, body!); return { code: 0, stdout: "", stderr: "" }; }
    throw new Error(`Unexpected operation: ${op}`);
  };
  const args = ["--target", target, "--bucket", bucket, "--generation-dir", built, "--recovery-generation", RECOVERY,
    "--recovery-base-keys", inventoryFile, ...(target !== "pre" ? ["--confirm-production", confirmation(target, GEN)] : [])];
  const log = (line: string) => events.push(`log ${line}`);
  const run = (extra: string[] = []) => main([...args, ...extra], runner, log);
  const writes = () => calls.filter((call) => call[2] === "put");
  const snapshot = () => keys().sort().map((key) => [key, read(key).toString("base64")]);
  return { root, bucketDir, built, bucket, args, read, seed, put, keys, runner, events, calls, run, writes, snapshot, log,
    hook: (value: typeof hook) => { hook = value; }, listing: (value: typeof listing) => { listing = value; } };
}

for (const target of ["production", "pre", "rehearsal"] as const) test(`complete ${target} command publishes today's idle layout and prints rollback before first write`, async () => {
  const h = fixture(target), sources = h.snapshot();
  expect(h.keys().filter((key) => [LEASE, POINTER, "views/latest.json"].includes(key))).toEqual([]);
  expect(h.keys().filter((key) => key.startsWith("canonical/"))).toHaveLength(33);
  const result = await h.run();
  const pointer = JSON.parse(h.read(POINTER).toString());
  expect(pointer.generation).toBe(GEN); expect(pointer.previous_generation).toBe(RECOVERY);
  expect(result.status).toBe("published");
  const firstWrite = h.events.findIndex((line) => line.startsWith("put "));
  const rollback = formatRollbackCommand(target, RECOVERY);
  expect(h.events.indexOf(`log ${rollback}`)).toBeLessThan(firstWrite);
  expect(h.events.indexOf(`log ${rollback}`)).toBeGreaterThan(0);
  expect(h.writes()[0][3]).toBe(LEASE);
  const recoveryEnd = h.writes().findIndex((call) => call[3] === `${bootstrapGenerationPrefix(RECOVERY)}/manifests/canonical.json`);
  const stageStart = h.writes().findIndex((call) => call[3].startsWith(`${bootstrapGenerationPrefix(GEN)}/`));
  expect(recoveryEnd).toBeLessThan(stageStart);
  expect(JSON.parse(h.read(LEASE).toString()).status).toBe("published");
  expect(h.writes().at(-1)![3]).toBe(LEASE);
  expect(h.keys()).not.toContain("views/latest.json");
  for (const [key, body] of sources) expect(h.read(key).toString("base64")).toBe(body);
  const store = { read: async (key: string) => h.read(key) };
  const recovery = await verifyBootstrapGeneration({ generation: RECOVERY, store });
  expect(recovery.canonical.manifest.object_count).toBe(33);
  await verifyBootstrapGeneration({ generation: GEN, store });
  h.calls.length = 0;
  expect((await h.run()).status).toBe("already-published");
  expect(h.writes().every((call) => call[3] === LEASE)).toBe(true);
  // Execute the exact printed rollback argv through the same guarded entry.
  const rollbackArgs = rollback.slice(rollback.indexOf(" --target ") + 1).match(/"[^"]*"|\S+/g)!.map((value) => value.replace(/^"|"$/g, ""));
  await main(rollbackArgs, h.runner, h.log);
  expect(JSON.parse(h.read(POINTER).toString()).generation).toBe(RECOVERY);
  expect(JSON.parse(h.read(POINTER).toString()).previous_generation).toBe(GEN);
  const pointerBeforeRetry = h.read(POINTER);
  expect((await main(rollbackArgs, h.runner, h.log)).status).toBe("already-rolled-back");
  expect(h.read(POINTER)).toEqual(pointerBeforeRetry);
});

for (const target of ["production", "rehearsal"] as const) describe(`${target} production-path scenarios`, () => {
  test("retry after mid-upload failure resumes matching objects without changing the pointer early", async () => {
    const h = fixture(target); let count = 0;
    h.hook((args) => args[2] === "put" && args[3].startsWith(`${bootstrapGenerationPrefix(GEN)}/`) && ++count === 4);
    await expect(h.run()).rejects.toThrow("Injected failure");
    expect(h.keys()).not.toContain(POINTER);
    expect(JSON.parse(h.read(LEASE).toString()).status).toBe("failed");
    const previous = h.writes().filter((args) => args[3].startsWith(`${bootstrapGenerationPrefix(GEN)}/`)).slice(0, 3).map((args) => args[3]);
    h.hook(undefined); h.calls.length = 0;
    await h.run();
    for (const key of previous) expect(h.writes().some((args) => args[3] === key)).toBe(false);
    expect(JSON.parse(h.read(POINTER).toString()).previous_generation).toBe(RECOVERY);
  });

  test("existing different staged bytes refuse without changing an existing pointer", async () => {
    const h = fixture(target);
    await h.run(); const before = h.read(POINTER);
    // A completed command retry still refuses mutated generation bytes.
    h.seed(`${bootstrapGenerationPrefix(GEN)}/views/meta.json`, { conflict: true });
    h.calls.length = 0;
    await expect(h.run()).rejects.toThrow("Existing object differs");
    expect(h.read(POINTER)).toEqual(before);
    expect(h.writes().some((args) => args[3] === POINTER)).toBe(false);
  });

  for (const mutation of ["bucket", "identity", "confirmation", "target"]) test(`${mutation} guard refuses before every write`, async () => {
    const h = fixture(target), args = [...h.args];
    if (mutation === "bucket") args[args.indexOf("--bucket") + 1] = "gitstarclub-data-pre";
    if (mutation === "target") args[args.indexOf("--target") + 1] = "production ";
    if (mutation === "confirmation") args[args.indexOf("--confirm-production") + 1] += " ";
    if (mutation === "identity") h.seed("_meta/bucket-identity.json", { bucket: h.bucket, deploy_env: "pre" });
    const before = h.snapshot();
    await expect(main(args, h.runner, h.log)).rejects.toThrow();
    expect(h.writes()).toHaveLength(0); expect(h.snapshot()).toEqual(before);
    expect(h.calls).toHaveLength(mutation === "identity" ? 1 : 0);
  });

  for (const damage of ["digest", "missing manifest", "symlink", "oversized"]) test(`${damage} in builder output refuses before lease or recovery writes`, async () => {
    const h = fixture(target), path = join(h.built, bootstrapGenerationPrefix(GEN), "views/meta.json");
    if (damage === "digest") writeFileSync(path, "{}");
    if (damage === "missing manifest") rmSync(join(h.built, bootstrapGenerationPrefix(GEN), "manifests/canonical.json"));
    if (damage === "symlink") { rmSync(path); symlinkSync("lookup/repos.json", path); }
    if (damage === "oversized") truncateSync(path, 300_000_001);
    await expect(h.run()).rejects.toThrow(); expect(h.writes()).toHaveLength(0);
    expect(h.calls).toHaveLength(1); // identity only
  });

  for (const key of [`${BASE}meta.json`, RECOVERY_CANONICAL_KEYS[1]]) test(`missing fixed recovery source ${key} refuses first publication`, async () => {
    const h = fixture(target);
    rmSync(join(h.bucketDir, key));
    await expect(h.run()).rejects.toThrow();
    expect(h.keys()).not.toContain(POINTER);
    expect(h.writes().some((args) => args[3].startsWith(`${bootstrapGenerationPrefix(GEN)}/`))).toBe(false);
  });

  test("dry-run prints all steps and every prospective key with zero runner writes", async () => {
    const h = fixture(target), before = h.snapshot();
    await h.run(["--dry-run"]);
    expect(h.writes()).toHaveLength(0); expect(h.snapshot()).toEqual(before);
    const planned = h.events.filter((line) => line.startsWith("log WOULD WRITE ")).map((line) => line.slice("log WOULD WRITE ".length));
    expect(planned[0]).toBe(LEASE); expect(planned.at(-1)).toBe(LEASE);
    expect(planned).toContain(POINTER);
    for (const phase of ["base", "canonical"]) {
      const manifestKey = `${bootstrapGenerationPrefix(GEN)}/manifests/${phase}.json`;
      expect(planned).toContain(manifestKey);
      const manifest = JSON.parse(readFileSync(join(h.built, manifestKey), "utf8"));
      for (const item of manifest.objects) expect(planned).toContain(`${bootstrapGenerationPrefix(GEN)}/${item.path}`);
      expect(planned).toContain(`${bootstrapGenerationPrefix(RECOVERY)}/manifests/${phase}.json`);
    }
    for (const { key } of JSON.parse(readFileSync(join(h.root, "recovery-base-keys.json"), "utf8"))) {
      expect(planned).toContain(`${bootstrapGenerationPrefix(RECOVERY)}/views/${key.slice(BASE.length)}`);
    }
    for (const key of RECOVERY_CANONICAL_KEYS) expect(planned).toContain(`${bootstrapGenerationPrefix(RECOVERY)}/${key}`);
    // Dry-run rollback also uses no runner writes.
    await h.run(); h.calls.length = 0; const published = h.snapshot();
    await main(["--target", target, "--bucket", h.bucket, "--rollback", RECOVERY, "--confirm-production", confirmation(target, RECOVERY), "--dry-run"], h.runner, h.log);
    expect(h.writes()).toHaveLength(0); expect(h.snapshot()).toEqual(published);
  });

  test("full listing without exact key is uncertain; boxed get failures are never absence", async () => {
    for (const failure of ["full page", "get error"]) {
      const h = fixture(target);
      if (failure === "full page") h.listing((prefix) => prefix === LEASE
        ? Array.from({ length: 1000 }, (_, i) => ({ key: `${prefix}/child-${i}`, size: 2 })) : undefined);
      else h.hook((args) => args[2] === "get" && args[3] === `${BASE}meta.json`);
      await expect(h.run()).rejects.toThrow(failure === "full page" ? "Ambiguous" : "Injected failure");
      expect(h.keys()).not.toContain(POINTER);
      if (failure === "full page") expect(h.writes()).toHaveLength(0);
    }
  });

  test("post-commit release failure is reported separately with pointer already committed", async () => {
    const h = fixture(target);
    h.hook((args, body) => args[2] === "put" && args[3] === LEASE && JSON.parse(body!.toString()).status === "published");
    try { await h.run(); throw new Error("Expected release failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(RepairPublicationError);
      expect((error as RepairPublicationError).phase).toBe("release");
      expect((error as RepairPublicationError).pointerMayHaveMoved).toBe(true);
      const lines: string[] = []; reportRepairError(error, (line) => lines.push(line));
      expect(lines.join("\n")).toContain("lease release failed separately");
    }
    expect(JSON.parse(h.read(POINTER).toString()).generation).toBe(GEN);
  });

  test("cleanup error preserves the stage failure and reports the separate release error", async () => {
    const h = fixture(target);
    h.hook((args, body) => args[2] === "put" && (args[3].startsWith(`${bootstrapGenerationPrefix(GEN)}/`)
      || (args[3] === LEASE && JSON.parse(body!.toString()).status === "failed")));
    try { await h.run(); throw new Error("Expected stage failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(RepairPublicationError);
      expect((error as RepairPublicationError).releaseError).toBeDefined();
      const lines: string[] = []; reportRepairError(error, (line) => lines.push(line));
      expect(lines.join("\n")).toContain("Separate lease release failure:");
    }
    expect(h.keys()).not.toContain(POINTER);
  });

  test("parser refuses incomplete/duplicate/mixed arguments and accepts bun's separator", () => {
    const h = fixture(target);
    expect(parseRepairArgs(["--", ...h.args]).generation).toBe(GEN);
    for (const args of [[], ["--target"], [...h.args, "--bucket", h.bucket], [...h.args, "--dry-run", "--dry-run"],
      [...h.args, "--rollback", RECOVERY], [...h.args, "--unknown", "x"]]) expect(() => parseRepairArgs(args)).toThrow();
  });

  test("command option refusal exits nonzero without starting cf or reading ambient target defaults", () => {
    const child = Bun.spawnSync([process.execPath, "--no-env-file", join(import.meta.dir, "../scripts/repair-publish.ts"), "--target", "bad", "--bucket", "bad", "--rollback", GEN],
      { env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(1); expect(child.stderr.toString()).toContain("--target must be pre or production");
  });
});

for (const target of ["pre", "production", "rehearsal"] as const) {
  for (const bucket of Object.values(buckets).filter((bucket) => bucket !== buckets[target])) {
    test(`${target} command refuses mixed bucket ${bucket} before any cf call`, async () => {
      const h = fixture(target), args = [...h.args];
      args[args.indexOf("--bucket") + 1] = bucket;
      await expect(main(args, h.runner, h.log)).rejects.toThrow(`requires bucket ${h.bucket}`);
      expect(h.calls).toEqual([]);
    });
  }
}
