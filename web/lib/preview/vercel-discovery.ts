import type { PreviewDiscovery } from "./types";

export function selectDiscoveryMode(identityOrigin: string | undefined): PreviewDiscovery {
  const origin = identityOrigin?.trim();
  return origin ? ({ kind: "identity-origin", origin } as const) : ({ kind: "check-run" } as const);
}

export function extractVercelPreviewHost(summary: string | null | undefined): string | null {
  const match = summary?.match(/https:\/\/vercel\.live\/open-feedback\/[^\s)]+/i);
  if (!match) return null;

  try {
    const feedbackUrl = new URL(match[0]);
    const previewUrl = new URL(`https://${feedbackUrl.pathname.slice("/open-feedback/".length)}`);
    if (previewUrl.pathname !== "/" || previewUrl.port || previewUrl.username || previewUrl.password) return null;
    return previewUrl.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function validateVercelDeploymentUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app") || url.pathname !== "/") {
    throw new Error(`Rejected unexpected Vercel deployment URL: ${value}`);
  }
  return url.origin;
}
