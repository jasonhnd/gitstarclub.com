import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ObjectStorePreconditionFailedError } from "./errors";
import type {
  ObjectGetResult,
  ObjectGetBytesResult,
  ObjectHeadResult,
  ObjectListItem,
  ObjectListOptions,
  ObjectListResult,
  ObjectPutOptions,
  ObjectPutResult,
  ObjectStore,
} from "./types";

/** Raised when `r2_binding` is selected and the Worker has no `DATA` binding. */
export const MISSING_DATA_BINDING_ERROR = "r2_binding requires the DATA R2 binding";

/** Workers `R2Bucket.delete` accepts at most 1000 keys per call. */
export const R2_DELETE_BATCH = 1000;

export type R2HttpMetadata = {
  contentType?: string;
  cacheControl?: string;
};

export type R2OnlyIf = {
  etagMatches?: string;
  etagDoesNotMatch?: string;
};

export type R2ObjectHead = {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  httpMetadata?: R2HttpMetadata;
};

export type R2ObjectBody = R2ObjectHead & {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type R2ListResult = {
  objects: R2ObjectHead[];
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
};

/**
 * Structural subset of the Workers `R2Bucket` binding.
 * `etag` is unquoted; `httpEtag` is quoted. This store returns `httpEtag`.
 * `ifMatch` may be that quoted value. `onlyIf.etagMatches` is the unquoted form
 * workerd accepts.
 */
export type R2Bucket = {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2ObjectHead | null>;
  put(
    key: string,
    value: string | Uint8Array,
    options?: { onlyIf?: R2OnlyIf; httpMetadata?: R2HttpMetadata },
  ): Promise<R2ObjectHead | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number; delimiter?: string }): Promise<R2ListResult>;
};

export type R2BindingStoreConfig = {
  bucket: R2Bucket;
  bucketName?: string;
  prefix?: string;
  publicBaseUrl?: string;
};

function isR2Bucket(value: unknown): value is R2Bucket {
  if (!value || typeof value !== "object") return false;
  const bucket = value as Partial<R2Bucket>;
  return (
    typeof bucket.get === "function" &&
    typeof bucket.head === "function" &&
    typeof bucket.put === "function" &&
    typeof bucket.delete === "function" &&
    typeof bucket.list === "function"
  );
}

let dataBindingReaderForTests: (() => unknown) | undefined;

/** Test-only DATA binding. `undefined` restores the live Worker binding. */
export function setDataBindingReaderForTests(reader: (() => unknown) | undefined): void {
  dataBindingReaderForTests = reader;
}

function readCloudflareDataBinding(): unknown {
  if (dataBindingReaderForTests !== undefined) return dataBindingReaderForTests();
  const { env } = getCloudflareContext();
  return (env as { DATA?: unknown }).DATA;
}

/** Live Worker `DATA` binding. Throws a clear error when the binding is absent. */
export function resolveDataBinding(readBinding: () => unknown = readCloudflareDataBinding): R2Bucket {
  let data: unknown;
  try {
    data = readBinding();
  } catch {
    throw new Error(MISSING_DATA_BINDING_ERROR);
  }
  if (!isR2Bucket(data)) throw new Error(MISSING_DATA_BINDING_ERROR);
  return data;
}

/** Quoted etag from `get` / `head` / `put`. Pass it back as `ifMatch`. */
function httpEtagOf(object: { etag: string; httpEtag?: string }): string {
  const quoted = object.httpEtag?.trim();
  if (quoted) return quoted;
  const raw = object.etag.trim();
  if (!raw) return '""';
  return raw.startsWith('"') ? raw : `"${raw}"`;
}

/**
 * workerd `UnwrappedConditional(const Conditional&)` rejects a value that
 * starts and ends with `"`. `*` is a wildcard. Every other string, including
 * `W/...`, is a strong tag with that literal value. Weak tags are parsed only
 * from `If-Match` / `If-None-Match` headers, which this store does not send.
 */
function structuredConditionalTag(value: string): { wildcard: true } | { wildcard: false; value: string } {
  if (value.startsWith('"') && value.endsWith('"')) {
    throw new TypeError(`Conditional ETag should not be wrapped in quotes (${value}).`);
  }
  if (value === "*") return { wildcard: true };
  return { wildcard: false, value };
}

