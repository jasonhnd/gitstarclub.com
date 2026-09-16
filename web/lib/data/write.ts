import { resolveCanonicalBlobPath } from "@/lib/data/bootstrap-publication";
import { getWriteObjectStore, isObjectStoreConflict, type ObjectStore } from "@/lib/storage";

// Cron-side object writes (daily live tail). Reads stay public-URL fetches (source.ts);
// only the cron writes. Default driver is still Vercel Blob (`STORAGE_WRITE_DRIVER=blob`).
// Short cache — readers cache-bust with ?v=.

export async function putView(path: string, data: unknown, store: ObjectStore = getWriteObjectStore()): Promise<void> {
  const physicalPath = await resolveCanonicalBlobPath(path);
  await store.put(physicalPath, JSON.stringify(data), {
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

/** Create an immutable JSON artifact. Returns false when another retry already created it. */
export async function createView(
  path: string,
  data: unknown,
  store: ObjectStore = getWriteObjectStore(),
): Promise<boolean> {
  const physicalPath = await resolveCanonicalBlobPath(path);
  try {
    await store.put(physicalPath, JSON.stringify(data), {
      allowOverwrite: false,
      contentType: "application/json",
      cacheControlMaxAge: 31536000,
    });
    return true;
  } catch (error) {
    if (isObjectStoreConflict(error)) return false;
    throw error;
  }
}
