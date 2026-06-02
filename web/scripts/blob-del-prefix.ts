// Delete every Blob under a prefix (paginated). Reusable for cleaning throwaway verify-*
// versions and for version GC. Refuses to run without an explicit, non-trivial prefix.
//   bun run scripts/blob-del-prefix.ts views/verify-<id>/
/* eslint-disable no-console */
import { list, del } from "@vercel/blob";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const prefix = process.argv[2];
if (!TOKEN) { console.error("BLOB_READ_WRITE_TOKEN not set"); process.exit(1); }
if (!prefix || prefix.length < 8 || !prefix.includes("/")) {
  console.error(`Refusing to delete with prefix "${prefix}" — pass a specific path like views/verify-XXX/`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CHUNK = 100;

async function delChunk(urls: string[]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await del(urls, { token: TOKEN });
      return;
    } catch (err) {
      const retryAfter = (err as { retryAfter?: number })?.retryAfter;
      if (retryAfter && attempt < 5) {
        console.log(`rate-limited, waiting ${retryAfter}s…`);
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      throw err;
    }
  }
}

let cursor: string | undefined;
let total = 0;
do {
  const res = await list({ prefix, cursor, limit: 1000, token: TOKEN });
  for (let i = 0; i < res.blobs.length; i += CHUNK) {
    await delChunk(res.blobs.slice(i, i + CHUNK).map((b) => b.url));
    total += Math.min(CHUNK, res.blobs.length - i);
    await sleep(250); // throttle under the delete rate limit
  }
  if (res.blobs.length) console.log(`deleted ${total}…`);
  cursor = res.cursor;
} while (cursor);
console.log(`done: deleted ${total} blobs under "${prefix}"`);
