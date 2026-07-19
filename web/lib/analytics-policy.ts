export const ENABLED_ANALYTICS_PROVIDERS = ["vercel-web-analytics"] as const;

type AnalyticsEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Analytics is intentionally environment-invariant. In particular, the former
 * NEXT_PUBLIC_GA_ID setting must never re-enable a third-party script.
 */
export function analyticsProvidersForEnvironment(
  environment: AnalyticsEnvironment = process.env,
): typeof ENABLED_ANALYTICS_PROVIDERS {
  void environment;
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
export function assertAnalyticsCspCompatibility(csp: string): void {
  const providers = analyticsProvidersForEnvironment();
  if (!providers.includes("vercel-web-analytics")) return;

  for (const directive of ["script-src", "connect-src"] as const) {
    if (!directiveSources(csp, directive).includes("'self'")) {
      throw new Error(
        `Analytics policy requires ${directive} to allow 'self' for Vercel Web Analytics`,
      );
    }
  }
}
