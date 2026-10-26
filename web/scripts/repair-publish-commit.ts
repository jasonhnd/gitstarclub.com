/**
 * Issue #824-B: library only; no default runner, CLI, credentials or target
 * authorization. The integration caller supplies a guarded bucket and workDir.
 * cf 1.0.0-beta.18 get returns raw bytes; recovery and commit accept UTF-8
 * JSON snapshots only; source digests and byte lengths guard every copy.
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ACTIVE_WORKFLOW_PATH, parseBootstrapLease } from "../../pipeline/lib/bootstrap-lease.mjs";
import {
  BOOTSTRAP_POINTER_PATH, bootstrapGenerationPrefix, commitBootstrapGeneration,
  sha256Bytes, stageBootstrapPhase, verifyBootstrapGeneration, rollbackBootstrapGeneration,
} from "../../pipeline/lib/bootstrap-publication.mjs";
import { BootstrapPublicationPointer } from "../lib/contracts/workflow";

/** The injected runner must pass env to its child process unchanged. */
import { cfResult, limitCfConcurrency, repairConcurrency, type CfRetryOptions, type CfRunner } from "./repair-publish-cf";
export type { CfRunner } from "./repair-publish-cf";
export const RECOVERY_BASE_PREFIX = "views/refresh-2026-09-13T06-00-16-398Z/";
export const RECOVERY_CANONICAL_KEYS = Object.freeze(["canonical/v2/meta.json",
  ...Array.from({ length: 32 }, (_, shard) => `canonical/v2/repos/${shard}.json`)]);
const REQUIRED_BASE_PATHS = ["meta.json", "lookup/repos.json", "lookup/orgs.json",
  "rank/all-time/repo/stock.json", "rank/all-time/org/stock.json"];
const PER_PAGE = 1000;
export type RepairCommitOptions = {
  bucket: string; runCf: CfRunner; workDir: string; concurrency?: number; retry?: CfRetryOptions;
  generation: string; recoveryGeneration: string; recoveryBaseKeysFile: string; now?: () => number;
  stage?: (publication: RepairPublication) => Promise<void>;
};
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const equal = (a: Buffer | null, b: Buffer | null) => a === null || b === null ? a === b : a.equals(b);
const TTL = 600_000;
type SourceEntry = { key: string; bytes?: number; sha256?: string };

export class RepairPublicationError extends Error {
  constructor(readonly phase: "acquire" | "seal" | "stage" | "commit" | "release", readonly pointerMayHaveMoved: boolean,
    cause: unknown, readonly releaseError?: unknown) {
    super(`${phase}: ${cause instanceof Error ? cause.message : String(cause)}${pointerMayHaveMoved ? "; bootstrap pointer may have moved" : ""}`,
      { cause });
  }
}

/**
 * ADVISORY lease only: cf put has no conditional write. Read-verify-write plus
 * owner-token readback cannot prevent another writer from winning between our
 * final read and put (including release, create checks and pointer writes).
 * This is weaker than the importer's atomic fencing: a single-writer maintenance
 * window is required. See plans/824b-lease.md. No atomic CAS is emulated here.
 */
export class RepairPublication {
  private lease: ReturnType<typeof parseBootstrapLease> = null;
  private lastRenew = 0;
  private renewal?: Promise<void>;
  private releasing = false;
  private source?: { bootstrap: Buffer | null; managed: Buffer | null };
  pointerWriteAttempted = false;
  private rollingBack = false;
  private readonly now: () => number;
  private readonly owner = randomUUID();
  private readonly runner: CfRunner;
  private readonly concurrency: number;
  constructor(readonly options: RepairCommitOptions) {
    bootstrapGenerationPrefix(options.generation);
    bootstrapGenerationPrefix(options.recoveryGeneration);
    if (options.generation === options.recoveryGeneration) throw new Error("Recovery generation must differ from publication");
    this.now = options.now ?? Date.now;
    this.concurrency = repairConcurrency(options.concurrency);
    this.runner = limitCfConcurrency(options.runCf, this.concurrency);
  }

  private run(args: string[]) {
    return cfResult(this.runner, ["r2", "objects", ...args, "--bucket-name", this.options.bucket], this.options.retry);
  }

