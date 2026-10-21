import {
  acquireBootstrapLease, parseBootstrapLease, releaseBootstrapLease, renewBootstrapLease,
} from "../../../pipeline/lib/bootstrap-lease.mjs";
import {
  bootstrapPhaseManifestPath, commitBootstrapGeneration, parseBootstrapPhaseManifest,
  sealBootstrapPhase, stageBootstrapObjects, verifyBootstrapPhaseBatch,
} from "../../../pipeline/lib/bootstrap-publication.mjs";
import type { BootstrapLease } from "../../../pipeline/lib/bootstrap-store-types.mjs";
import { hasValidBearerToken, unauthorizedResponse } from "../security";
import { createObjectStoreBootstrapAdapter } from "../storage/bootstrap-adapter";
import { R2BindingObjectStore, type R2Bucket } from "../storage/r2-binding-store";
import type { ObjectStore } from "../storage/types";
import { aggregateImportEnabled, PREVIEW_BUCKET } from "./policy";
import {
  AggregateImportRequest, IMPORT_CHUNK_BYTES, IMPORT_REQUEST_BYTES, IMPORT_VERIFY_OBJECTS,
  assertImportTarget, assertPublicJson, importDigest, readableImportPath, recoveryGeneration,
  type ImportPhase,
} from "./protocol";

const ACTIVE = "ops/workflows/active.json";
const POINTERS = ["bootstrap/latest.json", "views/latest.json"] as const;
type Fingerprint = { sha256: string; etag: string | null };
type Session = { generation: string; lease: BootstrapLease; before: Fingerprint[] };
type Progress = { sha256: string; cursor: number; complete: boolean };
type ImportEnv = { DEPLOY_ENV?: string; R2_BUCKET?: string; DATA?: R2Bucket; CRON_SECRET?: string };
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const sessionPath = (generation: string, token: number) => `ops/aggregate-import/${generation}/${token}/session.json`;
const progressPath = (generation: string, token: number, target: string, phase: string) => `ops/aggregate-import/${generation}/${token}/${target}/${phase}/verified.json`;

async function fingerprints(store: ObjectStore): Promise<Fingerprint[]> {
  return Promise.all(POINTERS.map(async (path) => {
    const value = await store.getBytes!(path);
    return { sha256: importDigest(value?.body ?? ""), etag: value?.etag ?? null };
  }));
}

async function unchanged(store: ObjectStore, session: Session): Promise<void> {
  if (JSON.stringify(await fingerprints(store)) !== JSON.stringify(session.before)) {
    throw new Error("Preview publication changed; use a new generation after reviewing current state");
  }
}

