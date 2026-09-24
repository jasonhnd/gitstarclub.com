import { expect, test } from "bun:test";
import { resolveCfBuildCommitSha } from "./cf-build-identity";

const sha = "a".repeat(40);
test("build identity uses an override and marks dirty worktrees", () => {
  expect(resolveCfBuildCommitSha("b".repeat(40), sha, " M web/file.ts")).toBe(`${"b".repeat(40)}-dirty`);
  expect(resolveCfBuildCommitSha(undefined, sha, "")).toBe(sha);
});

test("missing Git or invalid SHA produces null", () => {
  expect(resolveCfBuildCommitSha(undefined, null, null)).toBeNull();
  expect(resolveCfBuildCommitSha("not-a-sha", null, "")).toBeNull();
});
