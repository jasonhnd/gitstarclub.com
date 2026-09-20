/// <reference types="bun" />

import { appendFileSync } from "node:fs";
import {
  classifyVercelPreviewAvailability,
  type VercelCheckSignal,
  type VercelStatusSignal,
} from "../lib/preview/vercel-preview-availability";
import { selectDiscoveryMode, validateVercelDeploymentUrl } from "../lib/preview/vercel-discovery";
import { fetchWithVercelProtectionBypass } from "../lib/vercel-protection-bypass";

interface DeploymentIdentity {
  commitSha: string | null;
  deploymentUrl: string | null;
}

if (import.meta.main) await resolveVercelPreview();

export async function resolveVercelPreview(): Promise<void> {
  const expectedSha = required("EXPECTED_SHA");
  const outputPath = required("GITHUB_OUTPUT");
  const discovery = selectDiscoveryMode(process.env.IDENTITY_ORIGIN);
  const github = githubLookup(discovery.kind === "check-run");
  // Full Next.js preview builds commonly take 9–14 minutes (3500+ static pages
  // + Blob reads). 10 minutes was too tight and caused false preview-e2e timeouts
  // while Vercel was still building a healthy deployment.
  const attempts = 120;
  const delayMs = 10_000;

  let identityOrigin = discovery.kind === "identity-origin" ? discovery.origin : null;
  let lastObservedSha: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (github) {
      const signals = await readVercelGithubSignals(github.repository, expectedSha, github.githubToken);
      const availability = classifyVercelPreviewAvailability({
        discovery,
        checks: signals.checks,
        statuses: signals.statuses,
      });
      switch (availability.kind) {
        case "skip":
          await writeSkip(outputPath, expectedSha, availability.reason);
          process.exit(0);
          return;
        case "ready":
          identityOrigin ??= `https://${availability.host}`;
          break;
        case "wait":
          break;
        default: {
          const _exhaustive: never = availability;
          throw new Error(`unsupported Vercel preview availability: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    if (identityOrigin) {
      requireBypassSecret();
      if (attempt === 1) console.log(`Probing identity at ${identityOrigin}`);
      const aliasIdentity = await readIdentity(identityOrigin);
      lastObservedSha = aliasIdentity?.commitSha ?? lastObservedSha;

      if (aliasIdentity?.commitSha === expectedSha && aliasIdentity.deploymentUrl) {
        const deploymentUrl = validateVercelDeploymentUrl(aliasIdentity.deploymentUrl);
        const immutableIdentity = await readIdentity(deploymentUrl);

        if (immutableIdentity?.commitSha === expectedSha) {
          const metadata = {
            commitSha: expectedSha,
            deploymentUrl,
            resolvedFrom: identityOrigin,
          };
          await Bun.write("release-metadata.json", `${JSON.stringify(metadata, null, 2)}\n`);
          writeOutputs(outputPath, {
            url: deploymentUrl,
            sha: expectedSha,
            skipped: false,
          });
          console.log(`Resolved Vercel deployment ${deploymentUrl} for ${expectedSha}.`);
          process.exit(0);
        }
      }
    }

    const observed = lastObservedSha ? `; alias currently serves ${lastObservedSha}` : "";
    console.log(`Waiting for Vercel deployment ${expectedSha} (${attempt}/${attempts})${observed}.`);
    await Bun.sleep(delayMs);
  }

  switch (discovery.kind) {
    case "check-run":
      await writeSkip(
        outputPath,
        expectedSha,
        `No Vercel Preview URL for ${expectedSha} after waiting (last observed SHA: ${lastObservedSha ?? "none"})`,
      );
      process.exit(0);
      return;
    case "identity-origin":
      throw new Error(
        `Timed out waiting for a Vercel preview that identifies itself as ${expectedSha}. ` +
          `Last observed SHA: ${lastObservedSha ?? "none"}.`,
      );
    default: {
      const _exhaustive: never = discovery;
      throw new Error(`unsupported preview discovery: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export {
  classifyVercelPreviewAvailability,
  isIgnoredBuildText,
} from "../lib/preview/vercel-preview-availability";
export { extractVercelPreviewHost, selectDiscoveryMode } from "../lib/preview/vercel-discovery";

async function readVercelGithubSignals(
  repository: string,
  expectedSha: string,
  githubToken: string,
): Promise<{ checks: VercelCheckSignal[]; statuses: VercelStatusSignal[] }> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "User-Agent": "gitstarclub-release-gate",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const [checksResponse, statusResponse] = await Promise.all([
    fetch(`https://api.github.com/repos/${repository}/commits/${expectedSha}/check-runs?per_page=100`, { headers }),
    fetch(`https://api.github.com/repos/${repository}/commits/${expectedSha}/status?per_page=100`, { headers }),
  ]);
  if (!checksResponse.ok) {
    throw new Error(`GitHub check-runs lookup failed: ${checksResponse.status} ${checksResponse.statusText}`);
  }
  if (!statusResponse.ok) {
    throw new Error(`GitHub commit status lookup failed: ${statusResponse.status} ${statusResponse.statusText}`);
  }

  const checksPayload = (await checksResponse.json()) as { check_runs: VercelCheckSignal[] };
  const statusPayload = (await statusResponse.json()) as { statuses: VercelStatusSignal[] };
  return {
    checks: checksPayload.check_runs ?? [],
    statuses: statusPayload.statuses ?? [],
  };
}

async function readIdentity(baseUrl: string): Promise<DeploymentIdentity | null> {
  try {
    const url = new URL("/.well-known/deployment", `${baseUrl.replace(/\/+$/, "")}/`);
    const response = await fetchWithVercelProtectionBypass(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as DeploymentIdentity;
  } catch {
    return null;
  }
}

function githubLookup(requiredForCheckRun: boolean): { repository: string; githubToken: string } | null {
  const repository = process.env["GITHUB_REPOSITORY"]?.trim();
  const githubToken = process.env["GITHUB_TOKEN"]?.trim();
  if (repository && githubToken) return { repository, githubToken };
  if (requiredForCheckRun) {
    return { repository: required("GITHUB_REPOSITORY"), githubToken: required("GITHUB_TOKEN") };
  }
  return null;
}

function requireBypassSecret(): void {
  if (!process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()) {
    throw new Error(
      "VERCEL_AUTOMATION_BYPASS_SECRET is required to read Preview identity after Vercel Authentication was enabled",
    );
  }
}

async function writeSkip(outputPath: string, expectedSha: string, reason: string): Promise<void> {
  const skipReason = reason.replace(/[\r\n]+/g, " ").slice(0, 200);
  const metadata = {
    skipped: true,
    skipReason,
    commitSha: expectedSha,
    deploymentUrl: null,
  };
  console.log(`Skipping Vercel preview resolution: ${skipReason}`);
  await Bun.write("release-metadata.json", `${JSON.stringify(metadata, null, 2)}\n`);
  writeOutputs(outputPath, {
    url: "",
    sha: expectedSha,
    skipped: true,
    skip_reason: skipReason,
  });
}

function writeOutputs(
  outputPath: string,
  fields: { url: string; sha: string; skipped: boolean; skip_reason?: string },
): void {
  const lines = [`url=${fields.url}`, `sha=${fields.sha}`, `skipped=${fields.skipped ? "true" : "false"}`];
  if (fields.skip_reason) lines.push(`skip_reason=${fields.skip_reason}`);
  appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required release-gate variable: ${key}`);
  return value;
}
