import { ObjectStorePreconditionFailedError } from "./errors";
import { sha256Hex } from "./s3-sign";
import type {
  ObjectGetResult,
  ObjectHeadResult,
  ObjectListOptions,
  ObjectListResult,
  ObjectPutOptions,
  ObjectPutResult,
  ObjectStore,
} from "./types";

type MemoryObject = {
  body: string;
  etag: string;
  contentType: string;
  size: number;
};

function etagFor(body: string): string {
  return `"${sha256Hex(body).slice(0, 16)}"`;
}

function toText(body: string | Uint8Array): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, MemoryObject>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, body] of Object.entries(initial)) {
      this.objects.set(path, { body, etag: etagFor(body), contentType: "application/json", size: body.length });
    }
  }

  async put(path: string, body: string | Uint8Array, options: ObjectPutOptions = {}): Promise<ObjectPutResult> {
    const text = toText(body);
    const existing = this.objects.get(path);
    if (options.ifMatch) {
      if (!existing || existing.etag !== options.ifMatch) {
        throw new ObjectStorePreconditionFailedError(`If-Match failed for ${path}`);
      }
    } else if (options.allowOverwrite === false && existing) {
      throw new ObjectStorePreconditionFailedError(`object already exists: ${path}`);
    }
    const stored: MemoryObject = {
      body: text,
      etag: etagFor(text),
      contentType: options.contentType ?? "application/json",
      size: new TextEncoder().encode(text).byteLength,
    };
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
