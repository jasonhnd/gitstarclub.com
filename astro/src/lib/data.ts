import { R2BindingObjectStore, type R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { readBaseView } from "./views";
import type { Publication } from "../../../web/lib/workers-host/publication-fence";

/** Read-only facade over the existing native R2 implementation; no writer is exposed. */
export function pageData(bucket: R2Bucket, publication: Publication) {
  const store = new R2BindingObjectStore({ bucket });
  const read = async (key: string) => (await store.get(key))?.body ?? null;
  return {
    publication,
    base<T>(path: string, schema: { parse(value: unknown): T }) { return readBaseView(publication, read, path, schema); },
    async raw<T>(key: string, schema: { parse(value: unknown): T }): Promise<T | null> {
      const body = await read(key);
      return body === null ? null : schema.parse(JSON.parse(body));
    },
  };
}
