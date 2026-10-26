import { LOCALES } from "../../i18n/locales";
export const TAIL_FRESH_SECONDS = 604_800;
export const TAIL_EXPIRE_SECONDS = TAIL_FRESH_SECONDS + 86_400;
export const RETENTION_SECONDS = 30 * 86_400;
export const MAX_TAGS = 128;
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const reserved = new Set(["api", "rankings", "categories", "o", "data", "search-index", "repo-curve", "preview", ".well-known", "releases"]);

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
  const localized = LOCALES.includes(parts[0] as typeof LOCALES[number]) && parts[0] !== "en";
  const segments = localized ? parts.slice(1) : parts.slice();
  if (segments[0] === "rankings") {
    if (segments[1]) segments[1] = "[year]";
    if (segments[2]) segments[2] = "[period]";
  } else if (segments[0] === "categories") {
    if (segments[1]) segments[1] = "[dimension]";
    if (segments[2]) segments[2] = "[slug]";
    if (segments[4]) segments[4] = "[page]";
  } else if (segments[0] === "o" && segments[1]) {
    if (segments[1] === "page") segments[2] = "[page]";
    else segments[1] = "[login]";
  } else if (isLongTail(path)) {
    segments[0] = localized ? "[owner]" : "[locale]";
    segments[1] = localized ? "[name]" : "[owner]";
  }
  const route = localized ? ["(localized)", "[locale]", ...segments] : ["(en)", ...segments];
  const tags = [path, "_N_T_/layout", `_N_T_${path}`, `_N_T_${path === "/" ? "" : path}/page`,
    ...parts.map((_, i) => `_N_T_/${parts.slice(0, i + 1).join("/")}/layout`),
    ...route.map((_, i) => `_N_T_/${route.slice(0, i + 1).join("/")}/layout`),
    `_N_T_/${route.join("/")}/page`];
  return [...new Set(tags)].map((tag) => tag.replace(/[^\t\x20-\x7e]+/g, (run) => encodeURIComponent(run)));
}

export function boundedTags(tags: unknown): string[] {
  if (!Array.isArray(tags) || tags.length > MAX_TAGS) throw new Error("Cache tag count exceeded");
  if (tags.some((tag) => typeof tag !== "string" || !tag.length || tag.length > 1024 || /[\x00-\x1f\\]/.test(tag))) {
    throw new Error("Invalid cache tag");
  }
  return [...new Set(tags as string[])];
}