  private async cfResult(args: string[]) {
    let heartbeatError: unknown;
    let pending: Promise<void> | undefined;
    const leaseCommand = args[0] === "list"
      ? args[args.indexOf("--prefix") + 1] === ACTIVE_WORKFLOW_PATH
      : args[1] === ACTIVE_WORKFLOW_PATH;
    const timer = leaseCommand ? undefined : setInterval(() => {
      pending = this.heartbeat().catch((error) => { heartbeatError = error; });
    }, 30_000);
    try {
      const result = await this.run(args);
      await pending;
      if (heartbeatError) throw heartbeatError;
      return result;
    } finally {
      clearInterval(timer);
      await pending;
    }
  }

  private async cf(args: string[]): Promise<string> {
    return (await this.cfResult(args)).stdout.toString();
  }

  /** A's uploads share B's renewal timer, including a single slow cf call. */
  readonly stageRunner: CfRunner = async (args) => {
    await this.guardStage();
    const bucketAt = args.indexOf("--bucket-name");
    if (args[0] !== "r2" || args[1] !== "objects" || bucketAt < 3 || args[bucketAt + 1] !== this.options.bucket) {
      throw new Error("Staging command escaped guarded bucket");
    }
    const command = [...args.slice(2, bucketAt), ...args.slice(bucketAt + 2)];
    const result = await this.cfResult(command);
    await this.assertOwned();
    return result;
  };

  private jsonBody(path: string, text: string, size?: number): Buffer {
    const body = Buffer.from(text);
    if (size !== undefined && body.length !== size) throw new Error(`JSON snapshot byte-size mismatch: ${path}`);
    if (!path.endsWith(".json")) throw new Error(`Non-JSON snapshot refused: ${path}`);
    JSON.parse(text);
    return body;
  }

  // Mirror publish-repair-generation.ts's full-key existence check for EVERY
  // read, including controls. A get failure after presence is never absence.
  private async controlRead(path: string): Promise<Buffer | null> {
    // beta.18 stdout is ONLY an array. It has no pagination metadata. This
    // proves exact-key presence, never the completeness of a prefix inventory.
    const page = JSON.parse(await this.cf(["list", "--prefix", path, "--per-page", String(PER_PAGE)]));
    const seen = new Set<string>();
    if (!Array.isArray(page) || page.length > PER_PAGE || page.some((item) => {
      if (typeof item?.key !== "string" || !item.key.startsWith(path) ||
          !Number.isSafeInteger(item.size) || item.size < 0 || seen.has(item.key)) return true;
      seen.add(item.key); return false;
    })) throw new Error("Invalid cf object listing");
    const item = page.find((entry) => entry.key === path);
    if (!item) {
      if (page.length === PER_PAGE) throw new Error(`Ambiguous exact-key absence: ${path}`);
      return null;
    }
    return this.jsonBody(path, await this.cf(["get", path]), item.size);
  }

  private async rawRead(path: string): Promise<Buffer | null> {
    if (path === ACTIVE_WORKFLOW_PATH) return this.controlRead(path);
    await this.heartbeat();
    const body = await this.controlRead(path);
    await this.heartbeat();
    return body;
  }

