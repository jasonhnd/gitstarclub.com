import * as runtimeEnv from "@/lib/workers-host/runtime-env";
import {
  SANITIZED_ERROR_MAX_CODE_POINTS,
  sanitizeErrorText as redactErrorText,
  type SanitizeErrorEnv,
  type SanitizeErrorOptions,
} from "./sanitize-error-text";

export { SANITIZED_ERROR_MAX_CODE_POINTS, type SanitizeErrorEnv, type SanitizeErrorOptions };

/**
 * Bounded redaction for error text that leaves the process.
 *
 * Logs, webhooks, and ops JSON in public-read storage keep a short failure
 * category. When `options.env` is omitted, secrets are read from the live
 * Worker env and from stale `process.env`. Pass `env` in tests, and from
 * runtimes that already hold the live bindings, so this file's OpenNext
 * lookup stays out of those bundles.
 */
export function sanitizeErrorText(value: unknown, options: SanitizeErrorOptions = {}): string {
  if (options.env || (options.envs && options.envs.length > 0)) return redactErrorText(value, options);
  const stale = process.env;
  const live = runtimeEnv.resolveRuntimeEnv(stale);
  const envs = live === stale ? [stale] : [stale, live];
  return redactErrorText(value, { maxCodePoints: options.maxCodePoints, envs });
}
