import { describe, expect, test } from "bun:test";
import { reportedCommitSha } from "./deployment-commit";

const built = "a".repeat(40);

describe("reportedCommitSha", () => {
  test("uses the baked SHA when a runtime override names a different commit", () => {
    expect(
      reportedCommitSha(
        {
          CF_PREVIEW_COMMIT_SHA: "374288c",
          VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
        },
        built,
      ),
    ).toBe(built);
  });

  test("reports the baked SHA when the override names that same commit", () => {
    expect(reportedCommitSha({ CF_PREVIEW_COMMIT_SHA: built }, built)).toBe(built);
    expect(reportedCommitSha({ VERCEL_GIT_COMMIT_SHA: ` ${built} ` }, built)).toBe(built);
  });

  test("falls back to Vercel, then the preview var, when nothing was baked", () => {
    expect(
      reportedCommitSha(
        {
          VERCEL_GIT_COMMIT_SHA: "vercel",
          CF_PREVIEW_COMMIT_SHA: "preview",
        },
        null,
      ),
    ).toBe("vercel");
    expect(reportedCommitSha({ CF_PREVIEW_COMMIT_SHA: " preview " }, null)).toBe("preview");
    expect(reportedCommitSha({}, null)).toBe(null);
    expect(reportedCommitSha({ VERCEL_GIT_COMMIT_SHA: "  ", CF_PREVIEW_COMMIT_SHA: "" }, null)).toBe(null);
  });
});
