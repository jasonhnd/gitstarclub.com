import type { PreviewIdentity } from "@/lib/preview/types";

export type CfPreviewDecision = {
  metadata: {
    commitSha: string | null;
    deploymentUrl: string;
    resolvedFrom: string;
    target: "cf";
  };
  githubOutput: string;
  logLine: string;
};

export function requiredReleaseEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required release-gate variable: ${key}`);
  return value;
}

/** SHA and identity guards for the Cloudflare branch of resolve-preview.ts. */
export function resolveCfPreviewDecision(input: {
  identity: PreviewIdentity | null;
  expectedSha: string | undefined;
  requireSha: boolean;
  origin: string;
}): CfPreviewDecision {
  const { identity, expectedSha, requireSha, origin } = input;
  if (!identity) {
    throw new Error(`Failed to read CF Preview identity at ${origin} (Access Service Token required)`);
  }
  if (requireSha) {
    if (!expectedSha) throw new Error("EXPECTED_SHA is required when CF_PREVIEW_REQUIRE_SHA=1");
    if (identity.commitSha !== expectedSha) {
      throw new Error(`CF Preview SHA mismatch: identity=${identity.commitSha ?? "none"} expected=${expectedSha}`);
    }
  }
  const deploymentUrl = identity.deploymentUrl ?? origin;
  const sha = identity.commitSha ?? expectedSha ?? "";
  return {
    metadata: {
      commitSha: sha || null,
      deploymentUrl,
      resolvedFrom: origin,
      target: "cf",
    },
    githubOutput: `url=${deploymentUrl}\nsha=${sha}\n`,
    logLine: `Resolved CF Preview ${deploymentUrl}${sha ? ` for ${sha}` : ""}.`,
  };
}
