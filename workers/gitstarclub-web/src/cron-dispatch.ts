// Cloudflare Cron Triggers number weekdays 1 = Sunday ... 7 = Saturday and
// reject 0. See https://developers.cloudflare.com/workers/configuration/cron-triggers/.
// Canonical weekly/refresh expressions use the unambiguous SUN token.
export const CRON_DAILY = "0 3 * * *";
export const CRON_WEEKLY = "0 4 * * SUN";
export const CRON_WEEKLY_NUMERIC = "0 4 * * 1";
export const CRON_REFRESH = "0 6 * * SUN";
export const CRON_REFRESH_NUMERIC = "0 6 * * 1";

export const CRON_DAILY_PATH = "/api/cron/daily";
export const CRON_WEEKLY_PATH = "/api/cron/weekly";
export const CRON_REFRESH_PATH = "/api/workflows/refresh/start";

/** Cloudflare Sunday spellings: SUN (any case) and numeric 1. */
export const CRON_WEEKLY_ALIASES = Object.freeze([CRON_WEEKLY, CRON_WEEKLY_NUMERIC]);
export const CRON_REFRESH_ALIASES = Object.freeze([CRON_REFRESH, CRON_REFRESH_NUMERIC]);

/** Public production origin. Never use this as a preview fallback. */
export const PRODUCTION_CRON_ORIGIN = "https://gitstarclub.com";
/** Preview origin. Set on wrangler env `pre`, not on production. */
export const PREVIEW_CRON_ORIGIN = "https://pre.gitstarclub.com";

export const CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN = "https://gitstarclub-web.worldgo.workers.dev";

/**
 * Intended env.pre schedule once preview is re-enabled. The repo keeps
 * env.pre triggers.crons [] while preview is paused (#543).
 */
export const PREVIEW_CRON_TRIGGERS = Object.freeze([CRON_DAILY, CRON_WEEKLY, CRON_REFRESH]);

export type CronDispatchPlan =
  | { kind: "daily"; path: typeof CRON_DAILY_PATH }
  | { kind: "weekly"; path: typeof CRON_WEEKLY_PATH }
  | { kind: "refresh"; path: typeof CRON_REFRESH_PATH }
  | { kind: "unknown"; cron: string };

const SUNDAY_DOW = /^(?:1|SUN)$/i;

/**
 * Map Cloudflare Sunday spellings (`SUN` in any case, or `1`) to `SUN`.
 * `7` is Saturday on Cloudflare and `0` is rejected by the Cloudflare API, so
 * neither is Sunday here; both stay unknown and fail the scheduled invocation.
 * Daily stays `0 3 * * *`.
 */
export function canonicalSundayCron(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [minute, hour, dayOfMonth, month, dow] = parts;
  if (!dow || !SUNDAY_DOW.test(dow)) return cron;
  return `${minute} ${hour} ${dayOfMonth} ${month} SUN`;
}

export function planCronDispatch(cron: string): CronDispatchPlan {
  switch (canonicalSundayCron(cron)) {
    case CRON_DAILY:
      return { kind: "daily", path: CRON_DAILY_PATH };
    case CRON_WEEKLY:
      return { kind: "weekly", path: CRON_WEEKLY_PATH };
    case CRON_REFRESH:
      return { kind: "refresh", path: CRON_REFRESH_PATH };
    default:
      return { kind: "unknown", cron };
  }
}

function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/**
 * Cron HTTP origin is env-only. Preview and production must set different
 * `CF_CRON_ORIGIN` values; this helper never guesses a host.
 */
export function resolveCronOrigin(env: { CF_CRON_ORIGIN?: string }): string {
  const explicit = env.CF_CRON_ORIGIN?.trim();
  if (!explicit) {
    throw new Error(
      "CF_CRON_ORIGIN is required; set https://pre.gitstarclub.com on preview or https://gitstarclub.com on production",
    );
  }
  const origin = stripTrailingSlash(explicit);
  if (origin === CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN) {
    throw new Error("CF_CRON_ORIGIN must not be the closed production workers.dev host");
  }
  return origin;
}

export function resolveRefreshStartUrl(env: { REFRESH_START_URL?: string; CF_CRON_ORIGIN?: string }): string {
  const explicit = env.REFRESH_START_URL?.trim();
  if (explicit) return explicit;
  return `${resolveCronOrigin(env)}${CRON_REFRESH_PATH}`;
}

export function cronHttpUrl(env: { CF_CRON_ORIGIN?: string }, path: string): string {
  return `${resolveCronOrigin(env)}${path}`;
}
