import { cfBuildCommitSha } from "./cf-build-identity";

type CommitEnv = {
  VERCEL_GIT_COMMIT_SHA?: string;
  CF_PREVIEW_COMMIT_SHA?: string;
};

/**
 * The SHA written by cf:build is the deployment identity.
 * A runtime override is accepted only when no SHA was baked, or when it
 * names that same commit. A stale wrangler --var must not mask the build.
 */
export function reportedCommitSha(
  env: CommitEnv,
  built: string | null | undefined = cfBuildCommitSha,
): string | null {
  const builtSha = built?.trim() || null;
  if (builtSha) return builtSha;
  return env.VERCEL_GIT_COMMIT_SHA?.trim() || env.CF_PREVIEW_COMMIT_SHA?.trim() || null;
}
