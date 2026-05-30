import { put } from "@vercel/blob";

// Cron-side Blob writes (daily live tail). Reads stay public-URL fetches (source.ts);
// only the cron writes, with BLOB_READ_WRITE_TOKEN. Short cache — readers cache-bust with ?v=.

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export async function putView(path: string, data: unknown): Promise<void> {
  if (!TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  await put(path, JSON.stringify(data), {
    access: "public",
    token: TOKEN,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}
