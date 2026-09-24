import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");
const outputPath = join(repoRoot, "web/lib/cf-build-identity.ts");

function git(...args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function resolveCfBuildCommitSha(
  override: string | undefined,
  head: string | null,
  status: string | null,
): string | null {
  const sha = override?.trim() || head;
  if (!sha || !/^[a-f0-9]{40,64}$/i.test(sha) || status === null) return null;
  return status ? `${sha}-dirty` : sha;
}

export function writeCfBuildIdentity(override = process.env.CF_BUILD_COMMIT_SHA): string | null {
  const head = git("rev-parse", "HEAD");
  // Ignore the generated source itself when rebuilding an otherwise clean checkout.
  const status = git("status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)web/lib/cf-build-identity.ts");
  const sha = resolveCfBuildCommitSha(override, head, status);
  writeFileSync(outputPath, `// Rewritten by cf:build. A source checkout has no build identity.\nexport const cfBuildCommitSha: string | null = ${JSON.stringify(sha)};\n`);
  return sha;
}

if (import.meta.main) console.log(`CF build identity: ${writeCfBuildIdentity() ?? "null"}`);
