import type { Publication } from "../../../web/lib/workers-host/publication-fence";

export type JsonReader = (key: string) => Promise<string | null>;

/** Narrow base-view transport proof. Full live/history readers belong to Gate 1. */
export function baseViewKey(publication: Publication, path: string): string {
  if (!/^[a-zA-Z0-9_./-]+\.json$/.test(path) || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("Invalid logical view path");
  }
  const { views, bootstrap } = publication;
  if (bootstrap && (!views || Date.parse(bootstrap.published_at) > Date.parse(views.published_at))) return `${bootstrap.prefix}/views/${path}`;
  if (views) {
    if (!/^[a-zA-Z0-9._-]+$/.test(views.version) || views.version === "..") throw new Error("Invalid view version");
    return `views/${views.version}/${path}`;
  }
  return path;
}

export async function readBaseView<T>(publication: Publication, read: JsonReader, path: string, schema: { parse(value: unknown): T }): Promise<T | null> {
  const body = await read(baseViewKey(publication, path));
  return body === null ? null : schema.parse(JSON.parse(body));
}
