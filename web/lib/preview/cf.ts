import {
  assertPreviewTargetAllowed,
  getCfPreviewOrigin,
  requireCfAccessCredentials,
} from "@/lib/runtime-config";
import { cloudflareAccessHeaders } from "./access";
import type { PreviewIdentity } from "./types";

export type PreviewFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const CF_PREVIEW_IDENTITY_PATHS = ["/preview/identity", "/.well-known/deployment"] as const;

/** Same bound as the preview identity GET. Covers the POST and the body read. */
export const CF_PREVIEW_POST_DEADLINE_MS = 15_000;

type Deadline = {
  signal: AbortSignal;
  close: () => void;
};

function positiveDeadline(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("deadlineMs must be a positive finite number");
  }
  return value;
}

function openDeadline(ms: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  return {
    signal: controller.signal,
    close: () => {
      clearTimeout(timer);
    },
  };
}

function waitFor<T>(work: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  const fail = () => {
    try {
      onAbort?.();
    } catch {
      // Body cancellation must not replace the deadline error.
    }
    return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  };
  if (signal.aborted) return Promise.reject(fail());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      settle();
    };
    const handleAbort = () => {
      finish(() => reject(fail()));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export function cfPreviewHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  requireCfAccessCredentials(env);
  return {
    Accept: "application/json",
    ...cloudflareAccessHeaders(env),
  };
}

export type PreviewEnv = Record<string, string | undefined>;

export function cfPreviewUrl(path: string, env: PreviewEnv = process.env): string {
  return new URL(path, `${getCfPreviewOrigin(env)}/`).toString();
}

export async function readCfPreviewIdentity(
  env: PreviewEnv = process.env,
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

/**
 * POST `/` and `/pulse` to the Worker invalidate stub (Access + optional CRON_SECRET).
 * The POST and its JSON body share one deadline so a stalled Worker cannot hold the caller open.
 */
export async function invalidateCfPreviewHotPaths(
  env: PreviewEnv = process.env,
  fetchImpl: PreviewFetch = fetch,
  deadlineMs: number = CF_PREVIEW_POST_DEADLINE_MS,
): Promise<CfHotPathInvalidation> {
  const boundedMs = positiveDeadline(deadlineMs);
  const secret = env.CRON_SECRET?.trim();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...cfPreviewHeaders(env),
  };
  if (secret) headers.authorization = `Bearer ${secret}`;
  const deadline = openDeadline(boundedMs);
  try {
    const response = await waitFor(
      fetchImpl(cfPreviewUrl("/preview/invalidate", env), {
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
        signal: deadline.signal,
      }),
      deadline.signal,
    );
    if (!response.ok) {
      throw new Error(`CF Preview hot-path invalidate -> ${response.status}`);
    }
    const payload = await waitFor(response.json(), deadline.signal, () => {
      void response.body?.cancel().catch(() => undefined);
    });
    return payload as CfHotPathInvalidation;
  } finally {
    deadline.close();
  }
}
