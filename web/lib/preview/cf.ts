import {
  assertPreviewTargetAllowed,
  getCfPreviewOrigin,
  requireCfAccessCredentials,
} from "@/lib/runtime-config";
import { cloudflareAccessHeaders } from "./access";
import type { PreviewIdentity } from "./types";

export type PreviewFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const CF_PREVIEW_IDENTITY_PATHS = ["/preview/identity", "/.well-known/deployment"] as const;

export function cfPreviewHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  requireCfAccessCredentials(env);
  return {
    Accept: "application/json",
    ...cloudflareAccessHeaders(env),
  };
}

export function cfPreviewUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return new URL(path, `${getCfPreviewOrigin(env)}/`).toString();
}

export async function readCfPreviewIdentity(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: PreviewFetch = fetch,
): Promise<PreviewIdentity | null> {
  assertPreviewTargetAllowed(env);
  const headers = cfPreviewHeaders(env);
  for (const path of CF_PREVIEW_IDENTITY_PATHS) {
    try {
      const response = await fetchImpl(cfPreviewUrl(path, env), {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as PreviewIdentity;
      if (body && typeof body === "object") {
        return {
          commitSha: typeof body.commitSha === "string" ? body.commitSha : null,
          deploymentUrl: typeof body.deploymentUrl === "string" ? body.deploymentUrl : getCfPreviewOrigin(env),
          target: "cf",
          host: typeof body.host === "string" ? body.host : new URL(getCfPreviewOrigin(env)).host,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export type CfHotPathInvalidation = {
  ok: boolean;
  recorded: Array<{ kind: "path" | "tag"; path?: string; tag?: string }>;
};

/** POST `/` and `/pulse` to the Worker invalidate stub (Access + optional CRON_SECRET). */
export async function invalidateCfPreviewHotPaths(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: PreviewFetch = fetch,
): Promise<CfHotPathInvalidation> {
  const secret = env.CRON_SECRET?.trim();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...cfPreviewHeaders(env),
  };
  if (secret) headers.authorization = `Bearer ${secret}`;
  const response = await fetchImpl(cfPreviewUrl("/preview/invalidate", env), {
    method: "POST",
    headers,
    body: JSON.stringify({
      v: 1,
      driver: "cf-stub",
      ops: [
        { kind: "path", path: "/" },
        { kind: "path", path: "/pulse" },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`CF Preview hot-path invalidate -> ${response.status}`);
  }
  return (await response.json()) as CfHotPathInvalidation;
}
