import { isObjectStoreConflict } from "./errors";
import type { ObjectStore } from "./types";

type Body = string | Uint8Array;

export type BootstrapStoreAdapter = {
  read(path: string): Promise<Buffer | null>;
  create(path: string, body: Body, contentType?: string): Promise<boolean>;
  readSnapshot(path: string): Promise<{ body: Buffer | null; etag: string | null }>;
  createMutable(path: string, body: Body, contentType?: string): Promise<boolean>;
  compareAndSet(path: string, etag: string, body: Body, contentType?: string): Promise<boolean>;
  put(path: string, body: Body, contentType?: string): Promise<void>;
  delete(path: string): Promise<void>;
};

function asBuffer(body: string): Buffer {
  return Buffer.from(body);
}

/**
 * Bootstrap publication speaks Buffer + create/CAS. ObjectStore speaks text
 * and put options. JSON ops use this adapter so R2 puts still hit the
 * bucket-identity guard on the write store.
 */
export function createObjectStoreBootstrapAdapter(store: ObjectStore): BootstrapStoreAdapter {
  return {
    async read(path) {
      const result = await store.get(path);
      return result ? asBuffer(result.body) : null;
    },
    async create(path, body, contentType = "application/octet-stream") {
      try {
        await store.put(path, body, {
          allowOverwrite: false,
          contentType,
          cacheControlMaxAge: 31536000,
        });
        return true;
      } catch (error) {
        if (isObjectStoreConflict(error)) return false;
        throw error;
      }
    },
    async readSnapshot(path) {
      const result = await store.get(path);
      if (!result) return { body: null, etag: null };
      return { body: asBuffer(result.body), etag: result.etag };
    },
    async createMutable(path, body, contentType = "application/json") {
      try {
        await store.put(path, body, {
          allowOverwrite: false,
          contentType,
          cacheControlMaxAge: 60,
        });
        return true;
      } catch (error) {
        if (isObjectStoreConflict(error)) return false;
        throw error;
      }
    },
    async compareAndSet(path, etag, body, contentType = "application/json") {
      try {
        await store.put(path, body, {
          allowOverwrite: true,
          ifMatch: etag,
          contentType,
          cacheControlMaxAge: 60,
        });
        return true;
      } catch (error) {
        if (isObjectStoreConflict(error)) return false;
        throw error;
      }
    },
    async put(path, body, contentType = "application/json") {
      await store.put(path, body, {
        allowOverwrite: true,
        contentType,
        cacheControlMaxAge: 60,
      });
    },
    async delete(path) {
      await store.del(path);
    },
  };
}
