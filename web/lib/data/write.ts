import { BlobPreconditionFailedError, put } from "@vercel/blob";
import { requireBlobWriteToken } from "@/lib/runtime-config";
import { resolveCanonicalBlobPath } from "@/lib/data/bootstrap-publication";

// Cron-side Blob writes (daily live tail). Reads stay public-URL fetches (source.ts);
// only the cron writes, with BLOB_READ_WRITE_TOKEN. Short cache — readers cache-bust with ?v=.

export async function putView(path: string, data: unknown): Promise<void> {
  const token = requireBlobWriteToken();
  const physicalPath = await resolveCanonicalBlobPath(path);
  await put(physicalPath, JSON.stringify(data), {
    access: "public",
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

function isBlobConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(`${error.name} ${error.message}`);
}

/** Create an immutable JSON artifact. Returns false when another retry already created it. */
export async function createView(path: string, data: unknown): Promise<boolean> {
  const token = requireBlobWriteToken();
  const physicalPath = await resolveCanonicalBlobPath(path);
  try {
    await put(physicalPath, JSON.stringify(data), {
      access: "public",
      token,
      allowOverwrite: false,
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 31536000,
    });
    return true;
  } catch (error) {
    if (isBlobConflict(error)) return false;
    throw error;
  }
}
