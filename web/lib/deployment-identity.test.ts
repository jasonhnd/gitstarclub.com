import { describe, expect, test } from "bun:test";
import { buildDeploymentIdentity } from "./deployment-identity";

describe("buildDeploymentIdentity", () => {
  test("keeps the Vercel gate shape when hosting is unset", () => {
    expect(
      buildDeploymentIdentity("https://gitstarclub-abc.vercel.app/.well-known/deployment", {
        VERCEL_URL: "gitstarclub-abc.vercel.app",
        VERCEL_GIT_COMMIT_SHA: "abc123",
      }),
    ).toEqual({
      commitSha: "abc123",
      deploymentUrl: "https://gitstarclub-abc.vercel.app",
    });
  });

  test("adds CF preview fields on the Workers host", () => {
    expect(
      buildDeploymentIdentity("https://gitstarclub-web.worldgo.workers.dev/.well-known/deployment", {
        HOSTING_TARGET: "cf",
        CF_PREVIEW_COMMIT_SHA: "def456",
        CF_PREVIEW_ORIGIN: "https://gitstarclub-web.worldgo.workers.dev",
      }),
    ).toEqual({
      commitSha: "def456",
      deploymentUrl: "https://gitstarclub-web.worldgo.workers.dev",
      target: "cf",
      host: "gitstarclub-web.worldgo.workers.dev",
    });
  });
});

describe("commit SHA priority", () => {
  const url = "https://pre.gitstarclub.com/.well-known/deployment";
  test("Vercel wins over CF and the build value", () => {
    expect(buildDeploymentIdentity(url, {
      HOSTING_TARGET: "cf",
      VERCEL_GIT_COMMIT_SHA: "vercel",
      CF_PREVIEW_COMMIT_SHA: "preview",
    }).commitSha).toBe("vercel");
  });

  test("CF preview wins when Vercel is absent", () => {
    expect(buildDeploymentIdentity(url, {
      HOSTING_TARGET: "cf",
      CF_PREVIEW_COMMIT_SHA: "preview",
    }).commitSha).toBe("preview");
  });

  test("missing overrides use the baked value or null", async () => {
    const { cfBuildCommitSha } = await import("./cf-build-identity");
    expect(buildDeploymentIdentity(url, { HOSTING_TARGET: "cf" }).commitSha).toBe(cfBuildCommitSha);
  });
});
