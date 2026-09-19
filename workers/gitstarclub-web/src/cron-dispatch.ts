export const CRON_DAILY = "0 3 * * *";
export const CRON_WEEKLY = "0 4 * * 0";
export const CRON_REFRESH = "0 6 * * 0";

export const CRON_DAILY_PATH = "/api/cron/daily";
export const CRON_WEEKLY_PATH = "/api/cron/weekly";
export const CRON_REFRESH_PATH = "/api/workflows/refresh/start";

/** Public production origin. Never use this as a preview fallback. */
export const PRODUCTION_CRON_ORIGIN = "https://gitstarclub.com";
/** Preview origin. Set on wrangler env `pre`, not on production. */
export const PREVIEW_CRON_ORIGIN = "https://pre.gitstarclub.com";

export const CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN = "https://gitstarclub-web.worldgo.workers.dev";

export const PREVIEW_CRON_TRIGGERS = Object.freeze([CRON_DAILY, CRON_WEEKLY, CRON_REFRESH]);

export type CronDispatchPlan =
  | { kind: "daily"; path: typeof CRON_DAILY_PATH }
  | { kind: "weekly"; path: typeof CRON_WEEKLY_PATH }
  | { kind: "refresh"; path: typeof CRON_REFRESH_PATH }
  | { kind: "unknown"; cron: string };

export function planCronDispatch(cron: string): CronDispatchPlan {
  switch (cron) {
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
