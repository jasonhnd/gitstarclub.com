import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, list, put } from "@vercel/blob";
import { requireBlobWriteToken } from "@/lib/runtime-config";
import { ObjectStorePreconditionFailedError } from "./errors";
import type {
  ObjectGetResult,
  ObjectHeadResult,
  ObjectListOptions,
  ObjectListResult,
  ObjectPutOptions,
  ObjectPutResult,
  ObjectStore,
} from "./types";

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function rethrowBlobConflict(error: unknown): never {
  if (error instanceof BlobPreconditionFailedError) {
    throw new ObjectStorePreconditionFailedError(error.message);
  }
  throw error;
}

export class VercelBlobObjectStore implements ObjectStore {
  constructor(private readonly token = requireBlobWriteToken) {}

  async put(path: string, body: string | Uint8Array, options: ObjectPutOptions = {}): Promise<ObjectPutResult> {
    try {
      const written = await put(path, body, {
        access: "public",
        token: this.token(),
        allowOverwrite: options.allowOverwrite ?? true,
        addRandomSuffix: false,
        contentType: options.contentType ?? "application/json",
        cacheControlMaxAge: options.cacheControlMaxAge ?? 60,
        ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
      });
      return { etag: written.etag, url: written.url };
    } catch (error) {
      rethrowBlobConflict(error);
    }
  }

  async get(path: string): Promise<ObjectGetResult | null> {
    const result = await get(path, { access: "public", token: this.token() });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) {
      throw new Error(`blob read ${path} -> ${result.statusCode}`);
    }
    return {
      body: await streamText(result.stream),
      etag: result.blob.etag,
      contentType: result.blob.contentType,
      size: result.blob.size,
    };
  }

  async head(path: string): Promise<ObjectHeadResult | null> {
    try {
      const result = await head(path, { token: this.token() });
      return {
        etag: result.etag || null,
        contentType: result.contentType,
        size: result.size,
        url: result.url,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }

  async list(options: ObjectListOptions): Promise<ObjectListResult> {
    const result = await list({
      prefix: options.prefix,
      cursor: options.cursor,
      limit: options.limit,
      mode: options.mode,
      token: this.token(),
    });
    return {
      blobs: result.blobs.map((blob) => ({
        pathname: blob.pathname,
        url: blob.url,
        size: blob.size,
        etag: blob.etag,
      })),
      folders: "folders" in result ? (result.folders ?? []) : [],
      cursor: result.cursor,
      hasMore: result.hasMore,
    };
  }

  async del(pathsOrUrls: string | string[]): Promise<void> {
    await del(pathsOrUrls, { token: this.token() });
  }
}
