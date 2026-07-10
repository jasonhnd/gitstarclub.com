/// <reference types="bun" />

import { appendFileSync } from "node:fs";

interface CheckRun {
  app: { slug: string } | null;
  name: string;
  output: { summary: string | null };
}

interface DeploymentIdentity {
  commitSha: string | null;
  deploymentUrl: string | null;
}

if (import.meta.main) await main();

async function main(): Promise<void> {
  const expectedSha = required("EXPECTED_SHA");
  const outputPath = required("GITHUB_OUTPUT");
  const discovery = selectDiscoveryMode(process.env.IDENTITY_ORIGIN);
  const checkRunDiscovery =
    discovery.kind === "check-run"
      ? { repository: required("GITHUB_REPOSITORY"), githubToken: required("GITHUB_TOKEN") }
      : null;
  const attempts = 60;
  const delayMs = 10_000;

  let previewHost: string | null = null;
  let identityOrigin = discovery.kind === "identity-origin" ? discovery.origin : null;
  let lastObservedSha: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!identityOrigin && checkRunDiscovery) {
      previewHost ??= await findVercelPreviewHost(
        checkRunDiscovery.repository,
        expectedSha,
        checkRunDiscovery.githubToken,
      );
      identityOrigin = previewHost ? `https://${previewHost}` : null;
    }

    if (identityOrigin) {
      const aliasIdentity = await readIdentity(identityOrigin);
      lastObservedSha = aliasIdentity?.commitSha ?? lastObservedSha;

      if (aliasIdentity?.commitSha === expectedSha && aliasIdentity.deploymentUrl) {
        const deploymentUrl = validateDeploymentUrl(aliasIdentity.deploymentUrl);
        const immutableIdentity = await readIdentity(deploymentUrl);

        if (immutableIdentity?.commitSha === expectedSha) {
          const metadata = {
            commitSha: expectedSha,
            deploymentUrl,
            resolvedFrom: identityOrigin,
          };
          await Bun.write("release-metadata.json", `${JSON.stringify(metadata, null, 2)}\n`);
          appendFileSync(outputPath, `url=${deploymentUrl}\nsha=${expectedSha}\n`);
          console.log(`Resolved Vercel deployment ${deploymentUrl} for ${expectedSha}.`);
          process.exit(0);
        }
      }
    }

    const observed = lastObservedSha ? `; alias currently serves ${lastObservedSha}` : "";
    console.log(`Waiting for Vercel deployment ${expectedSha} (${attempt}/${attempts})${observed}.`);
    await Bun.sleep(delayMs);
  }

  throw new Error(
    `Timed out waiting for a Vercel preview that identifies itself as ${expectedSha}. ` +
      `Last observed SHA: ${lastObservedSha ?? "none"}.`,
  );
}

export function selectDiscoveryMode(identityOrigin: string | undefined) {
  const origin = identityOrigin?.trim();
  return origin ? ({ kind: "identity-origin", origin } as const) : ({ kind: "check-run" } as const);
}

async function findVercelPreviewHost(repository: string, expectedSha: string, githubToken: string): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${expectedSha}/check-runs?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "gitstarclub-release-gate",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub check-runs lookup failed: ${response.status} ${response.statusText}`);

  const payload = (await response.json()) as { check_runs: CheckRun[] };
  const vercelCheck = payload.check_runs.find((check) => check.app?.slug === "vercel" && check.name === "Vercel Preview Comments");
  return extractVercelPreviewHost(vercelCheck?.output.summary);
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

async function readIdentity(baseUrl: string): Promise<DeploymentIdentity | null> {
  try {
    const response = await fetch(`${baseUrl}/.well-known/deployment`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as DeploymentIdentity;
  } catch {
    return null;
  }
}

function validateDeploymentUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app") || url.pathname !== "/") {
    throw new Error(`Rejected unexpected Vercel deployment URL: ${value}`);
  }
  return url.origin;
}

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required release-gate variable: ${key}`);
  return value;
}
