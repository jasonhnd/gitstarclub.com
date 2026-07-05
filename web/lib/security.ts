import { createHash, timingSafeEqual } from "node:crypto";
import { THEME_INIT_SCRIPT } from "./theme-script";

type Header = { key: string; value: string };

export function safeExternalHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sha256CspHash(value: string): string {
  return `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
}

export function googleAnalyticsInitScript(gaId: string, dataLayerName = "dataLayer", debugMode = false): string {
  return `
          window['${dataLayerName}'] = window['${dataLayerName}'] || [];
          function gtag(){window['${dataLayerName}'].push(arguments);}
          gtag('js', new Date());

          gtag('config', '${gaId}' ${debugMode ? ",{ 'debug_mode': true }" : ""});`;
}

export function buildContentSecurityPolicy({
  isProduction = process.env.NODE_ENV === "production",
  themeScript = THEME_INIT_SCRIPT,
  googleAnalyticsId = process.env.NEXT_PUBLIC_GA_ID,
}: {
  isProduction?: boolean;
  themeScript?: string;
  googleAnalyticsId?: string | null;
} = {}): string {
  const googleAnalyticsScriptHash = googleAnalyticsId?.startsWith("G-") ? sha256CspHash(googleAnalyticsInitScript(googleAnalyticsId)) : null;
  const scriptSrc = isProduction
    ? ["'self'", sha256CspHash(themeScript), ...(googleAnalyticsScriptHash ? [googleAnalyticsScriptHash] : []), "https://www.googletagmanager.com"]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSrc.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
    "font-src 'self'",
    "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function buildSecurityHeaders(options: Parameters<typeof buildContentSecurityPolicy>[0] = {}): Header[] {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}

export function hasValidBearerToken(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!authorization || !secret || !authorization.startsWith("Bearer ")) return false;

  const actual = new TextEncoder().encode(authorization.slice("Bearer ".length));
  const expected = new TextEncoder().encode(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function unauthorizedResponse(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export function requireBearerToken(authorization: string | null, secret = process.env.CRON_SECRET): Response | null {
  return hasValidBearerToken(authorization, secret) ? null : unauthorizedResponse();
}

export function internalFailurePayload(runId: string) {
  return { ok: false, runId, error: "Internal server error" };
}
