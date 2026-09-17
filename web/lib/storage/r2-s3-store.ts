import { Buffer } from "node:buffer";
import { ObjectStorePreconditionFailedError } from "./errors";
import { encodeS3Path, signS3Request } from "./s3-sign";
import type {
  ObjectGetResult,
  ObjectHeadResult,
  ObjectListItem,
  ObjectListOptions,
  ObjectListResult,
  ObjectPutOptions,
  ObjectPutResult,
  ObjectStore,
} from "./types";

export type R2S3StoreConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region?: string;
  prefix?: string;
  publicBaseUrl?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
};

function xmlUnescape(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function xmlText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? xmlUnescape(match[1]) : undefined;
}

function xmlAll(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => xmlUnescape(match[1]));
}

function normalizeEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  const trimmed = etag.trim();
  return trimmed ? trimmed : null;
}

function toBytes(body: string | Uint8Array): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

export class R2S3ObjectStore implements ObjectStore {
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly region: string;
  private readonly prefix: string;
  private readonly publicBaseUrl?: string;
  private readonly fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly now: () => Date;

  constructor(config: R2S3StoreConfig) {
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.bucket = config.bucket;
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.region = config.region ?? "auto";
    this.prefix = config.prefix ?? "";
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  physicalKey(path: string): string {
    return `${this.prefix}${path.replace(/^\/+/, "")}`;
  }

  logicalPath(key: string): string {
    return this.prefix && key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key;
  }

  objectUrl(path: string): string {
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${path}`;
    return `r2://${this.bucket}/${this.physicalKey(path)}`;
  }

  async put(path: string, body: string | Uint8Array, options: ObjectPutOptions = {}): Promise<ObjectPutResult> {
    const bytes = toBytes(body);
    const headers: Record<string, string> = {
      "content-type": options.contentType ?? "application/json",
    };
    if (options.cacheControlMaxAge !== undefined) {
      headers["cache-control"] = `public, max-age=${options.cacheControlMaxAge}`;
    }
    if (options.ifMatch) headers["if-match"] = options.ifMatch;
    else if (options.allowOverwrite === false) headers["if-none-match"] = "*";
    const response = await this.request("PUT", this.physicalKey(path), { headers, body: bytes });
    if (response.status === 412 || response.status === 409) {
      throw new ObjectStorePreconditionFailedError(`R2 put precondition failed for ${path} (${response.status})`);
    }
    if (!response.ok) throw new Error(`R2 put ${path} -> ${response.status}`);
    return {
      etag: normalizeEtag(response.headers.get("etag")) ?? `"${response.headers.get("etag") ?? "unknown"}"`,
      url: this.objectUrl(path),
    };
  }

  async get(path: string): Promise<ObjectGetResult | null> {
    const response = await this.request("GET", this.physicalKey(path));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 get ${path} -> ${response.status}`);
    return {
      body: await response.text(),
      etag: normalizeEtag(response.headers.get("etag")),
      contentType: response.headers.get("content-type") ?? undefined,
      size: Number(response.headers.get("content-length") ?? undefined) || undefined,
    };
  }

  async head(path: string): Promise<ObjectHeadResult | null> {
    const response = await this.request("HEAD", this.physicalKey(path));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 head ${path} -> ${response.status}`);
    return {
      etag: normalizeEtag(response.headers.get("etag")),
      contentType: response.headers.get("content-type") ?? undefined,
      size: Number(response.headers.get("content-length") ?? undefined) || undefined,
      url: this.objectUrl(path),
    };
  }

  async list(options: ObjectListOptions): Promise<ObjectListResult> {
    const params = new URLSearchParams({
      "list-type": "2",
      prefix: this.physicalKey(options.prefix),
      "max-keys": String(options.limit ?? 1000),
    });
    if (options.mode === "folded") params.set("delimiter", "/");
    if (options.cursor) params.set("continuation-token", options.cursor);
    const response = await this.request("GET", "", { query: params });
    if (!response.ok) throw new Error(`R2 list ${options.prefix} -> ${response.status}`);
    const xml = await response.text();
    const blobs: ObjectListItem[] = xmlAll(xml, "Contents").map((contents) => {
      const key = xmlText(contents, "Key") ?? "";
      const pathname = this.logicalPath(key);
      return {
        pathname,
        url: this.objectUrl(pathname),
        size: Number(xmlText(contents, "Size") ?? 0),
        etag: normalizeEtag(xmlText(contents, "ETag")) ?? undefined,
      };
    });
    const folders = xmlAll(xml, "CommonPrefixes")
      .map((block) => xmlText(block, "Prefix") ?? "")
      .map((prefix) => this.logicalPath(prefix))
      .filter(Boolean);
    const truncated = (xmlText(xml, "IsTruncated") ?? "false").toLowerCase() === "true";
    const cursor = xmlText(xml, "NextContinuationToken");
    return { blobs, folders, cursor, hasMore: truncated || Boolean(cursor) };
  }

  async del(pathsOrUrls: string | string[]): Promise<void> {
    const keys = (Array.isArray(pathsOrUrls) ? pathsOrUrls : [pathsOrUrls]).map((value) => this.keyFromUrlOrPath(value));
    if (keys.length === 0) return;
    if (keys.length === 1) {
      const response = await this.request("DELETE", keys[0]);
      if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
        throw new Error(`R2 delete ${keys[0]} -> ${response.status}`);
      }
      return;
    }
    const xml = `<Delete>${keys.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`).join("")}</Delete>`;
    const body = new TextEncoder().encode(xml);
    const response = await this.request("POST", "", {
      query: new URLSearchParams({ delete: "" }),
      headers: { "content-type": "application/xml" },
      body,
    });
    if (!response.ok) throw new Error(`R2 delete ${keys.length} objects -> ${response.status}`);
    const result = await response.text();
    if (result.includes("<Error>")) throw new Error(`R2 delete reported object errors: ${result}`);
  }

  private keyFromUrlOrPath(value: string): string {
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

  private async request(
    method: string,
    key: string,
    init: { query?: URLSearchParams; headers?: Record<string, string>; body?: Uint8Array } = {},
  ): Promise<Response> {
    const url = new URL(`${this.endpoint}/${this.bucket}${key ? `/${encodeS3Path(key)}` : ""}`);
    if (init.query) {
      for (const [name, value] of init.query.entries()) url.searchParams.append(name, value);
    }
    const headers = signS3Request({
      method,
      url,
      headers: init.headers,
      body: init.body,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      now: this.now(),
    });
    return this.fetchImpl(url, {
      method,
      headers,
      body: init.body ? Buffer.from(init.body) : undefined,
    });
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
