import { AsyncLocalStorage } from "node:async_hooks";
import { BootstrapPublicationPointer, LiveGenerationPointer, ViewsPointer } from "../contracts";
import type { R2Bucket } from "../storage/r2-binding-store";

export const POINTER_PATHS = ["views/latest.json", "bootstrap/latest.json", "live/latest.json"] as const;
const MAX_POINTER_BYTES = 32_768;
export type PointerRead = { body: string; etag: string } | null;
export type Publication = {
  id: string;
  views: ViewsPointer | null;
  bootstrap: BootstrapPublicationPointer | null;
  live: LiveGenerationPointer | null;
};
export const publicationScope = new AsyncLocalStorage<Publication>();

export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Includes pointer bytes, ETags and timestamps, so rollback is a new transition. */
export async function readPublication(read: (path: string) => Promise<PointerRead>): Promise<Publication> {
  const records = await Promise.all(POINTER_PATHS.map(read));
  const values = records.map((record) => {
    if (!record) return null;
    if (record.body.length > MAX_POINTER_BYTES || !record.etag || record.etag.length > 1024) {
      throw new Error("Invalid publication pointer envelope");
    }
    return JSON.parse(record.body) as unknown;
  });
  return {
    id: await sha256(JSON.stringify(records)),
    views: values[0] === null ? null : ViewsPointer.parse(values[0]),
    bootstrap: values[1] === null ? null : BootstrapPublicationPointer.parse(values[1]),
    live: values[2] === null ? null : LiveGenerationPointer.parse(values[2]),
  };
}

/** Strong R2 binding reads; no public CDN, process memo or KV lookup participates. */
export function publicationFromBucket(bucket: R2Bucket): Promise<Publication> {
  return readPublication(async (path) => {
    const object = await bucket.get(path);
    if (!object) return null;
    if (object.size > MAX_POINTER_BYTES) throw new Error("Publication pointer too large");
    return { body: await object.text(), etag: object.etag };
  });
}
