import { reportedCommitSha } from "@/lib/deployment-commit";
import { getCfPreviewOrigin, getHostingTarget, type HostingTarget } from "@/lib/runtime-config";

export type DeploymentIdentity = {
  commitSha: string | null;
  deploymentUrl: string | null;
  target?: HostingTarget;
  host?: string;
};

type IdentityEnv = Record<string, string | undefined>;

function vercelDeploymentHost(env: IdentityEnv): string | null {
  const host = env.VERCEL_URL?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return host || null;
}

export function buildDeploymentIdentity(
  requestUrl: string,
  env: IdentityEnv = process.env,
  builtCommitSha?: string | null,
): DeploymentIdentity {
  const hosting = getHostingTarget(env);
  const vercelHost = vercelDeploymentHost(env);
  const commitSha = reportedCommitSha(env, builtCommitSha);
  const deploymentUrl = vercelHost
    ? `https://${vercelHost}`
    : hosting === "cf"
      ? getCfPreviewOrigin(env)
      : null;

  if (hosting === "cf") {
    return {
      commitSha,
      deploymentUrl,
      target: "cf",
      host: new URL(requestUrl).host,
    };
  }

  return { commitSha, deploymentUrl };
}
