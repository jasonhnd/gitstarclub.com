import type { ObjectStore } from "./types";

/** Collect every folded page before consumers read or delete anything. */
export async function listObjectFolders(store: ObjectStore, prefix: string): Promise<string[]> {
  const folders = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const page = await store.list({ prefix, mode: "folded", cursor });
    for (const folder of page.folders) folders.add(folder);
    if (!page.hasMore) return [...folders];
    if (!page.cursor || cursors.has(page.cursor)) {
      throw new Error(`invalid pagination cursor while listing ${prefix}`);
    }
    cursors.add(page.cursor);
    cursor = page.cursor;
  }
}