  private async rawPut(path: string, body: Buffer): Promise<void> {
    await mkdir(this.options.workDir, { recursive: true });
    const scratch = await mkdtemp(join(this.options.workDir, "repair-put-"));
    try {
      const file = join(scratch, "body");
      await writeFile(file, body, { flag: "wx" });
      await this.cf(["put", path, "--file", file, "--content-type", "application/json"]);
      const actual = await this.rawRead(path);
      if (!actual || sha256Bytes(actual) !== sha256Bytes(body)) throw new Error(`SHA-256 readback mismatch: ${path}`);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }

  private owns(current: ReturnType<typeof parseBootstrapLease>): boolean {
    return !!current && !!this.lease && current.run_id === this.lease.run_id && current.fencing_token === this.lease.fencing_token && current.status === "running";
  }

  async acquire(): Promise<void> {
    if (this.lease) throw new Error("Publication already holds a lease");
    this.releasing = false;
    const before = await this.controlRead(ACTIVE_WORKFLOW_PATH);
    const active = parseBootstrapLease(before);
    if (active?.status === "running" && Date.parse(active.expires_at) > this.now()) throw new Error("Publication blocked by active workflow lease");
    if (!equal(before, await this.controlRead(ACTIVE_WORKFLOW_PATH))) throw new Error("Workflow lease changed before acquisition");
    const at = this.now();
    const lease = { run_id: `bootstrap-publish-${this.options.generation}-${this.owner}`, status: "running" as const,
      fencing_token: (active?.fencing_token ?? 0) + 1, acquired_at: new Date(at).toISOString(),
      expires_at: new Date(at + TTL).toISOString(), idempotency_key: `repair:${this.owner}`, trigger: "bootstrap-cli" };
    this.lease = lease; this.lastRenew = at;
    try {
      await this.rawPut(ACTIVE_WORKFLOW_PATH, encode(lease));
      await this.assertOwned();
    } catch (error) {
      try { await this.releaseIfOwned("failed"); }
      catch (releaseError) { throw new RepairPublicationError("acquire", false, error, releaseError); }
      throw error;
    }
  }

  async assertOwned(): Promise<void> {
    const current = parseBootstrapLease(await this.controlRead(ACTIVE_WORKFLOW_PATH));
    if (!this.owns(current) || Date.parse(current!.expires_at) <= this.now()) throw new Error("Publication lost or expired workflow lease");
  }

  private async heartbeat(): Promise<void> {
    // Lease reads/listings must not recursively trigger renewal.
    if (!this.lease || this.releasing) return;
    if (this.renewal) return this.renewal;
    if (this.now() - this.lastRenew < 30_000) return;
    this.renewal = (async () => {
      await this.assertOwned();
      const renewed = { ...this.lease!, expires_at: new Date(this.now() + TTL).toISOString() };
      await this.assertOwned();
      await this.rawPut(ACTIVE_WORKFLOW_PATH, encode(renewed));
      this.lease = renewed;
      this.lastRenew = this.now();
    })().finally(() => { this.renewal = undefined; });
    return this.renewal;
  }

  async guardStage(): Promise<void> {
    await this.heartbeat();
    await this.assertOwned();
    await this.assertSourceUnchanged();
  }

  async rollback() {
    await this.assertOwned();
    this.source = { bootstrap: await this.controlRead(BOOTSTRAP_POINTER_PATH), managed: await this.controlRead("views/latest.json") };
    this.rollingBack = true;
    const result = await rollbackBootstrapGeneration({ targetGeneration: this.options.generation, store: this.store,
      assertCanCommit: () => this.assertOwned(), now: () => new Date(this.now()).toISOString() });
    const actual = await this.store.read(BOOTSTRAP_POINTER_PATH);
    if (!actual || !actual.equals(encode(result.pointer))) throw new Error("Rollback pointer readback mismatch");
    return result;
  }

  async release(status: "published" | "failed"): Promise<void> {
    this.releasing = true;
    // Workers report renewal failures; they must not prevent owned-lease cleanup.
    await Promise.allSettled([this.renewal]);
    await this.assertOwned();
    const at = new Date(this.now()).toISOString();
    const released = { ...this.lease!, status, acquired_at: at, expires_at: at };
    await this.assertOwned();
    // Disable heartbeat while marking the lease complete.
    this.lastRenew = this.now();
    await this.rawPut(ACTIVE_WORKFLOW_PATH, encode(released));
    this.lease = null;
  }

  async releaseIfOwned(status: "published" | "failed"): Promise<void> {
    this.releasing = true;
    await Promise.allSettled([this.renewal]);
    if (!this.lease) return;
    const current = parseBootstrapLease(await this.controlRead(ACTIVE_WORKFLOW_PATH));
    if (this.owns(current)) await this.release(status);
  }

  readonly store = {
    read: async (path: string) => { await this.heartbeat(); return this.rawRead(path); },
    create: async (path: string, body: Buffer) => {
      if (!path.startsWith(`${bootstrapGenerationPrefix(this.options.recoveryGeneration)}/`)) throw new Error("Recovery write escaped generation");
      if (await this.rawRead(path)) return false;
      await this.heartbeat(); await this.assertOwned();
      if (await this.rawRead(path)) return false;
      await this.rawPut(path, body);
      return true;
    },
    put: async (path: string, body: Buffer) => {
      if (path !== BOOTSTRAP_POINTER_PATH) throw new Error("Only bootstrap/latest.json may be committed");
      await this.assertSourceUnchanged(); await this.assertOwned();
      // The helper prefers an existing bootstrap pointer over recoveryGeneration.
      // Preserve the explicitly approved frozen recovery edge even when an
      // older bootstrap pointer exists.
      const pointer = this.rollingBack ? JSON.parse(body.toString())
        : { ...JSON.parse(body.toString()), previous_generation: this.options.recoveryGeneration };
      this.pointerWriteAttempted = true;
      await this.rawPut(path, encode(pointer));
    },
  };

  async assertSourceUnchanged(): Promise<void> {
    if (!this.source) throw new Error("Recovery source has not been sealed in this lease");
    if (!equal(this.source.bootstrap, await this.rawRead(BOOTSTRAP_POINTER_PATH)) || !equal(this.source.managed, await this.rawRead("views/latest.json"))) {
      throw new Error("Published source pointers changed during repair");
    }
  }

  async baseInventory(): Promise<SourceEntry[]> {
    if (!this.options.recoveryBaseKeysFile) throw new Error("Recovery base requires an explicit complete key inventory file");
    const input: unknown = JSON.parse(await readFile(this.options.recoveryBaseKeysFile, "utf8"));
    if (!Array.isArray(input) || !input.length) throw new Error("Recovery base key inventory must be a nonempty JSON array");
    const seen = new Set<string>();
    const entries = input.map((value): SourceEntry => {
      const item = typeof value === "string" ? { key: value } : value;
      if (typeof item?.key !== "string" || !item.key.startsWith(RECOVERY_BASE_PREFIX) ||
          !/^[A-Za-z0-9_./-]+\.json$/.test(item.key) || item.key.includes("..") || seen.has(item.key) ||
          (typeof value !== "string" && (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)))) {
        throw new Error("Invalid or duplicate recovery base inventory key");
      }
      seen.add(item.key); return item;
    });
    for (const path of REQUIRED_BASE_PATHS) {
      if (!seen.has(`${RECOVERY_BASE_PREFIX}${path}`)) throw new Error(`Incomplete recovery base inventory: ${path}`);
    }
    return entries;
  }

