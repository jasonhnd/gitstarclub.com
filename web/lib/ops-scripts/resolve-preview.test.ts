import { describe, expect, test } from "bun:test";
import { requiredReleaseEnv, resolveCfPreviewDecision } from "../../scripts/lib/resolve-preview-cf";

const origin = "https://preview.example";

describe("resolve-preview Cloudflare guards", () => {
  test("requires an identity, and a SHA when the gate is on", () => {
    expect(() =>
      resolveCfPreviewDecision({ identity: null, expectedSha: "abc", requireSha: false, origin }),
    ).toThrow(`Failed to read CF Preview identity at ${origin} (Access Service Token required)`);
    expect(() =>
      resolveCfPreviewDecision({
        identity: { commitSha: "abc", deploymentUrl: origin },
        expectedSha: undefined,
        requireSha: true,
        origin,
      }),
    ).toThrow("EXPECTED_SHA is required when CF_PREVIEW_REQUIRE_SHA=1");
    expect(() =>
      resolveCfPreviewDecision({
        identity: { commitSha: null, deploymentUrl: origin },
        expectedSha: "abc",
        requireSha: true,
        origin,
      }),
    ).toThrow("CF Preview SHA mismatch: identity=none expected=abc");
    expect(() =>
      resolveCfPreviewDecision({
        identity: { commitSha: "other", deploymentUrl: origin },
        expectedSha: "abc",
        requireSha: true,
        origin,
      }),
    ).toThrow("identity=other expected=abc");
  });

  test("builds metadata, GitHub output, and the log line", () => {
    const matched = resolveCfPreviewDecision({
      identity: { commitSha: "abc", deploymentUrl: null },
      expectedSha: "abc",
      requireSha: true,
      origin,
    });
    expect(matched.metadata).toEqual({
      commitSha: "abc",
      deploymentUrl: origin,
      resolvedFrom: origin,
      target: "cf",
    });
    expect(matched.githubOutput).toBe(`url=${origin}\nsha=abc\n`);
    expect(matched.logLine).toBe(`Resolved CF Preview ${origin} for abc.`);

    const open = resolveCfPreviewDecision({
      identity: { commitSha: "other", deploymentUrl: "https://deploy.example" },
      expectedSha: "abc",
      requireSha: false,
      origin,
    });
    expect(open.metadata.deploymentUrl).toBe("https://deploy.example");
    expect(open.metadata.commitSha).toBe("other");

    const empty = resolveCfPreviewDecision({
      identity: { commitSha: null, deploymentUrl: origin },
      expectedSha: "",
      requireSha: false,
      origin,
    });
    expect(empty.metadata.commitSha).toBeNull();
    expect(empty.logLine).toBe(`Resolved CF Preview ${origin}.`);
  });

  test("trims required release-gate variables and rejects blanks", () => {
    expect(requiredReleaseEnv({ GITHUB_OUTPUT: "  /tmp/out  " }, "GITHUB_OUTPUT")).toBe("/tmp/out");
    expect(() => requiredReleaseEnv({ GITHUB_OUTPUT: "   " }, "GITHUB_OUTPUT")).toThrow(
      "Missing required release-gate variable: GITHUB_OUTPUT",
    );
    expect(() => requiredReleaseEnv({}, "GITHUB_OUTPUT")).toThrow("GITHUB_OUTPUT");
  });
});
