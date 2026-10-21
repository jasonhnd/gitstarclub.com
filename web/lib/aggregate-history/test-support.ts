import { AsyncLocalStorage } from "node:async_hooks";
import { MemoryObjectStore } from "../storage/memory-store";
import { bindingPreconditionPasses, type R2Bucket, type R2OnlyIf, type R2HttpMetadata } from "../storage/r2-binding-store";
import { WorkflowSubrequestCounter } from "../workflows/test-support";
import { AGGREGATE_IMPORT_PATH, AGGREGATE_MANIFEST_SHA256, PREVIEW_BUCKET } from "./policy";
import { importDigest } from "./protocol";
import { handleAggregateImport } from "./worker";
const GEN = "bootstrap-aggregate-worker-test";
const SECRET = "aggregate-test-secret";
const encode = (value: unknown) => JSON.stringify(value);

export class ImportTestBucket implements R2Bucket {
  readonly store: MemoryObjectStore;
  readonly counters = new AsyncLocalStorage<WorkflowSubrequestCounter>();
  readonly fallbackCounter = new WorkflowSubrequestCounter();
  get counter() { return this.counters.getStore() ?? this.fallbackCounter; }
  readonly writes: Array<{ path: string; onlyIf?: R2OnlyIf }> = [];
  beforePut?: (path: string) => Promise<void>;
  failPut?: (path: string) => boolean;
  constructor(initial: Record<string, string> = {}) {
    this.store = new MemoryObjectStore({ "_meta/bucket-identity.json": encode({ bucket: PREVIEW_BUCKET, deploy_env: "pre" }), ...initial });
  }
  async get(path: string) {
    this.counter.use("get");
    const object = await this.store.getBytes(path);
    if (!object) return null;
    return { key: path, size: object.body.byteLength, etag: object.etag!.replaceAll('"', ''), httpEtag: object.etag!,
      text: async () => Buffer.from(object.body).toString(), arrayBuffer: async () => Uint8Array.from(object.body).buffer };
  }
  async head(path: string) {
    this.counter.use("head");
    const object = await this.store.head(path);
    return object ? { key: path, size: object.size!, etag: object.etag!.replaceAll('"', ''), httpEtag: object.etag! } : null;
  }
  async put(path: string, body: string | Uint8Array, options?: { onlyIf?: R2OnlyIf; httpMetadata?: R2HttpMetadata }) {
    this.counter.use("put");
    await this.beforePut?.(path);
    if (this.failPut?.(path)) throw new Error("injected write failure");
    const prior = await this.store.head(path);
    this.writes.push({ path, onlyIf: options?.onlyIf });
    if (!bindingPreconditionPasses(prior?.etag?.replaceAll('"', ''), options?.onlyIf)) return null;
    const object = await this.store.put(path, body);
    return { key: path, size: Buffer.byteLength(body), etag: object.etag.replaceAll('"', ''), httpEtag: object.etag };
  }
  async delete(keys: string | string[]) { this.counter.use("delete"); await this.store.del(keys); }
  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    this.counter.use("list");
    const list = await this.store.list({ prefix: options?.prefix ?? "", cursor: options?.cursor, limit: options?.limit });
    return { objects: list.blobs.map((blob) => ({ key: blob.pathname, size: blob.size, etag: blob.etag!.replaceAll('"', ''), httpEtag: blob.etag! })), delimitedPrefixes: [], truncated: list.hasMore, cursor: list.cursor };
  }
}

export function importWorkerHarness(initial: Record<string, string> = {}) {
  const bucket = new ImportTestBucket(initial);
  const env = { DEPLOY_ENV: "pre", R2_BUCKET: PREVIEW_BUCKET, DATA: bucket, CRON_SECRET: SECRET };
  let maximum = 0;
  const calls: Record<string, number> = {};
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const wire = String(init?.body);
    const action = String(JSON.parse(wire).action);
    const counter = new WorkflowSubrequestCounter(); counter.reset(128);
    const response = await bucket.counters.run(counter, () => handleAggregateImport(new Request(String(url), init), env));
    maximum = Math.max(maximum, counter.total);
    calls[action] = Math.max(calls[action] ?? 0, counter.total);
    bucket.fallbackCounter.reset();
    bucket.fallbackCounter.total = counter.total;
    return response;
  }) as typeof fetch;
  const request = async (body: Record<string, unknown>, overrides: Partial<typeof env> = {}) => {
    const wire = encode({ generation: GEN, sourceSha256: AGGREGATE_MANIFEST_SHA256, ...body });
    const counter = new WorkflowSubrequestCounter(); counter.reset(128);
    const response = await bucket.counters.run(counter, () => handleAggregateImport(new Request(`https://pre.gitstarclub.com${AGGREGATE_IMPORT_PATH}`, {
      method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-gsc-sha256": importDigest(wire) }, body: wire,
    }), { ...env, ...overrides }));
    maximum = Math.max(maximum, counter.total);
    calls[String(body.action)] = Math.max(calls[String(body.action)] ?? 0, counter.total);
    bucket.fallbackCounter.reset();
    bucket.fallbackCounter.total = counter.total;
    return response;
  };
  return { bucket, env, request, fetchImpl, maximum: () => maximum, calls };
}