  async seal(): Promise<Awaited<ReturnType<typeof verifyBootstrapGeneration>>> {
    await this.assertOwned();
    const bootstrap = await this.controlRead(BOOTSTRAP_POINTER_PATH), managed = await this.controlRead("views/latest.json");
    const boot = bootstrap ? BootstrapPublicationPointer.parse(JSON.parse(bootstrap.toString())) : null;
    if (boot?.generation === this.options.recoveryGeneration) throw new Error("Source generation is already the recovery");
    // These exact Tech-approved sources do not depend on either pointer.
    this.source = { bootstrap, managed };
    const base = await this.baseInventory();
    for (const phase of ["base", "canonical"] as const) {
      const entries: SourceEntry[] = phase === "base" ? base : RECOVERY_CANONICAL_KEYS.map((key) => ({ key }));
      const items = [];
      for (const entry of entries) {
        const body = await this.store.read(entry.key);
        if (!body) throw new Error(`Required recovery source is missing or incomplete: ${entry.key}`);
        if ((entry.bytes !== undefined && body.length !== entry.bytes) || (entry.sha256 && sha256Bytes(body) !== entry.sha256)) {
          throw new Error(`Recovery source differs from inventory manifest: ${entry.key}`);
        }
        items.push({ path: phase === "base" ? `views/${entry.key.slice(RECOVERY_BASE_PREFIX.length)}` : entry.key, body });
      }
      await stageBootstrapPhase({ generation: this.options.recoveryGeneration, phase,
        items, store: this.store, concurrency: this.concurrency });
      // Check source again against the actual create-only copies, not just
      // against the manifest generated from the first source read.
      for (let i = 0; i < entries.length; i++) {
        const source = await this.store.read(entries[i].key);
        const copy = await this.store.read(`${bootstrapGenerationPrefix(this.options.recoveryGeneration)}/${items[i].path}`);
        if (!source || !copy || source.length !== copy.length || sha256Bytes(source) !== sha256Bytes(copy)) {
          throw new Error(`Recovery copy differs from source: ${entries[i].key}`);
        }
      }
    }
    await this.assertSourceUnchanged(); await this.assertOwned();
    return verifyBootstrapGeneration({ generation: this.options.recoveryGeneration, store: this.store, concurrency: 1 });
  }
}

export async function sealRecoveryGeneration(publication: RepairPublication) {
  return publication.seal();
}

/** Manifests supply every target key; the repair builder's fixed layout must
 * also be complete, even if someone reseals an incomplete canonical manifest. */
