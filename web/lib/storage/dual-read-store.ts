import type {
  ObjectGetResult,
  ObjectHeadResult,
  ObjectListOptions,
  ObjectListResult,
  ObjectPutOptions,
  ObjectPutResult,
  ObjectStore,
} from "./types";

/**
 * Read-only fan-out: try the primary store, then the fallback on miss or
 * transport failure. Writes must go through the write driver.
 */
export class DualReadObjectStore implements ObjectStore {
  constructor(
    private readonly primary: ObjectStore,
    private readonly fallback: ObjectStore,
  ) {}

  async put(path: string, body: string | Uint8Array, options?: ObjectPutOptions): Promise<ObjectPutResult> {
    void path;
    void body;
    void options;
    throw new Error("DualReadObjectStore is read-only; writes use getWriteObjectStore()");
  }

  async del(pathsOrUrls: string | string[]): Promise<void> {
    void pathsOrUrls;
    throw new Error("DualReadObjectStore is read-only; deletes use getWriteObjectStore()");
  }

  async get(path: string): Promise<ObjectGetResult | null> {
    return this.readThrough((store) => store.get(path));
  }

  async head(path: string): Promise<ObjectHeadResult | null> {
    return this.readThrough((store) => store.head(path));
  }

  async list(options: ObjectListOptions): Promise<ObjectListResult> {
    try {
      const primary = await this.primary.list(options);
      if (primary.blobs.length > 0 || primary.folders.length > 0) return primary;
    } catch {
      // Fall through to the blob store so a cold R2 prefix does not hide live data.
    }
    return this.fallback.list(options);
  }

  private async readThrough<T>(read: (store: ObjectStore) => Promise<T | null>): Promise<T | null> {
    try {
      const hit = await read(this.primary);
      if (hit) return hit;
    } catch {
      // Miss or transport error: read the still-authoritative blob copy.
    }
    return read(this.fallback);
  }
}
