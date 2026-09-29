import { ObjectStorePreconditionFailedError } from "./errors";
import { sha256Hex } from "./s3-sign";
import type {
  ObjectGetBytesResult,
  ObjectGetResult,
  ObjectHeadResult,
  ObjectListOptions,
  ObjectListResult,
  ObjectPutOptions,
  ObjectPutResult,
  ObjectStore,
} from "./types";

type MemoryObject = {
  bytes: Uint8Array;
  body: string;
  etag: string;
  contentType: string;
  size: number;
};

function bytesOf(body: string | Uint8Array): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy;
}

function etagFor(bytes: Uint8Array): string {
  return `"${sha256Hex(bytes).slice(0, 16)}"`;
}

function remember(body: string | Uint8Array, contentType: string): MemoryObject {
  const bytes = bytesOf(body);
  return {
    bytes,
    body: typeof body === "string" ? body : new TextDecoder().decode(bytes),
    etag: etagFor(bytes),
    contentType,
    size: bytes.byteLength,
  };
}

export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, MemoryObject>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, body] of Object.entries(initial)) {
      this.objects.set(path, remember(body, "application/json"));
    }
  }

  async put(path: string, body: string | Uint8Array, options: ObjectPutOptions = {}): Promise<ObjectPutResult> {
    const existing = this.objects.get(path);
    if (options.ifMatch) {
      if (!existing || existing.etag !== options.ifMatch) {
        throw new ObjectStorePreconditionFailedError(`If-Match failed for ${path}`);
      }
    } else if (options.allowOverwrite === false && existing) {
      throw new ObjectStorePreconditionFailedError(`object already exists: ${path}`);
    }
    const stored = remember(body, options.contentType ?? "application/json");
    this.objects.set(path, stored);
    return { etag: stored.etag, url: path };
  }

  async get(path: string): Promise<ObjectGetResult | null> {
    const existing = this.objects.get(path);
    if (!existing) return null;
    return {
      body: existing.body,
      etag: existing.etag,
      contentType: existing.contentType,
      size: existing.size,
    };
  }

  async getBytes(path: string): Promise<ObjectGetBytesResult | null> {
    const existing = this.objects.get(path);
    if (!existing) return null;
    const body = new Uint8Array(existing.bytes.byteLength);
    body.set(existing.bytes);
    return {
      body,
      etag: existing.etag,
      contentType: existing.contentType,
      size: existing.size,
    };
  }

  async head(path: string): Promise<ObjectHeadResult | null> {
    const existing = this.objects.get(path);
    if (!existing) return null;
    return { etag: existing.etag, contentType: existing.contentType, size: existing.size, url: path };
  }

  async list(options: ObjectListOptions): Promise<ObjectListResult> {
    const prefix = options.prefix ?? "";
    const limit = options.limit ?? 1000;
    const mode = options.mode ?? "expanded";
    const matching = [...this.objects.entries()]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const start = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const folders = new Set<string>();
    const blobs: ObjectListResult["blobs"] = [];
    let index = start;
    for (; index < matching.length && blobs.length < limit; index++) {
      const [pathname, object] = matching[index];
      if (mode === "folded") {
        const remainder = pathname.slice(prefix.length);
        const slash = remainder.indexOf("/");
        if (slash >= 0) {
          folders.add(`${prefix}${remainder.slice(0, slash + 1)}`);
          continue;
        }
      }
      blobs.push({ pathname, url: pathname, size: object.size, etag: object.etag });
    }
    const hasMore = index < matching.length;
    return {
      blobs,
      folders: [...folders].sort(),
      cursor: hasMore ? String(index) : undefined,
      hasMore,
    };
  }

  async del(pathsOrUrls: string | string[]): Promise<void> {
    for (const path of Array.isArray(pathsOrUrls) ? pathsOrUrls : [pathsOrUrls]) {
      this.objects.delete(path);
    }
  }
}