async function verifyRepairTarget(publication: RepairPublication) {
  const verified = await verifyBootstrapGeneration({ generation: publication.options.generation, store: publication.store, concurrency: 1 });
  const basePaths = new Set<string>(verified.base.manifest.objects.map((item: { path: string }) => item.path));
  for (const path of REQUIRED_BASE_PATHS) {
    if (!basePaths.has(`views/${path}`)) throw new Error(`Incomplete repair base manifest: ${path}`);
  }
  const canonicalPaths = new Set<string>(verified.canonical.manifest.objects.map((item: { path: string }) => item.path));
  const required = ["canonical/v2/meta.json", ...["repos", "repo-monthly", "repo-weekly", "repo-recent-daily"].flatMap((family) =>
    Array.from({ length: 32 }, (_, shard) => `canonical/v2/${family}/${shard}.json`))];
  const years = [...basePaths].flatMap((path) => /^views\/heatmap\/month\/(\d{4})-\d{2}\.json$/.exec(path)?.[1] ?? []);
  if (!years.length) throw new Error("Incomplete repair base manifest: no month heatmaps for site-daily");
  required.push(...new Set(years.map((year) => `canonical/v2/site-daily/${year}.json`)));
  for (const path of required) {
    if (!canonicalPaths.has(path)) throw new Error(`Incomplete repair canonical manifest: ${path}`);
  }
  for (const path of canonicalPaths) {
    if (!required.includes(path)) throw new Error(`Unexpected repair canonical path: ${path}`);
  }
  return verified;
}

export async function commitPointer(publication: RepairPublication) {
  const { generation, recoveryGeneration } = publication.options;
  await publication.assertOwned(); await publication.assertSourceUnchanged();
  // The shared helper only checks recovery when no bootstrap pointer exists.
  // Always verify it here, including updates to an existing bootstrap pointer.
  await verifyBootstrapGeneration({ generation: recoveryGeneration, store: publication.store, concurrency: 1 });
  const verified = await verifyRepairTarget(publication);
  const result = await commitBootstrapGeneration({ generation, recoveryGeneration, store: publication.store,
    verifyGeneration: (target) => target === generation ? Promise.resolve(verified)
      : verifyBootstrapGeneration({ generation: target, store: publication.store, concurrency: 1 }),
    assertCanCommit: () => publication.assertOwned(), now: () => new Date((publication.options.now ?? Date.now)()).toISOString() });
  const body = await publication.store.read(BOOTSTRAP_POINTER_PATH);
  const pointer = BootstrapPublicationPointer.parse(body ? JSON.parse(body.toString()) : null);
  if (pointer.generation !== generation || pointer.previous_generation !== recoveryGeneration ||
      pointer.base_manifest_sha256 !== result.verified.base.sha256 || pointer.canonical_manifest_sha256 !== result.verified.canonical.sha256) {
    throw new Error("Committed pointer does not match publication and recovery");
  }
  return { ...result, pointer };
}

export async function publishRepairGeneration(options: RepairCommitOptions) {
  const publication = new RepairPublication(options);
  let phase: "acquire" | "seal" | "stage" | "commit" = "acquire";
  let result: Awaited<ReturnType<typeof commitPointer>>;
  try {
    await publication.acquire();
    phase = "seal";
    await sealRecoveryGeneration(publication);
    phase = "stage";
    await options.stage?.(publication);
    phase = "commit";
    result = await commitPointer(publication);
  } catch (error) {
    try { await publication.releaseIfOwned("failed"); }
    catch (releaseError) { throw new RepairPublicationError(phase, publication.pointerWriteAttempted, error, releaseError); }
    throw new RepairPublicationError(phase, publication.pointerWriteAttempted, error);
  }
  try { await publication.release("published"); }
  catch (error) { throw new RepairPublicationError("release", true, error); }
  return result;
}

/** Guarded CLI owns target authorization; rollback keeps the same lease errors. */
export async function rollbackRepairGeneration(options: RepairCommitOptions) {
  const publication = new RepairPublication(options);
  let phase: "acquire" | "commit" = "acquire";
  let result: Awaited<ReturnType<RepairPublication["rollback"]>>;
  try {
    await publication.acquire();
    phase = "commit";
    result = await publication.rollback();
  } catch (error) {
    try { await publication.releaseIfOwned("failed"); }
    catch (releaseError) { throw new RepairPublicationError(phase, publication.pointerWriteAttempted, error, releaseError); }
    throw new RepairPublicationError(phase, publication.pointerWriteAttempted, error);
  }
  try { await publication.release("published"); }
  catch (error) { throw new RepairPublicationError("release", true, error); }
  return result;
}
