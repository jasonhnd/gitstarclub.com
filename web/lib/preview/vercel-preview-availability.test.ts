import { describe, expect, test } from "bun:test";

import {
  classifyVercelPreviewAvailability,
  isIgnoredBuildText,
  type VercelCheckSignal,
} from "./vercel-preview-availability";

const previewCommentsWithHost: VercelCheckSignal = {
  app: { slug: "vercel" },
  name: "Vercel Preview Comments",
  status: "completed",
  conclusion: "success",
  output: {
    title: "✅ No unresolved feedback",
    summary:
      "💬 0 unresolved, 0 resolved. [Go to feedback](https://vercel.live/open-feedback/gitstarclubcom-git-loop-issue-9-zkscio.vercel.app?via=pr-comment-feedback-link)",
    text: null,
  },
};

const previewCommentsWithoutHost: VercelCheckSignal = {
  app: { slug: "vercel" },
  name: "Vercel Preview Comments",
  status: "completed",
  conclusion: "success",
  output: {
    title: "✅ No unresolved feedback",
    summary: "💬 0 unresolved, 0 resolved.",
    text: null,
  },
};

describe("isIgnoredBuildText", () => {
  test("matches the Vercel commit status from Ignored Build Step", () => {
    expect(isIgnoredBuildText("Canceled by Ignored Build Step")).toBe(true);
    expect(isIgnoredBuildText("The Deployment has been canceled by the Ignored Build Step.")).toBe(true);
    expect(isIgnoredBuildText("Deployment has completed")).toBe(false);
    expect(isIgnoredBuildText(null)).toBe(false);
  });
});

describe("classifyVercelPreviewAvailability", () => {
  test("skips when the Vercel commit status is Canceled by Ignored Build Step", () => {
    expect(
      classifyVercelPreviewAvailability({
        discovery: { kind: "check-run" },
        checks: [previewCommentsWithoutHost],
        statuses: [
          {
            context: "Vercel",
            state: "success",
            description: "Canceled by Ignored Build Step",
          },
        ],
      }),
    ).toEqual({
      kind: "skip",
      reason: "Canceled by Ignored Build Step",
    });
  });

  test("skips PR check-run discovery when Preview Comments completed without a URL", () => {
    expect(
      classifyVercelPreviewAvailability({
        discovery: { kind: "check-run" },
        checks: [previewCommentsWithoutHost],
        statuses: [{ context: "Vercel", state: "success", description: "Deployment has completed" }],
      }),
    ).toEqual({
      kind: "skip",
      reason: "Vercel Preview Comments completed without a preview URL",
    });
  });

  test("does not skip identity-origin discovery just because Preview Comments has no URL", () => {
    expect(
      classifyVercelPreviewAvailability({
        discovery: { kind: "identity-origin", origin: "https://pre.gitstarclub.com" },
        checks: [previewCommentsWithoutHost],
        statuses: [{ context: "Vercel", state: "success", description: "Deployment has completed" }],
      }),
    ).toEqual({ kind: "wait" });
  });

  test("skips identity-origin discovery when Ignored Build canceled the deploy", () => {
    expect(
      classifyVercelPreviewAvailability({
        discovery: { kind: "identity-origin", origin: "https://pre.gitstarclub.com" },
        checks: [previewCommentsWithoutHost],
        statuses: [
          {
            context: "Vercel",
            state: "success",
            description: "Canceled by Ignored Build Step",
          },
        ],
      }),
    ).toEqual({
      kind: "skip",
      reason: "Canceled by Ignored Build Step",
    });
  });

  test("resolves a preview host from Vercel Preview Comments", () => {
    expect(
      classifyVercelPreviewAvailability({
        discovery: { kind: "check-run" },
        checks: [previewCommentsWithHost],
        statuses: [{ context: "Vercel", state: "pending", description: "Building" }],
      }),
    ).toEqual({
      kind: "ready",
      host: "gitstarclubcom-git-loop-issue-9-zkscio.vercel.app",
    });
  });

  test("waits when Vercel has not posted checks or statuses yet", () => {
    expect(
      classifyVercelPreviewAvailability({
        discovery: { kind: "check-run" },
        checks: [],
        statuses: [],
      }),
    ).toEqual({ kind: "wait" });
  });

  test("waits while Preview Comments is still in progress without a URL", () => {
    expect(
      classifyVercelPreviewAvailability({
        discovery: { kind: "check-run" },
        checks: [
          {
            ...previewCommentsWithoutHost,
            status: "in_progress",
            conclusion: null,
          },
        ],
        statuses: [{ context: "Vercel", state: "pending", description: "Building" }],
      }),
    ).toEqual({ kind: "wait" });
  });
});
