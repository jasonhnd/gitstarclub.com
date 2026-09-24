import { expect, test } from "bun:test";
import { previewIdentity } from "../../../workers/gitstarclub-web/src/shell";
import { cfBuildCommitSha } from "../cf-build-identity";
import type { WorkerEnv } from "../../../workers/gitstarclub-web/src/env";

const request = new Request("https://pre.gitstarclub.com/.well-known/deployment");
const identity = (env: Record<string, string>) => previewIdentity(request, env as unknown as WorkerEnv);

test("Worker identity follows Vercel, preview, and build SHA priority", () => {
  expect(identity({ VERCEL_GIT_COMMIT_SHA: "vercel", CF_PREVIEW_COMMIT_SHA: "preview" }).commitSha).toBe("vercel");
  expect(identity({ CF_PREVIEW_COMMIT_SHA: "preview" }).commitSha).toBe("preview");
  expect(identity({}).commitSha).toBe(cfBuildCommitSha);
});
