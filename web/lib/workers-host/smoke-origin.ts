import { DEFAULT_CF_PREVIEW_ORIGIN, getCfPreviewOrigin } from "@/lib/runtime-config";

export function workersHostSmokeOrigin(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.CF_WORKERS_HOST_ORIGIN?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  if (env.CF_WORKERS_HOST_LOCAL === "1") return "http://127.0.0.1:8787";
  const preview = getCfPreviewOrigin(env);
  if (preview === DEFAULT_CF_PREVIEW_ORIGIN && !env.CF_ACCESS_CLIENT_ID?.trim()) {
    return "http://127.0.0.1:8787";
  }
  return preview;
}
