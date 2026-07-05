import { createHash } from "node:crypto";
import { THEME_INIT_SCRIPT } from "./theme-script";

export const THEME_INIT_SCRIPT_CSP_HASH = `'sha256-${createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64")}'`;

export function contentSecurityPolicyForEnvironment(nodeEnv = process.env.NODE_ENV): string {
  const isProduction = nodeEnv === "production";
  const scriptSrc = isProduction
    ? `'self' ${THEME_INIT_SCRIPT_CSP_HASH}`
    : ["'self'", "'unsafe-inline'", ...(nodeEnv === "development" ? ["'unsafe-eval'"] : [])].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSrc}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicyForEnvironment() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
