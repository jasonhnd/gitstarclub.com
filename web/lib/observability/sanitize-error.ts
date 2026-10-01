import { truncateUnicodeText } from "@/lib/unicode-text";
import * as runtimeEnv from "@/lib/workers-host/runtime-env";

/**
 * Bounded redaction for error text that leaves the process.
 *
 * Logs, webhooks, and ops JSON in public-read storage keep a short failure
 * category. Bearer credentials, known runtime secret values, credential URLs,
 * and token-shaped strings are removed first, then the text is cut to
 * {@link SANITIZED_ERROR_MAX_CODE_POINTS} Unicode code points.
 */

export const SANITIZED_ERROR_MAX_CODE_POINTS = 500;

const RUNTIME_SECRET_ENV_KEYS = [
  "CRON_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
  "ALERT_WEBHOOK_URL",
  "VERCEL_DEPLOY_HOOK_URL",
  "CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN",
] as const;

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const USERINFO_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@[^\s]+/gi;
const SENSITIVE_QUERY_URL =
  /\bhttps?:\/\/[^\s]*?(?:x-amz-security-token|x-amz-signature|x-amz-credential|access_token|refresh_token|id_token|api[_-]?key|signature|credential|password|secret|token|sig)=[^\s]*/gi;
const GITHUB_PAT = /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g;
const BLOB_TOKEN = /\bvercel_blob_rw_[A-Za-z0-9_]{8,}\b/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const ASSIGNMENT =
  /(^|[^A-Za-z0-9])(["']?)((?:[A-Za-z0-9]+_)*(?:secret(?:[_-]access[_-]key)?|access[_-]?key(?:[_-]?id)?|api[_-]?key|token|password|passwd|credential))\2\s*[=:]\s*(["']?)([A-Za-z0-9._~+/=-]+)\4/gi;

export type SanitizeErrorEnv = Record<string, string | undefined>;

export type SanitizeErrorOptions = {
  /**
   * Env map used for known runtime secrets. When omitted, both the live Worker
   * env (`resolveRuntimeEnv`) and the stale `process.env` fallback are read.
   * Pass an object in tests so the check stays hermetic.
   */
  env?: SanitizeErrorEnv;
  maxCodePoints?: number;
};

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || value.name || "error";
  if (value == null) return "";
  return String(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rememberSecret(values: Map<string, "[redacted]" | "[redacted-url]">, raw: string | undefined): void {
  if (typeof raw !== "string") return;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return;
  if (trimmed === "[redacted]" || trimmed === "[redacted-url]" || trimmed === "Bearer [redacted]") return;
  const replacement = /^https?:\/\//i.test(trimmed) ? "[redacted-url]" : "[redacted]";
  values.set(trimmed, replacement);
  if (raw !== trimmed) values.set(raw, replacement);
}

function secretEnvs(options: SanitizeErrorOptions): SanitizeErrorEnv[] {
  if (options.env) return [options.env];
  const stale = process.env;
  const live = runtimeEnv.resolveRuntimeEnv(stale);
  return live === stale ? [stale] : [stale, live];
}

function applyRuntimeSecrets(input: string, envs: readonly SanitizeErrorEnv[]): string {
  const values = new Map<string, "[redacted]" | "[redacted-url]">();
  for (const env of envs) {
    for (const key of RUNTIME_SECRET_ENV_KEYS) rememberSecret(values, env[key]);
  }
  const ordered = [...values.entries()].sort((a, b) => b[0].length - a[0].length);
  let output = input;
  for (const [secret, replacement] of ordered) {
    if (/^https?:\/\//i.test(secret)) {
      output = output.replace(new RegExp(`${escapeRegExp(secret)}[^\\s]*`, "g"), replacement);
    } else {
      output = output.split(secret).join(replacement);
    }
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) output = output.split(encoded).join(replacement);
  }
  return output;
}

function redactPatterns(input: string): string {
  return input
    .replace(BEARER, "Bearer [redacted]")
    .replace(USERINFO_URL, "[redacted-url]")
    .replace(SENSITIVE_QUERY_URL, "[redacted-url]")
    .replace(GITHUB_PAT, "[redacted]")
    .replace(GITHUB_TOKEN, "[redacted]")
    .replace(BLOB_TOKEN, "[redacted]")
    .replace(AWS_ACCESS_KEY, "[redacted]")
    .replace(JWT, "[redacted]")
    .replace(ASSIGNMENT, (_match, lead: string, keyQuote: string, key: string) => `${lead}${keyQuote}${key}${keyQuote}=[redacted]`);
}

export function sanitizeErrorText(value: unknown, options: SanitizeErrorOptions = {}): string {
  const maxCodePoints = options.maxCodePoints ?? SANITIZED_ERROR_MAX_CODE_POINTS;
  if (!Number.isSafeInteger(maxCodePoints) || maxCodePoints < 0) {
    throw new RangeError("maxCodePoints must be a non-negative safe integer");
  }
  const redacted = redactPatterns(applyRuntimeSecrets(errorText(value), secretEnvs(options)));
  return truncateUnicodeText(redacted, maxCodePoints);
}
