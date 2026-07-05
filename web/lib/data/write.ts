import { put } from "@vercel/blob";
import { requireBlobWriteToken } from "@/lib/runtime-config";

// Cron-side Blob writes (daily live tail). Reads stay public-URL fetches (source.ts);
// only the cron writes, with BLOB_READ_WRITE_TOKEN. Short cache — readers cache-bust with ?v=.

export interface PutViewOptions {
  allowOverwrite?: boolean;
  cacheControlMaxAge?: number;
  ifMatch?: string;
}

export async function putView(path: string, data: unknown, options: PutViewOptions = {}): Promise<void> {
  const token = requireBlobWriteToken();
  await put(path, JSON.stringify(data), {
    access: "public",
    token,
    allowOverwrite: options.allowOverwrite ?? true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: options.cacheControlMaxAge ?? 60,
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
  });
}
