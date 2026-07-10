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

const repository = required("GITHUB_REPOSITORY");
const expectedSha = required("EXPECTED_SHA");
const githubToken = required("GITHUB_TOKEN");
const outputPath = required("GITHUB_OUTPUT");
const attempts = 60;
const delayMs = 10_000;

let previewHost: string | null = null;
let lastObservedSha: string | null = null;

for (let attempt = 1; attempt <= attempts; attempt++) {
  previewHost ??= await findVercelPreviewHost();

  if (previewHost) {
    const aliasIdentity = await readIdentity(`https://${previewHost}`);
    lastObservedSha = aliasIdentity?.commitSha ?? lastObservedSha;

    if (aliasIdentity?.commitSha === expectedSha && aliasIdentity.deploymentUrl) {
      const deploymentUrl = validateDeploymentUrl(aliasIdentity.deploymentUrl);
      const immutableIdentity = await readIdentity(deploymentUrl);

      if (immutableIdentity?.commitSha === expectedSha) {
        const metadata = {
          commitSha: expectedSha,
          deploymentUrl,
          resolvedFrom: `https://${previewHost}`,
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

async function findVercelPreviewHost(): Promise<string | null> {
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
  const match = vercelCheck?.output.summary?.match(/https:\/\/vercel\.live\/open-feedback\/([a-z0-9.-]+\.vercel\.app)(?:\?|\))/i);
  return match?.[1]?.toLowerCase() ?? null;
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