/** `ifMatch` is a quoted `httpEtag`. Structured `etagMatches` must be unquoted. */
export function etagForBindingCondition(ifMatch: string): string {
  const value = ifMatch.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

/**
 * Structured `onlyIf` check used by test buckets so they fail the same way as
 * workerd. Both supplied etags are parsed before any match result, matching
 * `UnwrappedConditional(const Conditional&)`: a quoted value throws `TypeError`
 * even when the other condition would already fail. `existingEtag` is omitted
 * when the key is absent.
 */
export function bindingPreconditionPasses(existingEtag: string | undefined, onlyIf: R2OnlyIf | undefined): boolean {
  if (!onlyIf) return true;
  const matchTag = onlyIf.etagMatches !== undefined ? structuredConditionalTag(onlyIf.etagMatches) : undefined;
  const noneTag = onlyIf.etagDoesNotMatch !== undefined ? structuredConditionalTag(onlyIf.etagDoesNotMatch) : undefined;
  if (matchTag !== undefined) {
    const matches = matchTag.wildcard ? existingEtag !== undefined : existingEtag === matchTag.value;
    if (!matches) return false;
  }
  if (noneTag !== undefined) {
    const differs = noneTag.wildcard ? existingEtag === undefined : existingEtag !== noneTag.value;
    if (!differs) return false;
  }
  return true;
}

function onlyIfFor(options: ObjectPutOptions): R2OnlyIf | undefined {
  if (options.ifMatch) return { etagMatches: etagForBindingCondition(options.ifMatch) };
  if (options.allowOverwrite === false) return { etagDoesNotMatch: "*" };
  return undefined;
}

export class R2BindingObjectStore implements ObjectStore {
  private readonly bucket: R2Bucket;
  private readonly bucketName: string;
  private readonly prefix: string;
  private readonly publicBaseUrl?: string;

  constructor(config: R2BindingStoreConfig) {
    this.bucket = config.bucket;
    this.bucketName = config.bucketName ?? "";
    this.prefix = config.prefix ?? "";
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/+$/, "");
  }

  physicalKey(path: string): string {
    return `${this.prefix}${path.replace(/^\/+/, "")}`;
  }

  logicalPath(key: string): string {
    return this.prefix && key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key;
  }

  objectUrl(path: string): string {
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${path}`;
    const name = this.bucketName || "DATA";
    return `r2://${name}/${this.physicalKey(path)}`;
  }

  async put(path: string, body: string | Uint8Array, options: ObjectPutOptions = {}): Promise<ObjectPutResult> {
    const onlyIf = onlyIfFor(options);
    const httpMetadata: R2HttpMetadata = {
      contentType: options.contentType ?? "application/json",
    };
    if (options.cacheControlMaxAge !== undefined) {
      httpMetadata.cacheControl = `public, max-age=${options.cacheControlMaxAge}`;
    }
    const stored = await this.bucket.put(this.physicalKey(path), body, { onlyIf, httpMetadata });
    if (!stored) {
      if (onlyIf) {
        throw new ObjectStorePreconditionFailedError(`R2 binding put precondition failed for ${path}`);
      }
      throw new Error(`R2 binding put ${path} returned no object`);
    }
    return { etag: httpEtagOf(stored), url: this.objectUrl(path) };
  }

  async get(path: string): Promise<ObjectGetResult | null> {
    const object = await this.bucket.get(this.physicalKey(path));
    if (!object) return null;
    return {
      body: await object.text(),
      etag: httpEtagOf(object),
      contentType: object.httpMetadata?.contentType,
      size: object.size,
    };
  }

  /** Bootstrap hashes staged parquet; decoding it as text changes its bytes. */
  async getBytes(path: string): Promise<ObjectGetBytesResult | null> {
    const object = await this.bucket.get(this.physicalKey(path));
    if (!object) return null;
    return {
      body: new Uint8Array(await object.arrayBuffer()),
      etag: httpEtagOf(object),
      contentType: object.httpMetadata?.contentType,
      size: object.size,
    };
  }

  async head(path: string): Promise<ObjectHeadResult | null> {
    const object = await this.bucket.head(this.physicalKey(path));
    if (!object) return null;
    return {
      etag: httpEtagOf(object),
      contentType: object.httpMetadata?.contentType,
      size: object.size,
      url: this.objectUrl(path),
    };
  }

  async list(options: ObjectListOptions): Promise<ObjectListResult> {
    const listed = await this.bucket.list({
      prefix: this.physicalKey(options.prefix),
      cursor: options.cursor,
      limit: options.limit,
      delimiter: options.mode === "folded" ? "/" : undefined,
    });
    const blobs: ObjectListItem[] = listed.objects.map((object) => {
      const pathname = this.logicalPath(object.key);
      return {
        pathname,
        url: this.objectUrl(pathname),
        size: object.size,
        etag: httpEtagOf(object),
      };
    });
    const folders = listed.delimitedPrefixes.map((prefix) => this.logicalPath(prefix)).filter(Boolean);
    return { blobs, folders, cursor: listed.cursor, hasMore: listed.truncated };
  }

  async del(pathsOrUrls: string | string[]): Promise<void> {
    const values = Array.isArray(pathsOrUrls) ? pathsOrUrls : [pathsOrUrls];
    const keys = values.map((value) => this.resolveKey(value));
    for (let offset = 0; offset < keys.length; offset += R2_DELETE_BATCH) {
      await this.bucket.delete(keys.slice(offset, offset + R2_DELETE_BATCH));
    }
  }

  /** Key `del` will delete: logical path, `r2://` object key, or public URL. */
  resolveKey(value: string): string {
    if (value.startsWith("r2://")) {
      const rest = value.slice("r2://".length);
      const slash = rest.indexOf("/");
      return slash >= 0 ? rest.slice(slash + 1) : rest;
    }
    if (this.publicBaseUrl && value.startsWith(`${this.publicBaseUrl}/`)) {
      return this.physicalKey(value.slice(this.publicBaseUrl.length + 1));
    }
    return this.physicalKey(value.replace(/^\/+/, ""));
  }
}
