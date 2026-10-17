import { expect, test } from "bun:test";
import { previewIdentity } from "../../../workers/gitstarclub-web/src/shell";
import { cfBuildCommitSha } from "../cf-build-identity";
import type { WorkerEnv } from "../../../workers/gitstarclub-web/src/env";

const request = new Request("https://pre.gitstarclub.com/.well-known/deployment");
const identity = (env: Record<string, string>, built?: string | null) =>
  previewIdentity(request, env as unknown as WorkerEnv, built);

test("without a baked SHA, Worker identity follows Vercel then the preview var", () => {
  expect(identity({ VERCEL_GIT_COMMIT_SHA: "vercel", CF_PREVIEW_COMMIT_SHA: "preview" }, null).commitSha).toBe(
    "vercel",
  );
  expect(identity({ CF_PREVIEW_COMMIT_SHA: "preview" }, null).commitSha).toBe("preview");
  expect(identity({}, null).commitSha).toBe(null);
});

test("a stale preview override cannot mask the Worker baked commit", () => {
  const built = "a".repeat(40);
  expect(
    identity({ CF_PREVIEW_COMMIT_SHA: "374288c", VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }, built).commitSha,
  ).toBe(built);
  expect(identity({ CF_PREVIEW_COMMIT_SHA: built }, built).commitSha).toBe(built);
});

test("an omitted bake argument uses the module SHA", () => {
  expect(identity({}).commitSha).toBe(cfBuildCommitSha);
});