async function readRequest(request: Request): Promise<AggregateImportRequest> {
  if (!request.body) throw new Error("A checksummed JSON body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMPORT_REQUEST_BYTES) throw new Error("Import request exceeds byte limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (request.headers.get("x-gsc-sha256") !== importDigest(bytes)) throw new Error("Import request checksum mismatch");
  return AggregateImportRequest.parse(JSON.parse(bytes.toString("utf8")));
}

/** Every call has its own DATA budget. No invocation loops over an entire generation. */
export async function runAggregateImportRequest(input: AggregateImportRequest, store: ObjectStore): Promise<unknown> {
  const adapter = createObjectStoreBootstrapAdapter(store);
  const { generation } = input;
  if (input.action === "read") {
    if (!readableImportPath(input.path)) throw new Error("Read path is outside import scope");
    const value = await store.getBytes!(input.path);
    return value ? { data: Buffer.from(value.body).toString("base64"), etag: value.etag, sha256: importDigest(value.body) } : null;
  }
  if (input.action === "list") {
    if (!readableImportPath(input.prefix) || !input.prefix.endsWith("/")) throw new Error("List prefix is outside import scope");
    return store.list({ prefix: input.prefix, cursor: input.cursor, limit: 256 });
  }
  if (input.action === "begin") {
    const current = parseBootstrapLease((await adapter.readSnapshot(ACTIVE)).body);
    // Lost begin responses may resume only this same unexpired fencing token.
    const lease = current?.status === "running" && current.run_id === `bootstrap-publish-${generation}` && Date.parse(current.expires_at) > Date.now()
      ? await renewBootstrapLease({ store: adapter, lease: current })
      : await acquireBootstrapLease({ store: adapter, generation, operation: "publish" });
    const path = sessionPath(generation, lease.fencing_token);
    const existing = await adapter.read(path);
    if (existing) {
      const session = JSON.parse(existing.toString()) as Session;
      await unchanged(store, session);
    } else {
      const session: Session = { generation, lease, before: await fingerprints(store) };
      if (!await adapter.create(path, encode(session))) throw new Error("Import session create conflict; retry begin");
    }
    return { generation, token: lease.fencing_token };
  }
  const raw = await adapter.read(sessionPath(generation, input.token));
  if (!raw) throw new Error("Import session is missing");
  const session = JSON.parse(raw.toString()) as Session;
  if (session.generation !== generation || session.lease.fencing_token !== input.token) throw new Error("Import session token mismatch");
  if (input.action === "release") {
    const current = parseBootstrapLease((await adapter.readSnapshot(ACTIVE)).body);
    if (current?.run_id === session.lease.run_id && current.fencing_token === input.token && current.status === input.status) return { released: true };
    if (!await releaseBootstrapLease({ store: adapter, lease: session.lease, status: input.status })) throw new Error("Import lost its lease before release");
    return { released: true };
  }
  const renew = () => renewBootstrapLease({ store: adapter, lease: session.lease }).then(() => {});
  await renew();
  const fenced = { ...adapter,
    create: async (path: string, body: Buffer, contentType?: string) => { await renew(); return adapter.create(path, body, contentType); },
  };
  if (input.action === "renew") { await unchanged(store, session); return { renewed: true }; }
  if (input.action === "stage" || input.action === "seal" || input.action === "verify") {
    assertImportTarget(generation, input.target);
    if (input.action === "stage") {
      const items = input.items.map((item) => {
        const body = Buffer.from(item.data, "base64");
        if (importDigest(body) !== item.sha256) throw new Error("Import object checksum mismatch");
        if (!item.path.endsWith(".json")) throw new Error("Only JSON snapshot objects may be imported");
        assertPublicJson(body);
        return { path: item.path, body, contentType: "application/json" };
      });
      if (items.reduce((sum, item) => sum + item.body.length, 0) > IMPORT_CHUNK_BYTES) throw new Error("Import chunk exceeds byte limit");
      const checksum = importDigest(encode(input.items.map(({ path, sha256 }) => ({ path, sha256 }))));
      const checkpoint = `ops/aggregate-import/${generation}/${input.token}/${input.target}/${input.phase}/chunks/${checksum}.json`;
      const sealed = await adapter.read(bootstrapPhaseManifestPath(input.target, input.phase));
      if (sealed) {
        const manifest = parseBootstrapPhaseManifest(sealed, input.target, input.phase);
        for (const item of items) {
          if (!manifest.objects.some((object: { path: string; bytes: number; sha256: string }) => object.path === item.path && object.bytes === item.body.length && object.sha256 === importDigest(item.body))) {
            throw new Error("Cannot append objects to a sealed phase");
          }
        }
      }
      if (await adapter.read(checkpoint)) return { checksum, replay: true };
      await stageBootstrapObjects({ generation: input.target, phase: input.phase, items, store: fenced, concurrency: 1 });
      // Only completed immutable chunks receive a durable replay receipt.
      await fenced.create(checkpoint, encode({ checksum, objects: items.length }));
      return { checksum, replay: false };
    }
    if (input.action === "seal") {
      const body = Buffer.from(input.data, "base64");
      assertPublicJson(body);
      const sealed = await sealBootstrapPhase({ generation: input.target, phase: input.phase, body, store: fenced });
      return { sha256: sealed.sha256, objects: sealed.manifest.object_count };
    }
    const path = progressPath(generation, input.token, input.target, input.phase);
    const prior = await adapter.readSnapshot(path);
    const progress = prior.body ? JSON.parse(prior.body.toString()) as Progress : null;
    const batch = await verifyBootstrapPhaseBatch({ generation: input.target, phase: input.phase, store: adapter, cursor: progress?.cursor ?? 0, limit: IMPORT_VERIFY_OBJECTS });
    if (progress && progress.sha256 !== batch.sha256) throw new Error("Verification manifest changed");
    const next: Progress = { sha256: batch.sha256, cursor: batch.nextCursor, complete: batch.complete };
    await renew();
    const saved = prior.etag ? await adapter.compareAndSet(path, prior.etag, encode(next)) : await adapter.create(path, encode(next));
    if (!saved) throw new Error("Verification checkpoint changed concurrently; retry");
    return next;
  }
  // Generation objects and manifests are immutable. Completed per-token proofs
  // replace only the unbounded verification loop in the existing commit helper.
  const verifyGeneration = async (target: string | undefined) => {
    if (!target) throw new Error("Verification target is missing");
    assertImportTarget(generation, target);
    const phaseProof = async (phase: ImportPhase) => {
      const [manifestBytes, proofBytes] = await Promise.all([
        adapter.read(bootstrapPhaseManifestPath(target, phase)),
        adapter.read(progressPath(generation, input.token, target, phase)),
      ]);
      if (!manifestBytes || !proofBytes) throw new Error("Import verification is incomplete");
      const manifest = parseBootstrapPhaseManifest(manifestBytes, target, phase);
      const proof = JSON.parse(proofBytes.toString()) as Progress;
      const sha256 = importDigest(manifestBytes);
      if (!proof.complete || proof.cursor !== manifest.object_count || proof.sha256 !== sha256) throw new Error("Import verification proof does not match manifest");
      return { manifest, sha256 };
    };
    const [base, canonical] = await Promise.all([phaseProof("base"), phaseProof("canonical")]);
    return { base, canonical, objectCount: base.manifest.object_count + canonical.manifest.object_count, totalBytes: base.manifest.total_bytes + canonical.manifest.total_bytes };
  };
  // Permit an idempotent retry after the switch, while still checking proofs.
  const current = await adapter.readSnapshot(POINTERS[0]);
  const already = current.body && JSON.parse(current.body.toString()).generation === generation;
  if (!already) await unchanged(store, session);
  const conditional = { ...adapter, async put(path: string, body: Buffer, contentType?: string) {
    if (path !== POINTERS[0]) throw new Error("Only the normal bootstrap pointer may be committed");
    await renew();
    await unchanged(store, session);
    const before = session.before[0]!;
    const switched = before.etag
      ? await adapter.compareAndSet(path, before.etag, body, contentType)
      : await adapter.createMutable(path, body, contentType);
    if (!switched) throw new Error("Bootstrap publication compare-and-set conflict");
  } };
  if (input.recovery !== (session.before[0]!.etag === null)) throw new Error("Recovery mode does not match the source snapshot");
  const report = await adapter.read(`bootstrap/generations/${generation}/views/aggregate-history-import.json`);
  const source = report ? JSON.parse(report.toString()) : null;
  if (source?.source_manifest_sha256 !== input.sourceSha256 || source.generation !== generation) throw new Error("Import source report does not match the pinned input");
  const result = await commitBootstrapGeneration({ generation, store: conditional, verifyGeneration, assertCanCommit: renew, recoveryGeneration: input.recovery ? recoveryGeneration(generation) : undefined });
  return { status: result.status, pointer: result.pointer };
}

export async function handleAggregateImport(request: Request, env: ImportEnv): Promise<Response> {
  // Production refusal precedes auth, request parsing and even access to DATA.
  if (!aggregateImportEnabled(env)) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!env.CRON_SECRET || !hasValidBearerToken(request.headers.get("authorization"), env.CRON_SECRET)) return unauthorizedResponse();
  if (!env.DATA) return new Response("Preview DATA binding unavailable", { status: 404 });
  try {
    const store = new R2BindingObjectStore({ bucket: env.DATA, bucketName: PREVIEW_BUCKET });
    const identity = await store.get("_meta/bucket-identity.json");
    const marker = identity ? JSON.parse(identity.body) : null;
    if (marker?.bucket !== PREVIEW_BUCKET || marker.deploy_env !== "pre") return new Response("Not found", { status: 404 });
    const input = await readRequest(request);
    return Response.json(await runAggregateImportRequest(input, store), { headers: { "cache-control": "private, no-store" } });
  } catch {
    // Never echo request content, storage bodies, user paths or credentials.
    return Response.json({ error: "Preview import refused; check checksum, session lease, immutable bytes and publication state" }, { status: 409 });
  }
}
