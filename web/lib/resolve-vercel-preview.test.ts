import { describe, expect, test } from "bun:test";

import { extractVercelPreviewHost } from "../scripts/resolve-vercel-preview";

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
