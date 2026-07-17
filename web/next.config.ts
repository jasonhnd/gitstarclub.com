import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { assertAnalyticsCspCompatibility } from "./lib/analytics-policy";
import { securityHeaders } from "./lib/csp";

// Canonical URLs do not carry locale prefixes. Language is a cookie-backed in-page
// preference, while repo pages mirror GitHub as /owner/name.
const exportRoot = join(process.cwd(), "public", "data", "exports", "v1");
const contentSecurityPolicy = securityHeaders.find(
  (header) => header.key === "Content-Security-Policy",
);

if (!contentSecurityPolicy) {
  throw new Error("Content-Security-Policy header is required");
}
assertAnalyticsCspCompatibility(contentSecurityPolicy.value);

function latestDataExportDate(): string | null {
  if (!existsSync(exportRoot)) return null;
  return (
    readdirSync(exportRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .at(-1) ?? null
  );
}

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    const latestExportDate = latestDataExportDate();
    if (!latestExportDate) return [];
    return {
      beforeFiles: [
        {
          source: "/data/exports/v1/latest/:path*",
          destination: `/data/exports/v1/${latestExportDate}/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

// withWorkflow enables the "use workflow" / "use step" directives (Vercel Workflow SDK).
export default withWorkflow(nextConfig);
