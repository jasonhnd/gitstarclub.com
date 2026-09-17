export const ENABLED_ANALYTICS_PROVIDERS = ["vercel-web-analytics"] as const;
export type AnalyticsProvider = (typeof ENABLED_ANALYTICS_PROVIDERS)[number];

type AnalyticsEnvironment = Readonly<Record<string, string | undefined>>;

function hostingTarget(environment: AnalyticsEnvironment): string {
  return (environment.HOSTING_TARGET ?? environment.NEXT_PUBLIC_HOSTING_TARGET ?? "").trim().toLowerCase();
}

/**
 * Vercel Web Analytics is the only provider on Vercel. The CF Workers preview
 * host turns it off because `/_vercel/insights` is not available there.
 * `NEXT_PUBLIC_GA_ID` must never re-enable a third-party script.
 * Keep this module free of `runtime-config` imports — `next.config.ts` loads it
 * during tests and a cycle through that graph breaks `web/lib/data` re-exports.
 */
export function analyticsProvidersForEnvironment(
  environment: AnalyticsEnvironment = process.env,
): readonly AnalyticsProvider[] {
  void environment.NEXT_PUBLIC_GA_ID;
  if (environment.VERCEL_ENV !== "production" && hostingTarget(environment) === "cf") {
    return [];
  }
  return ENABLED_ANALYTICS_PROVIDERS;
}

function directiveSources(csp: string, directiveName: string): string[] {
  const directive = csp
    .split(";")
    .map((value) => value.trim())
    .find((value) => value === directiveName || value.startsWith(`${directiveName} `));

  return directive?.split(/\s+/).slice(1) ?? [];
}

/**
 * Vercel Web Analytics is loaded and reported through same-origin
 * /_vercel/insights endpoints. Fail the build if CSP would silently block it.
 */
export function assertAnalyticsCspCompatibility(
  csp: string,
  environment: AnalyticsEnvironment = process.env,
): void {
  const providers = analyticsProvidersForEnvironment(environment);
  if (!providers.includes("vercel-web-analytics")) return;

  for (const directive of ["script-src", "connect-src"] as const) {
    if (!directiveSources(csp, directive).includes("'self'")) {
      throw new Error(
        `Analytics policy requires ${directive} to allow 'self' for Vercel Web Analytics`,
      );
    }
  }
}
