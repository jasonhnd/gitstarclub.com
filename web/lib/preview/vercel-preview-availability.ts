import type { PreviewDiscovery } from "./types";
import { extractVercelPreviewHost } from "./vercel-discovery";

export type VercelCheckSignal = {
  app: { slug: string } | null;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  output: {
    title?: string | null;
    summary: string | null;
    text?: string | null;
  };
};

export type VercelStatusSignal = {
  context: string;
  state: string;
  description: string | null;
};

export type VercelPreviewAvailability =
  | { kind: "ready"; host: string }
  | { kind: "skip"; reason: string }
  | { kind: "wait" };

const IGNORED_BUILD = /ignored build/i;

export function isIgnoredBuildText(text: string | null | undefined): boolean {
  return Boolean(text && IGNORED_BUILD.test(text));
}

function vercelCheckBlob(check: VercelCheckSignal): string {
  return [check.name, check.conclusion, check.output.title, check.output.summary, check.output.text]
    .filter(Boolean)
    .join("\n");
}

export function classifyVercelPreviewAvailability(input: {
  discovery: PreviewDiscovery;
  checks: VercelCheckSignal[];
  statuses: VercelStatusSignal[];
}): VercelPreviewAvailability {
  const vercelChecks = input.checks.filter((check) => check.app?.slug === "vercel");
  const vercelStatuses = input.statuses.filter((status) => /^vercel\b/i.test(status.context));

  for (const status of vercelStatuses) {
    if (isIgnoredBuildText(status.description) || isIgnoredBuildText(status.context)) {
      return {
        kind: "skip",
        reason: status.description?.trim() || "Vercel Ignored Build Step canceled the deployment",
      };
    }
  }

  for (const check of vercelChecks) {
    if (isIgnoredBuildText(vercelCheckBlob(check))) {
      return { kind: "skip", reason: "Vercel check reported Ignored Build / canceled deployment" };
    }
    const host = extractVercelPreviewHost(check.output.summary);
    if (host) return { kind: "ready", host };
  }

  const previewComments = vercelChecks.find((check) => check.name === "Vercel Preview Comments");
  const commentsHavePreviewUrl = Boolean(extractVercelPreviewHost(previewComments?.output.summary));
  if (previewComments?.status === "completed" && !commentsHavePreviewUrl) {
    switch (input.discovery.kind) {
      case "check-run":
        return {
          kind: "skip",
          reason: "Vercel Preview Comments completed without a preview URL",
        };
      case "identity-origin":
        break;
      default: {
        const _exhaustive: never = input.discovery;
        throw new Error(`unsupported preview discovery: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  return { kind: "wait" };
}
