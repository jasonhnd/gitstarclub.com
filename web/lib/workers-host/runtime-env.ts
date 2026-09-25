import { getCloudflareContext } from "@opennextjs/cloudflare";

export type RuntimeEnv = Record<string, string | undefined>;

export function workerStringEnv(env: Record<string, unknown>): RuntimeEnv {
  const out: RuntimeEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * OpenNext copies Worker string bindings into `process.env` once per isolate.
 * After a binding restore, warm isolates can keep stale `process.env` until
 * recycled. Prefer the live Worker `env` from the Cloudflare context when present.
 */
export function resolveRuntimeEnv(fallback: RuntimeEnv = process.env): RuntimeEnv {
  try {
    const { env } = getCloudflareContext();
    return { ...fallback, ...workerStringEnv(env as Record<string, unknown>) };
  } catch {
    return fallback;
  }
}
