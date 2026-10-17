export type ObjectPutOptions = {
  contentType?: string;
  cacheControlMaxAge?: number;
  allowOverwrite?: boolean;
  ifMatch?: string;
};

export type ObjectPutResult = {
  etag: string;
  url?: string;
};

export type ObjectGetResult = {
  body: string;
  etag: string | null;
  contentType?: string;
  size?: number;
};

/** Binary GET. `get()` is text and must not be used for parquet or other non-UTF-8 objects. */
export type ObjectGetBytesResult = {
  body: Uint8Array;
  etag: string | null;
  contentType?: string;
  size?: number;
};

export type ObjectHeadResult = {
  etag: string | null;
  contentType?: string;
  size?: number;
  url?: string;
};

export type ObjectListItem = {
  pathname: string;
  url: string;
  size: number;
  etag?: string;
};

export type ObjectListOptions = {
  prefix: string;
  cursor?: string;
  limit?: number;
  mode?: "expanded" | "folded";
};

export type ObjectListResult = {
  blobs: ObjectListItem[];
  folders: string[];
  cursor?: string;
  hasMore: boolean;
};

export interface ObjectStore {
  put(path: string, body: string | Uint8Array, options?: ObjectPutOptions): Promise<ObjectPutResult>;
  get(path: string): Promise<ObjectGetResult | null>;
  /**
   * Origin-consistent GET. Vercel Blob public `get()` may be CDN-stale relative
   * to `head()`. Lease CAS must not pair a stale body with an origin ETag
   * (that would overwrite a successor) and must not fail a still-owned token
   * just because the public pair is divergent. Memory and R2 may omit this —
   * their `get()` is already origin.
   */
  getOrigin?(path: string): Promise<ObjectGetResult | null>;
  /**
   * Byte-preserving GET. Required for bootstrap publication, which hashes
   * staged parquet. Stores that only implement text `get()` must not be used
   * for that path.
   */
  getBytes?(path: string): Promise<ObjectGetBytesResult | null>;
  head(path: string): Promise<ObjectHeadResult | null>;
  list(options: ObjectListOptions): Promise<ObjectListResult>;
  del(pathsOrUrls: string | string[]): Promise<void>;
}
