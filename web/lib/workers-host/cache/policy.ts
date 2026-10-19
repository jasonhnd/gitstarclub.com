import { LOCALES } from "../../i18n/locales";
export const TAIL_FRESH_SECONDS = 604_800;
export const TAIL_EXPIRE_SECONDS = TAIL_FRESH_SECONDS + 86_400;
export const RETENTION_SECONDS = 30 * 86_400;
export const MAX_TAGS = 128;
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const reserved = new Set(["api", "rankings", "categories", "o", "data", "search-index", "repo-curve", "preview", ".well-known"]);

export function isLongTail(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (LOCALES.includes(segments[0] as typeof LOCALES[number])) segments.shift();
  if (segments[0] === "o") return segments.length === 2 && segments[1] !== "page";
  if (segments[0] === "categories") return segments.length === 3 || (segments.length === 5 && segments[3] === "page");
  return segments.length === 2 && !reserved.has(segments[0]) && !segments[1].includes(".");
}

export function bypassPageCache(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return request.method !== "GET" || ["authorization", "cookie", "range"].some((h) => request.headers.has(h))
    || /^\/(api|preview|\.well-known|start|enqueue|search-index|repo-curve)(\/|$)/.test(path)
    || path.includes("refresh");
}

/** Match the framework's concrete page plus every ancestor layout tag. */
export function pathTags(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return [...new Set(["_N_T_/layout", `_N_T_${path}`, `_N_T_${path === "/" ? "" : path}/page`,
    ...parts.map((_, i) => `_N_T_/${parts.slice(0, i + 1).join("/")}/layout`)])];
}

export function boundedTags(tags: unknown): string[] {
  if (!Array.isArray(tags) || tags.length > MAX_TAGS) throw new Error("Cache tag count exceeded");
  if (tags.some((tag) => typeof tag !== "string" || !tag.length || tag.length > 1024 || /[\x00-\x1f\\]/.test(tag))) {
    throw new Error("Invalid cache tag");
  }
  return [...new Set(tags as string[])];
}
