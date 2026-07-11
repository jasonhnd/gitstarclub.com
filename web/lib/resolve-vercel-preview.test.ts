import { describe, expect, test } from "bun:test";

import { extractVercelPreviewHost, selectDiscoveryMode } from "../scripts/resolve-vercel-preview";

describe("selectDiscoveryMode", () => {
  test("uses the configured identity origin without check-run discovery", () => {
    expect(selectDiscoveryMode("  https://gitstarclub.com  ")).toEqual({
      kind: "identity-origin",
      origin: "https://gitstarclub.com",
    });
  });

  test.each([undefined, "", "   "])("uses check-run discovery when IDENTITY_ORIGIN is %p", (identityOrigin) => {
    expect(selectDiscoveryMode(identityOrigin)).toEqual({ kind: "check-run" });
  });
});

describe("extractVercelPreviewHost", () => {
  test.each([
    [
      "https://vercel.live/open-feedback/gitstarclubcom-git-loop-issue-9-zkscio.vercel.app?via=pr-comment-feedback-link",
      "gitstarclubcom-git-loop-issue-9-zkscio.vercel.app",
    ],
    [
      "https://vercel.live/open-feedback/pre.gitstarclub.com?via=pr-comment-feedback-link",
      "pre.gitstarclub.com",
    ],
  ])("extracts the preview host from %s", (feedbackUrl, expectedHost) => {
    expect(extractVercelPreviewHost(`💬 0 unresolved, 0 resolved. [Go to feedback](${feedbackUrl})`)).toBe(expectedHost);
  });
});
