import { existsSync, readFileSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// Opt-in gate for the live network smoke suite (live-smoke.test.ts).
//
// The suite is enabled only when RUN_LIVE_SMOKE is exactly "1" AND the target
// origin comes from LIVE_SMOKE_SITE_URL. There is no hard-coded default site.
// web/.env.local is read only after the opt-in check passes, so a developer
// checkout with that file never triggers network requests from `bun run test`.
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveSmokeEnv {
  [name: string]: string | undefined;
  RUN_LIVE_SMOKE?: string;
  LIVE_SMOKE_SITE_URL?: string;
  BLOB_BASE_URL?: string;
  NEXT_PUBLIC_BLOB_BASE_URL?: string;
}

export type LiveSmokeConfig =
  | { enabled: true; site: string; blobBase: string }
  | { enabled: false; reason: string };

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isHttpOrigin(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Read ONLY the BLOB_BASE_URL line from an env file. Never touches the token or
 * any other secret; returns null when the file or the line is absent.
 */
export function readBlobBaseFromEnvFile(envPath: string): string | null {
  if (!existsSync(envPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return null;
  }
  // Match exactly the BLOB_BASE_URL assignment; ignore BLOB_READ_WRITE_TOKEN etc.
  const match = raw.match(/^\s*BLOB_BASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
  if (!match) return null;
  return trimTrailingSlashes(match[1]);
}

/**
 * Decide whether the live smoke suite runs. `readEnvLocalBlobBase` is called
 * only after RUN_LIVE_SMOKE=1 and a valid LIVE_SMOKE_SITE_URL are present.
 * Blob base precedence is unchanged: web/.env.local first, then the env vars.
 */
export function resolveLiveSmokeConfig(
  env: LiveSmokeEnv,
  readEnvLocalBlobBase: () => string | null,
): LiveSmokeConfig {
  if (env.RUN_LIVE_SMOKE !== "1") {
    return { enabled: false, reason: "RUN_LIVE_SMOKE is not 1" };
  }

  const site = trimTrailingSlashes(env.LIVE_SMOKE_SITE_URL ?? "");
  if (!site) {
    return { enabled: false, reason: "LIVE_SMOKE_SITE_URL is not set" };
  }
  if (!isHttpOrigin(site)) {
    return { enabled: false, reason: "LIVE_SMOKE_SITE_URL is not an http(s) URL" };
  }

  const blobBase = trimTrailingSlashes(
    readEnvLocalBlobBase() ?? env.BLOB_BASE_URL ?? env.NEXT_PUBLIC_BLOB_BASE_URL ?? "",
  );
  if (!blobBase) {
    return {
      enabled: false,
      reason: "no BLOB_BASE_URL in web/.env.local, BLOB_BASE_URL, or NEXT_PUBLIC_BLOB_BASE_URL",
    };
  }

  return { enabled: true, site, blobBase };
}
