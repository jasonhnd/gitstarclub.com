import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildBootstrapPhaseManifest } from "../../../pipeline/lib/bootstrap-publication.mjs";
import type { ObjectStore, ObjectListResult } from "../../lib/storage/types";
import { AGGREGATE_IMPORT_PATH, AGGREGATE_MANIFEST_SHA256 } from "../../lib/aggregate-history/policy";
import {
  IMPORT_CHUNK_BYTES, IMPORT_CHUNK_OBJECTS, assertPublicJson, importDigest,
  type ImportObject, type ImportPhase, type ImportSession,
} from "../../lib/aggregate-history/protocol";
import type { AggregateImportPublisher, AggregateImportResult } from "./aggregate-history-import";

const ALLOWED_ORIGINS = ["https://pre.gitstarclub.com", "https://gitstarclub-web-pre.worldgo.workers.dev"];
export function aggregateWorkerOrigin(value: string): string {
  const url = new URL(value);
  if (!ALLOWED_ORIGINS.includes(url.origin) || url.href !== `${url.origin}/`) throw new Error("Only an exact preview Worker origin is supported");
  return url.origin;
}

type Options = { origin: string; generation: string; secret: string; checkpoint?: string; fetchImpl?: typeof fetch };
type Checkpoint = { generation: string; sourceSha256: string; origin: string; token?: number; status: string };

/** A read-only origin transport plus a narrow Worker-owned publication protocol. */
export class AggregateHistoryWorkerClient implements AggregateImportPublisher {
  readonly store: ObjectStore;
  private session?: ImportSession;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: Options) {
    this.origin = aggregateWorkerOrigin(options.origin);
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!options.secret) throw new Error("CRON_SECRET is required for the preview Worker transport");
    const read = async (path: string) => {
      const value = await this.call<{ data: string; etag: string | null; sha256: string } | null>({ action: "read", path });
      if (!value) return null;
      const body = Buffer.from(value.data, "base64");
      if (importDigest(body) !== value.sha256) throw new Error("Worker read checksum mismatch");
      return { body, etag: value.etag, size: body.length };
    };
    this.store = {
      getBytes: read,
      get: async (path) => { const value = await read(path); return value ? { ...value, body: value.body.toString() } : null; },
      head: async (path) => { const value = await read(path); return value ? { etag: value.etag, size: value.size } : null; },
      list: (args) => this.call<ObjectListResult>({ action: "list", prefix: args.prefix, ...(args.cursor ? { cursor: args.cursor } : {}) }),
      put: async () => { throw new Error("Worker storage transport refuses direct writes; use fenced publication"); },
      del: async () => { throw new Error("Worker storage transport refuses deletes"); },
    };
  }

  async call<T>(input: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify({ generation: this.options.generation, sourceSha256: AGGREGATE_MANIFEST_SHA256, ...input });
    // Retry response loss with identical bytes. Mutations are create-only/CAS,
    // per-token checkpointed, or the idempotent normal publication helper.
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.origin}${AGGREGATE_IMPORT_PATH}`, {
          method: "POST", redirect: "error", headers: { authorization: `Bearer ${this.options.secret}`, "content-type": "application/json", "x-gsc-sha256": importDigest(body) }, body,
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        if (attempt === 2) throw new Error(`Preview Worker ${input.action} response unavailable; resume the same checkpoint`);
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      if (response.status >= 500 && attempt < 2) { await response.body?.cancel(); continue; }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Preview Worker ${input.action} refused (HTTP ${response.status}); inspect lease, source pointers and checkpoint before retrying`);
      }
      return await response.json() as T;
    }
  }

  private checkpoint(status: string): void {
    const path = this.options.checkpoint;
    if (!path) throw new Error("An explicit local checkpoint path is required for execution");
    mkdirSync(dirname(path), { recursive: true });
    const record: Checkpoint = { generation: this.options.generation, sourceSha256: AGGREGATE_MANIFEST_SHA256, origin: this.origin, ...(this.session ? { token: this.session.token } : {}), status };
    writeFileSync(`${path}.new`, JSON.stringify(record), { mode: 0o600 });
    renameSync(`${path}.new`, path);
  }

  async withLease(run: (renew: () => Promise<void>) => Promise<AggregateImportResult>): Promise<AggregateImportResult> {
    if (!this.options.checkpoint) throw new Error("--checkpoint is required for Worker execution");
    let prior: Checkpoint | undefined;
    try { prior = JSON.parse(readFileSync(this.options.checkpoint, "utf8")) as Checkpoint; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Local import checkpoint is invalid"); }
    if (prior && (prior.generation !== this.options.generation || prior.origin !== this.origin || prior.sourceSha256 !== AGGREGATE_MANIFEST_SHA256)) throw new Error("Local checkpoint belongs to a different import");
    this.checkpoint("beginning");
    this.session = await this.call<ImportSession>({ action: "begin" });
    this.checkpoint("running");
    let status: "published" | "failed" = "failed";
    try {
      const result = await run(() => this.owned({ action: "renew" }).then(() => {}));
      status = "published";
      return result;
    } finally {
      await this.owned({ action: "release", status });
      this.checkpoint(status);
    }
  }

  private owned<T>(input: Record<string, unknown>): Promise<T> {
    if (!this.session) throw new Error("Worker publication requires an acquired session");
    return this.call<T>({ token: this.session.token, ...input });
  }

  async stage(generation: string, phase: ImportPhase, items: ImportObject[]): Promise<void> {
    let chunk: Array<{ path: string; data: string; sha256: string }> = [];
    let bytes = 0;
    const flush = async () => {
      if (chunk.length) await this.owned({ action: "stage", target: generation, phase, items: chunk });
      chunk = []; bytes = 0;
    };
    for (const item of items) {
      assertPublicJson(item.body);
      if (item.body.length > IMPORT_CHUNK_BYTES) throw new Error("Snapshot object exceeds the import chunk limit");
      if (chunk.length >= IMPORT_CHUNK_OBJECTS || bytes + item.body.length > IMPORT_CHUNK_BYTES) await flush();
      chunk.push({ path: item.path, data: item.body.toString("base64"), sha256: importDigest(item.body) });
      bytes += item.body.length;
    }
    await flush();
    const manifest = buildBootstrapPhaseManifest(generation, phase, items);
    await this.owned({ action: "seal", target: generation, phase, data: Buffer.from(JSON.stringify(manifest)).toString("base64") });
    for (let hop = 0; ; hop++) {
      if (hop > manifest.object_count) throw new Error("Worker verification did not finish");
      const proof = await this.owned<{ complete: boolean }>({ action: "verify", target: generation, phase });
      if (proof.complete) break;
    }
  }

  async commit(recoveryGeneration?: string): Promise<void> {
    await this.owned({ action: "commit", recovery: !!recoveryGeneration });
  }
}
