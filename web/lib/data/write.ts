import { put } from "@vercel/blob";
import { requireBlobWriteToken } from "@/lib/runtime-config";

// Cron-side Blob writes (daily live tail). Reads stay public-URL fetches (source.ts);
// only the cron writes, with BLOB_READ_WRITE_TOKEN. Short cache — readers cache-bust with ?v=.

export async function putView(path: string, data: unknown): Promise<void> {
  const token = requireBlobWriteToken();
  await put(path, JSON.stringify(data), {
    access: "public",
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}
