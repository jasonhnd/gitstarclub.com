import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveCfBuildCommitSha, writeCfBuildIdentity } from "./cf-build-identity";

const sha = "a".repeat(40);
test("build identity uses an override and marks dirty worktrees", () => {
  expect(resolveCfBuildCommitSha("b".repeat(40), sha, " M web/file.ts")).toBe(`${"b".repeat(40)}-dirty`);
  expect(resolveCfBuildCommitSha(undefined, sha, "")).toBe(sha);
});

test("missing Git or invalid SHA produces null", () => {
  expect(resolveCfBuildCommitSha(undefined, null, null)).toBeNull();
  expect(resolveCfBuildCommitSha("not-a-sha", null, "")).toBeNull();
});

test("two consecutive builds from a clean checkout stay clean", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-build-identity-"));
  const runGit = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    mkdirSync(join(root, "web/lib"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), "/web/lib/cf-build-identity.ts\n");
    writeFileSync(join(root, "web/lib/fallback.ts"), "export const cfBuildCommitSha = null;\n");
    runGit("init", "-q");
    runGit("add", ".");
    runGit("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture");
    const head = runGit("rev-parse", "HEAD");
    expect(writeCfBuildIdentity(undefined, root)).toBe(head);
    expect(writeCfBuildIdentity(undefined, root)).toBe(head);
    expect(readFileSync(join(root, "web/lib/cf-build-identity.ts"), "utf8")).toContain(head);
    expect(runGit("status", "--porcelain")).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
